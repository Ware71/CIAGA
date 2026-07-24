import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readFantasyConfig } from "@/lib/fantasy/config";
import {
  CASHOUT_DISCOUNT,
  CASHOUT_OFFER_TTL_MS,
  computeCashoutValue,
} from "@/lib/fantasy/cashout";
import { PickError } from "@/lib/fantasy/picks";
import { refreshSeasonIfStale } from "@/lib/fantasy/seasonOdds";
import { getGroupFantasyContext } from "@/lib/fantasy/wallet";
import {
  PROBABILITY_CEILING,
  PROBABILITY_FLOOR,
} from "@/lib/fantasy/simulation/types";

/**
 * Season cash-out: quote = CurrentProbability × PotentialReturn × 0.90, offered
 * for ~15s against a pinned (season_version, pick_version). Mirrors the event
 * single-pick path (lib/fantasy/cashout.ts); season markets have no
 * self-dependency to guard, and the "book" is fantasy_season_odds_snapshots
 * (P(win) / P(top-N)) rather than the per-event odds book.
 */

export type SeasonCashoutOffer = {
  id: string;
  season_pick_id: string;
  offer_value: number;
  probability: number;
  expires_at: string;
  status: string;
};

type SeasonPickRow = {
  id: string;
  season_market_id: string;
  group_season_id: string;
  group_id: string;
  profile_id: string;
  selection_key: string;
  potential_return: number;
  pick_version: number;
  status: string;
};

export async function requestSeasonCashout(params: {
  profileId: string;
  seasonPickId: string;
}): Promise<{ offer: SeasonCashoutOffer }> {
  const { data: pickRow, error: pickErr } = await supabaseAdmin
    .from("fantasy_season_picks")
    .select("*")
    .eq("id", params.seasonPickId)
    .maybeSingle();
  if (pickErr) throw pickErr;
  const pick = pickRow as SeasonPickRow | null;
  if (!pick) throw new PickError("Pick not found", 404);
  if (pick.profile_id !== params.profileId) throw new PickError("Not your pick", 403);
  if (pick.status !== "open") throw new PickError("Pick is no longer open");

  const ctx = await getGroupFantasyContext(pick.group_id);
  if (!ctx || !readFantasyConfig(ctx.fantasyConfig)) {
    throw new PickError("Fantasy picks are not enabled for this group");
  }

  const { data: marketRow } = await supabaseAdmin
    .from("fantasy_season_markets")
    .select("status")
    .eq("id", pick.season_market_id)
    .maybeSingle();
  const marketStatus = (marketRow as { status: string } | null)?.status;
  if (!marketStatus) throw new PickError("Market not found", 404);
  if (marketStatus !== "open") throw new PickError("Market is settled — cash-out is closed");

  const { data: stateRow } = await supabaseAdmin
    .from("fantasy_season_state")
    .select("version, odds_stale, is_final")
    .eq("group_season_id", pick.group_season_id)
    .maybeSingle();
  const state = stateRow as { version: number; odds_stale: boolean; is_final: boolean } | null;
  if (!state) throw new PickError("Season markets are not active");
  if (state.is_final) throw new PickError("Season is settled — cash-out is closed");

  // Reuse a live quote when nothing has moved.
  const { data: existing } = await supabaseAdmin
    .from("fantasy_season_cashout_offers")
    .select("*")
    .eq("season_pick_id", pick.id)
    .eq("status", "offered")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Season odds only change on a constituent-event completion (marked stale by
  // trigger); price on the freshest book — refresh if the flag is set.
  if (state.odds_stale) await refreshSeasonIfStale(pick.group_season_id);

  const { data: freshState, error: freshErr } = await supabaseAdmin
    .from("fantasy_season_state")
    .select("version")
    .eq("group_season_id", pick.group_season_id)
    .single();
  if (freshErr) throw freshErr;
  const version = Number((freshState as { version: number }).version);

  if (
    existing &&
    Number((existing as { season_version: number }).season_version) === version &&
    Number((existing as { pick_version: number }).pick_version) === pick.pick_version
  ) {
    return { offer: existing as SeasonCashoutOffer };
  }

  const { data: snapRow, error: snapErr } = await supabaseAdmin
    .from("fantasy_season_odds_snapshots")
    .select("probability")
    .eq("season_market_id", pick.season_market_id)
    .eq("selection_key", pick.selection_key)
    .eq("season_version", version)
    .eq("status", "active")
    .maybeSingle();
  if (snapErr) throw snapErr;
  if (!snapRow) throw new PickError("No current odds for this pick — try again shortly", 409);

  const probability = Number((snapRow as { probability: number }).probability);
  if (probability <= PROBABILITY_FLOOR || probability >= PROBABILITY_CEILING) {
    throw new PickError("Cash-out is unavailable — market is already decided");
  }

  const value = computeCashoutValue(probability, Number(pick.potential_return));
  if (value < 0.01) throw new PickError("Cash-out value is too low to offer");

  const { data: offerRow, error: offerErr } = await supabaseAdmin
    .from("fantasy_season_cashout_offers")
    .insert({
      season_pick_id: pick.id,
      group_id: pick.group_id,
      group_season_id: pick.group_season_id,
      season_version: version,
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

  return { offer: offerRow as SeasonCashoutOffer };
}

export async function acceptSeasonCashout(params: {
  profileId: string;
  offerId: string;
}): Promise<{ value: number }> {
  const { data, error } = await supabaseAdmin.rpc("ciaga_fantasy_accept_season_cashout", {
    p_offer_id: params.offerId,
    p_profile_id: params.profileId,
  });
  if (error) throw new PickError(error.message.replace(/^.*?: /, ""), 400);
  return { value: Number((data as { value: number }).value) };
}

export type EstimateSeasonPick = {
  id: string;
  group_season_id: string;
  season_market_id: string;
  selection_key: string;
  potential_return: number;
  status: string;
  market_status: string;
};

/**
 * Indicative season cash-out value per open pick from the CURRENT season book
 * (no forced reprice — that's the firm on-tap offer). Batched per season.
 */
export async function estimateSeasonCashouts(
  picks: EstimateSeasonPick[]
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const bySeason = new Map<string, EstimateSeasonPick[]>();
  for (const p of picks) {
    out.set(p.id, null);
    const list = bySeason.get(p.group_season_id) ?? [];
    list.push(p);
    bySeason.set(p.group_season_id, list);
  }
  for (const [groupSeasonId, seasonPicks] of bySeason) {
    const { data: stateRow } = await supabaseAdmin
      .from("fantasy_season_state")
      .select("version, is_final")
      .eq("group_season_id", groupSeasonId)
      .maybeSingle();
    const state = stateRow as { version: number; is_final: boolean } | null;
    if (!state || state.is_final) continue;

    const marketIds = [...new Set(seasonPicks.map((p) => p.season_market_id))];
    const { data: snaps } = await supabaseAdmin
      .from("fantasy_season_odds_snapshots")
      .select("season_market_id, selection_key, probability")
      .eq("group_season_id", groupSeasonId)
      .eq("season_version", state.version)
      .eq("status", "active")
      .in("season_market_id", marketIds);
    const probByKey = new Map<string, number>();
    for (const s of (snaps ?? []) as {
      season_market_id: string; selection_key: string; probability: number;
    }[]) {
      probByKey.set(`${s.season_market_id}|${s.selection_key}`, Number(s.probability));
    }

    for (const p of seasonPicks) {
      if (p.market_status !== "open") continue;
      const prob = probByKey.get(`${p.season_market_id}|${p.selection_key}`);
      if (prob == null || prob <= PROBABILITY_FLOOR || prob >= PROBABILITY_CEILING) continue;
      const value = computeCashoutValue(prob, Number(p.potential_return));
      if (value >= 0.01) out.set(p.id, value);
    }
  }
  return out;
}
