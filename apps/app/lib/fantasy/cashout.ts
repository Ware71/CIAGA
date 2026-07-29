import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readFantasyConfig } from "@/lib/fantasy/config";
import { getMarketDefinition } from "@/lib/fantasy/markets/registry";
import { selectionIsFrozen, type FantasyMarket } from "@/lib/fantasy/markets/types";
import { loadPlacementContext, refreshIfStale } from "@/lib/fantasy/odds";
import { PickError } from "@/lib/fantasy/picks";
import { getGroupFantasyContext } from "@/lib/fantasy/wallet";
import { scoreSelectionProbability } from "@/lib/fantasy/markets/analytic";
import {
  PROBABILITY_CEILING,
  PROBABILITY_FLOOR,
} from "@/lib/fantasy/simulation/types";

/**
 * Markets whose offered selections drift each refresh (score_band / score_total):
 * a placed pick's band/value may no longer be an offered snapshot, so its current
 * probability is priced from the persisted exact-score pmf (`fantasy_score_pmfs`)
 * — the "cumulative of the exact scores" — which also makes cash-out track drift.
 */
export const DRIFT_MARKETS = new Set(["score_band", "score_total"]);

export function pmfBasis(market: FantasyMarket): "gross" | "net" {
  return (market.params as { basis?: unknown }).basis === "net" ? "net" : "gross";
}

/** Current probability of a drift-market pick from its own pmf row, or null. */
async function driftPickProbability(
  eventId: string,
  market: FantasyMarket,
  selectionKey: string,
  version: number
): Promise<number | null> {
  if (!DRIFT_MARKETS.has(market.market_type) || !market.subject_profile_id) return null;
  const { data } = await supabaseAdmin
    .from("fantasy_score_pmfs")
    .select("pmf_min, pmf_probs, event_version")
    .eq("event_id", eventId)
    .eq("profile_id", market.subject_profile_id)
    .eq("basis", pmfBasis(market))
    .maybeSingle();
  const row = data as { pmf_min: number; pmf_probs: number[]; event_version: number } | null;
  if (!row || row.event_version !== version) return null;
  return scoreSelectionProbability(market.market_type, selectionKey, {
    min: row.pmf_min,
    probs: row.pmf_probs,
  });
}

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
  // Quoting a frozen player would price off holes the ceremony is hiding — and
  // the quote itself would tell the punter how those holes went.
  if (selectionIsFrozen(market, pick.selection_key, live)) {
    throw new PickError(
      "Cash-out is unavailable — that player's leaderboard is frozen for the ceremony"
    );
  }
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

  // Drift markets (score_band/score_total) price the pick's OWN band/value from
  // the current exact-score pmf; everything else reads the pick's snapshot.
  let probability = await driftPickProbability(pick.event_id, market, pick.selection_key, version);
  if (probability == null) {
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
    probability = Number((snapRow as { probability: number }).probability);
  }
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
    // Pinning event_version exactly used to blank every button mid-round: each
    // score bumps the version, so between the bump and the next reprice NO
    // snapshot matched and the whole board's estimates went null — while the
    // firm quote (which force-refreshes) still priced fine. The estimate is
    // indicative only, so serve the freshest snapshot available and let the
    // firm quote be the one that insists on the current version.
    const { data: snaps } = await supabaseAdmin
      .from("fantasy_odds_snapshots")
      .select("market_id, selection_key, probability, event_version")
      .eq("event_id", eventId)
      .lte("event_version", version)
      .eq("status", "active")
      .in("market_id", marketIds)
      .order("event_version", { ascending: true });
    const probByKey = new Map<string, number>();
    for (const s of (snaps ?? []) as {
      market_id: string; selection_key: string; probability: number; event_version: number;
    }[]) {
      // Ascending version order → the last write per key is the newest.
      probByKey.set(`${s.market_id}|${s.selection_key}`, Number(s.probability));
    }

    // Drift-market picks price off the exact-score pmf (their band/value may not
    // be an offered snapshot). Batch-load the event's current pmfs once.
    const hasDrift = evPicks.some((p) => p.market && DRIFT_MARKETS.has(p.market.market_type));
    const pmfByKey = new Map<string, { min: number; probs: number[] }>();
    if (hasDrift) {
      // Same relaxation as the snapshots above — freshest available, not exact.
      const { data: pmfs } = await supabaseAdmin
        .from("fantasy_score_pmfs")
        .select("profile_id, basis, pmf_min, pmf_probs, event_version")
        .eq("event_id", eventId)
        .lte("event_version", version)
        .order("event_version", { ascending: true });
      for (const r of (pmfs ?? []) as {
        profile_id: string; basis: string; pmf_min: number; pmf_probs: number[];
      }[]) {
        pmfByKey.set(`${r.profile_id}|${r.basis}`, { min: r.pmf_min, probs: r.pmf_probs });
      }
    }

    for (const p of evPicks) {
      const market = p.market;
      if (!market || market.status !== "open") continue;
      const def = getMarketDefinition(market.market_type);
      if (!def || !def.eligibleForCashout) continue;
      if (selectionIsFrozen(market, p.selection_key, live)) continue;
      if (def.isSelfDependent(market, p.selection_key, p.profile_id, live)) continue;
      if (!def.cashoutCutoff(market, p.selection_key, live).eligible) continue;
      let prob: number | null | undefined;
      if (DRIFT_MARKETS.has(market.market_type) && market.subject_profile_id) {
        const pmf = pmfByKey.get(`${market.subject_profile_id}|${pmfBasis(market)}`);
        prob = pmf ? scoreSelectionProbability(market.market_type, p.selection_key, pmf) : null;
      }
      if (prob == null) prob = probByKey.get(`${p.market_id}|${p.selection_key}`);
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
