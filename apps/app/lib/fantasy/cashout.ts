import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readFantasyConfig } from "@/lib/fantasy/config";
import { getMarketDefinition } from "@/lib/fantasy/markets/registry";
import type { FantasyMarket } from "@/lib/fantasy/markets/types";
import { loadPlacementContext, refreshIfStale } from "@/lib/fantasy/odds";
import { PickError } from "@/lib/fantasy/picks";
import { getGroupFantasyContext } from "@/lib/fantasy/wallet";
import {
  PROBABILITY_CEILING,
  PROBABILITY_FLOOR,
} from "@/lib/fantasy/simulation/types";

/**
 * Cash-out (spec §4): quote = CurrentProbability × PotentialReturn × 0.90,
 * offered for ~15 seconds against a pinned (event_version, pick_version).
 *
 * Eligibility pipeline, in order:
 *   1. pick is yours, open, event fantasy active and not final
 *   2. registry eligibleForCashout
 *   3. registry isSelfDependent — blocks markets the bettor could resolve
 *      with their own next score entry (e.g. 1+ birdie on yourself)
 *   4. registry cashoutCutoff — settled/closed/round-complete/decided
 *   5. force-fresh odds, then mathematically-resolved check (clamped p)
 */

export const CASHOUT_DISCOUNT = 0.9;
export const CASHOUT_OFFER_TTL_MS = 15_000;

export function computeCashoutValue(
  probability: number,
  potentialReturn: number,
  discount = CASHOUT_DISCOUNT
): number {
  return Math.round(probability * potentialReturn * discount * 100) / 100;
}

export type CashoutOffer = {
  id: string;
  pick_id: string;
  offer_value: number;
  probability: number;
  expires_at: string;
  status: string;
};

type PickRow = {
  id: string;
  market_id: string;
  event_id: string;
  group_id: string;
  profile_id: string;
  selection_key: string;
  stake: number;
  potential_return: number;
  pick_version: number;
  status: string;
};

export async function requestCashout(params: {
  profileId: string;
  pickId: string;
}): Promise<{ offer: CashoutOffer }> {
  const { data: pickRow, error: pickErr } = await supabaseAdmin
    .from("fantasy_picks")
    .select("*")
    .eq("id", params.pickId)
    .maybeSingle();
  if (pickErr) throw pickErr;
  const pick = pickRow as PickRow | null;
  if (!pick) throw new PickError("Pick not found", 404);
  if (pick.profile_id !== params.profileId) throw new PickError("Not your pick", 403);
  if (pick.status !== "open") throw new PickError("Pick is no longer open");

  const ctx = await getGroupFantasyContext(pick.group_id);
  if (!ctx || !readFantasyConfig(ctx.fantasyConfig)) {
    throw new PickError("Fantasy picks are not enabled for this group");
  }

  const { data: stateRow } = await supabaseAdmin
    .from("fantasy_event_state")
    .select("version, is_final")
    .eq("event_id", pick.event_id)
    .maybeSingle();
  if (!stateRow) throw new PickError("Fantasy is not active for this event");
  if ((stateRow as { is_final: boolean }).is_final) {
    throw new PickError("Event is settled — cash-out is closed");
  }

  const { data: marketRow, error: marketErr } = await supabaseAdmin
    .from("fantasy_markets")
    .select("*")
    .eq("id", pick.market_id)
    .single();
  if (marketErr) throw marketErr;
  const market = marketRow as FantasyMarket;
  if (market.status === "settled" || market.status === "void") {
    throw new PickError("Market is settled");
  }
  if (market.status === "suspended") {
    throw new PickError("Market is suspended — cash-out is unavailable");
  }

  const def = getMarketDefinition(market.market_type);
  if (!def) throw new PickError("Unknown market type");
  if (!def.eligibleForCashout) {
    throw new PickError("This market doesn't support cash-out");
  }

  const { live } = await loadPlacementContext(pick.event_id);
  if (def.isSelfDependent(market, pick.selection_key, params.profileId, live)) {
    throw new PickError(
      "Cash-out is unavailable — your own next score could decide this market"
    );
  }
  const cutoff = def.cashoutCutoff(market, pick.selection_key, live);
  if (!cutoff.eligible) {
    throw new PickError(`Cash-out is unavailable — ${cutoff.reason.toLowerCase()}`);
  }

  // Reuse a live quote when nothing has moved.
  const { data: existing } = await supabaseAdmin
    .from("fantasy_cashout_offers")
    .select("*")
    .eq("pick_id", pick.id)
    .eq("status", "offered")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Spec: cash-out requests bypass the debounce — price on fresh odds.
  const refreshResult = await refreshIfStale(pick.event_id, { force: true });
  if (!refreshResult.refreshed && refreshResult.refreshing) {
    // Another request is mid-refresh; give it a moment, then re-check.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const { data: recheck } = await supabaseAdmin
      .from("fantasy_event_state")
      .select("odds_stale")
      .eq("event_id", pick.event_id)
      .single();
    if ((recheck as { odds_stale: boolean } | null)?.odds_stale) {
      throw new PickError("Odds are being refreshed — try again in a few seconds", 409);
    }
  }

  const { data: freshState, error: freshErr } = await supabaseAdmin
    .from("fantasy_event_state")
    .select("version")
    .eq("event_id", pick.event_id)
    .single();
  if (freshErr) throw freshErr;
  const version = (freshState as { version: number }).version;

  if (
    existing &&
    (existing as { event_version: number; pick_version: number }).event_version === version &&
    (existing as { event_version: number; pick_version: number }).pick_version === pick.pick_version
  ) {
    return { offer: existing as CashoutOffer };
  }

  const { data: snapRow, error: snapErr } = await supabaseAdmin
    .from("fantasy_odds_snapshots")
    .select("probability")
    .eq("market_id", pick.market_id)
    .eq("selection_key", pick.selection_key)
    .eq("event_version", version)
    .eq("status", "active")
    .maybeSingle();
  if (snapErr) throw snapErr;
  if (!snapRow) throw new PickError("No current odds for this pick — try again shortly", 409);

  const probability = Number((snapRow as { probability: number }).probability);
  if (probability <= PROBABILITY_FLOOR || probability >= PROBABILITY_CEILING) {
    throw new PickError("Cash-out is unavailable — market is already decided");
  }

  const value = computeCashoutValue(probability, Number(pick.potential_return));
  if (value < 0.01) {
    throw new PickError("Cash-out value is too low to offer");
  }

  const { data: offerRow, error: offerErr } = await supabaseAdmin
    .from("fantasy_cashout_offers")
    .insert({
      pick_id: pick.id,
      group_id: pick.group_id,
      event_id: pick.event_id,
      event_version: version,
      pick_version: pick.pick_version,
      offer_value: value,
      probability,
      discount_factor: CASHOUT_DISCOUNT,
      status: "offered",
      expires_at: new Date(Date.now() + CASHOUT_OFFER_TTL_MS).toISOString(),
    })
    .select("*")
    .single();
  if (offerErr) throw offerErr;

  return { offer: offerRow as CashoutOffer };
}

export type EstimatePick = {
  id: string;
  event_id: string;
  market_id: string;
  selection_key: string;
  profile_id: string;
  potential_return: number;
  market: FantasyMarket;
};

/**
 * Indicative cash-out value per open single pick, priced off the CURRENT book
 * (the active snapshot at the current event version) with NO forced reprice —
 * that's reserved for the firm, time-limited offer on tap. Mirrors
 * requestCashout's eligibility gates; anything ineligible maps to null. Batched
 * per event so a page of picks costs a handful of queries.
 */
export async function estimateSingleCashouts(
  picks: EstimatePick[]
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const byEvent = new Map<string, EstimatePick[]>();
  for (const p of picks) {
    out.set(p.id, null);
    const list = byEvent.get(p.event_id) ?? [];
    list.push(p);
    byEvent.set(p.event_id, list);
  }
  for (const [eventId, evPicks] of byEvent) {
    const { data: stateRow } = await supabaseAdmin
      .from("fantasy_event_state")
      .select("version, is_final")
      .eq("event_id", eventId)
      .maybeSingle();
    const state = stateRow as { version: number; is_final: boolean } | null;
    if (!state || state.is_final) continue;
    const version = state.version;

    let live: Awaited<ReturnType<typeof loadPlacementContext>>["live"];
    try {
      ({ live } = await loadPlacementContext(eventId));
    } catch {
      continue;
    }

    const marketIds = [...new Set(evPicks.map((p) => p.market_id))];
    const { data: snaps } = await supabaseAdmin
      .from("fantasy_odds_snapshots")
      .select("market_id, selection_key, probability")
      .eq("event_id", eventId)
      .eq("event_version", version)
      .eq("status", "active")
      .in("market_id", marketIds);
    const probByKey = new Map<string, number>();
    for (const s of (snaps ?? []) as {
      market_id: string; selection_key: string; probability: number;
    }[]) {
      probByKey.set(`${s.market_id}|${s.selection_key}`, Number(s.probability));
    }

    for (const p of evPicks) {
      const market = p.market;
      if (!market || market.status !== "open") continue;
      const def = getMarketDefinition(market.market_type);
      if (!def || !def.eligibleForCashout) continue;
      if (def.isSelfDependent(market, p.selection_key, p.profile_id, live)) continue;
      if (!def.cashoutCutoff(market, p.selection_key, live).eligible) continue;
      const prob = probByKey.get(`${p.market_id}|${p.selection_key}`);
      if (prob == null || prob <= PROBABILITY_FLOOR || prob >= PROBABILITY_CEILING) continue;
      const value = computeCashoutValue(prob, Number(p.potential_return));
      if (value >= 0.01) out.set(p.id, value);
    }
  }
  return out;
}

export async function acceptCashout(params: {
  profileId: string;
  offerId: string;
}): Promise<{ value: number }> {
  // Offers are unified: pick offers and acca (parlay) offers share the table
  // and this endpoint — dispatch to the matching accept RPC.
  const { data: offerRow, error: offerErr } = await supabaseAdmin
    .from("fantasy_cashout_offers")
    .select("pick_id, parlay_id")
    .eq("id", params.offerId)
    .maybeSingle();
  if (offerErr) throw offerErr;
  if (!offerRow) throw new PickError("Offer not found", 404);
  const isParlay = (offerRow as { parlay_id: string | null }).parlay_id != null;

  const { data, error } = await supabaseAdmin.rpc(
    isParlay ? "ciaga_fantasy_accept_parlay_cashout" : "ciaga_fantasy_accept_cashout",
    {
      p_offer_id: params.offerId,
      p_profile_id: params.profileId,
    }
  );
  if (error) throw new PickError(error.message.replace(/^.*?: /, ""), 400);
  return { value: Number((data as { value: number }).value) };
}
