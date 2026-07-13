import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readFantasyConfig } from "@/lib/fantasy/config";
import {
  CASHOUT_DISCOUNT,
  CASHOUT_OFFER_TTL_MS,
  computeCashoutValue,
} from "@/lib/fantasy/cashout";
import { getMarketDefinition } from "@/lib/fantasy/markets/registry";
import type { FantasyMarket } from "@/lib/fantasy/markets/types";
import { loadPlacementContext, refreshIfStale } from "@/lib/fantasy/odds";
import { matrixLegFor } from "@/lib/fantasy/parlays";
import { rankingBasisFromScoringModel } from "@/lib/fantasy/parlayRules";
import { PickError } from "@/lib/fantasy/picks";
import { getGroupFantasyContext } from "@/lib/fantasy/wallet";
import { COMBO_BET } from "@/lib/fantasy/terminology";
import { loadJointMatrices } from "@/lib/fantasy/jointSamples";
import type { JointBundle } from "@/lib/fantasy/simulation/jointBundle";
import { bundleCapabilities } from "@/lib/fantasy/simulation/jointBundle";
import {
  jointProbability,
  MIN_JOINT_SUPPORT,
  type MatrixLeg,
} from "@/lib/fantasy/simulation/jointPricing";
import {
  PROBABILITY_CEILING,
  PROBABILITY_FLOOR,
} from "@/lib/fantasy/simulation/types";

/**
 * Acca cash-out: quote = P(every still-open leg wins) × effective return ×
 * 0.90, offered for ~15s against a pinned parlay_version + one pinned event
 * version PER event with an open leg (an acca can span events). Won legs are
 * banked (p = 1, their odds already inside the return); a lost leg means the
 * acca is dead; void legs drop to odds 1.0. The joint probability comes from
 * the same extended joint-sample bundles that priced the acca.
 */

export type ParlayLegRow = {
  id: string;
  market_id: string;
  event_id: string;
  selection_key: string;
  decimal_odds: number | string;
  status: "open" | "won" | "lost" | "void";
};

/**
 * What the settle RPC would pay if every still-open leg won — the base the
 * cash-out quote discounts from.
 *
 *   non-joint:            stake × Π(won legs' odds) × Π(open legs' odds)
 *                         (void legs contribute 1.0 — mirrors settlement)
 *   joint, no void legs:  the locked potential_return (stake × joint price)
 *   joint, ≥1 void leg:   the stake — settlement VOIDS a joint-priced acca
 *                         with a withdrawn player (refund), so the best case
 *                         is the stake back; P(open legs win) is then a
 *                         conservative lower bound on P(refund).
 */
export function effectiveParlayReturn(
  parlay: { stake: number; potential_return: number; joint_priced: boolean },
  legs: Pick<ParlayLegRow, "status" | "decimal_odds">[]
): number {
  const anyVoid = legs.some((l) => l.status === "void");
  if (parlay.joint_priced) {
    return anyVoid ? parlay.stake : parlay.potential_return;
  }
  let odds = 1;
  for (const leg of legs) {
    if (leg.status === "won" || leg.status === "open") odds *= Number(leg.decimal_odds);
  }
  return Math.round(parlay.stake * odds * 100) / 100;
}

export type OpenLegForPricing = {
  eventId: string;
  /** Fresh snapshot probability at the pinned event version. */
  probability: number;
  /** Present when the leg is bundle-expressible (see matrixLegFor). */
  matrixLeg?: MatrixLeg;
};

/**
 * P(all open legs win). Per event, ≥2 bundle-expressible legs are counted
 * jointly (raw count/simCount — probability domain, no odds-ladder rounding,
 * mirroring the single-pick path); a missing bundle, an inexpressible leg or
 * sub-support joint falls back to the product of the legs' marginal
 * probabilities. For positively-correlated legs the product UNDERSTATES the
 * joint, so the fallback under-quotes — never over-pays. Events multiply
 * (independent).
 */
export function combineOpenLegProbability(
  legs: OpenLegForPricing[],
  bundles: Map<string, JointBundle>
): number {
  let p = 1;
  const byEvent = new Map<string, OpenLegForPricing[]>();
  for (const leg of legs) {
    if (!leg.matrixLeg) {
      p *= leg.probability;
      continue;
    }
    const list = byEvent.get(leg.eventId) ?? [];
    list.push(leg);
    byEvent.set(leg.eventId, list);
  }
  for (const [eventId, corrLegs] of byEvent) {
    if (corrLegs.length === 1) {
      p *= corrLegs[0].probability;
      continue;
    }
    const bundle = bundles.get(eventId);
    const joint = bundle
      ? jointProbability(bundle, corrLegs.map((l) => l.matrixLeg as MatrixLeg))
      : null;
    if (joint === null || joint.support < MIN_JOINT_SUPPORT) {
      for (const l of corrLegs) p *= l.probability;
      continue;
    }
    p *= joint.p;
  }
  return p;
}

export type ParlayCashoutOffer = {
  id: string;
  parlay_id: string;
  offer_value: number;
  probability: number;
  expires_at: string;
  status: string;
};

type ParlayRow = {
  id: string;
  group_id: string;
  profile_id: string;
  stake: number | string;
  potential_return: number | string;
  status: string;
  joint_priced: boolean;
  parlay_version: number;
  group_season_id: string | null;
  event_id: string | null;
  legs: ParlayLegRow[];
};

export async function requestParlayCashout(params: {
  profileId: string;
  parlayId: string;
}): Promise<{ offer: ParlayCashoutOffer }> {
  const { data: parlayRow, error: parlayErr } = await supabaseAdmin
    .from("fantasy_parlays")
    .select("*, legs:fantasy_parlay_legs(*)")
    .eq("id", params.parlayId)
    .maybeSingle();
  if (parlayErr) throw parlayErr;
  const parlay = parlayRow as ParlayRow | null;
  if (!parlay) throw new PickError(`${COMBO_BET.long} not found`, 404);
  if (parlay.profile_id !== params.profileId) {
    throw new PickError(`Not your ${COMBO_BET.short}`, 403);
  }
  if (parlay.status !== "open") {
    throw new PickError(`${COMBO_BET.long} is no longer open`);
  }

  const ctx = await getGroupFantasyContext(parlay.group_id);
  if (!ctx || !readFantasyConfig(ctx.fantasyConfig)) {
    throw new PickError("Fantasy picks are not enabled for this group");
  }

  const legs = parlay.legs ?? [];
  if (legs.some((l) => l.status === "lost")) {
    throw new PickError(`A leg has already lost — this ${COMBO_BET.short} can't be cashed out`);
  }
  const openLegs = legs.filter((l) => l.status === "open");
  if (openLegs.length === 0) {
    throw new PickError(`${COMBO_BET.long} is settling — nothing left to cash out`);
  }
  const openEventIds = [...new Set(openLegs.map((l) => l.event_id))];

  // Per-event gates: fantasy active and not final.
  for (const eventId of openEventIds) {
    const { data: stateRow } = await supabaseAdmin
      .from("fantasy_event_state")
      .select("version, is_final")
      .eq("event_id", eventId)
      .maybeSingle();
    if (!stateRow) throw new PickError("Fantasy is not active for an event in this acca");
    if ((stateRow as { is_final: boolean }).is_final) {
      throw new PickError("An event in this acca is settled — cash-out is closed");
    }
  }

  // Per-leg gates via the registry (same pipeline as single-pick cash-out —
  // any failing open leg blocks the whole quote with its reason).
  const marketIds = [...new Set(openLegs.map((l) => l.market_id))];
  const { data: marketData, error: marketErr } = await supabaseAdmin
    .from("fantasy_markets")
    .select("*")
    .in("id", marketIds);
  if (marketErr) throw marketErr;
  const markets = new Map(((marketData ?? []) as FantasyMarket[]).map((m) => [m.id, m]));

  const liveByEvent = new Map<
    string,
    Awaited<ReturnType<typeof loadPlacementContext>>
  >();
  for (const eventId of openEventIds) {
    liveByEvent.set(eventId, await loadPlacementContext(eventId));
  }

  for (const leg of openLegs) {
    const market = markets.get(leg.market_id);
    if (!market) throw new PickError("Market not found", 404);
    if (market.status === "settled" || market.status === "void") {
      throw new PickError("A market in this acca is settled");
    }
    if (market.status === "suspended") {
      throw new PickError("A market in this acca is suspended — cash-out is unavailable");
    }
    const def = getMarketDefinition(market.market_type);
    if (!def) throw new PickError("Unknown market type");
    if (!def.eligibleForCashout) {
      throw new PickError("A market in this acca doesn't support cash-out");
    }
    const { live } = liveByEvent.get(leg.event_id)!;
    if (def.isSelfDependent(market, leg.selection_key, params.profileId, live)) {
      throw new PickError(
        "Cash-out is unavailable — your own next score could decide a leg"
      );
    }
    const cutoff = def.cashoutCutoff(market, leg.selection_key, live);
    if (!cutoff.eligible) {
      throw new PickError(`Cash-out is unavailable — ${cutoff.reason.toLowerCase()}`);
    }
  }

  // Reuse a live quote when nothing has moved (compared after the refresh).
  const { data: existing } = await supabaseAdmin
    .from("fantasy_cashout_offers")
    .select("*")
    .eq("parlay_id", parlay.id)
    .eq("status", "offered")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Cash-out requests bypass the debounce — price EVERY open-leg event on
  // fresh odds (multi-event accas run the sims sequentially).
  for (const eventId of openEventIds) {
    const refreshResult = await refreshIfStale(eventId, { force: true });
    if (!refreshResult.refreshed && refreshResult.refreshing) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const { data: recheck } = await supabaseAdmin
        .from("fantasy_event_state")
        .select("odds_stale")
        .eq("event_id", eventId)
        .single();
      if ((recheck as { odds_stale: boolean } | null)?.odds_stale) {
        throw new PickError("Odds are being refreshed — try again in a few seconds", 409);
      }
    }
  }

  // Pin every event's version — all must be unmoved at accept.
  const eventVersions: Record<string, number> = {};
  for (const eventId of openEventIds) {
    const { data: freshState, error: freshErr } = await supabaseAdmin
      .from("fantasy_event_state")
      .select("version")
      .eq("event_id", eventId)
      .single();
    if (freshErr) throw freshErr;
    eventVersions[eventId] = Number((freshState as { version: number }).version);
  }

  if (existing) {
    const row = existing as { parlay_version: number; event_versions: Record<string, number> };
    const sameVersions =
      row.parlay_version === parlay.parlay_version &&
      Object.keys(eventVersions).length === Object.keys(row.event_versions ?? {}).length &&
      Object.entries(eventVersions).every(([k, v]) => Number(row.event_versions?.[k]) === v);
    if (sameVersions) return { offer: existing as ParlayCashoutOffer };
  }

  // Fresh snapshot probability per open leg at its pinned version.
  const legProbabilities = new Map<string, number>();
  for (const leg of openLegs) {
    const { data: snapRow, error: snapErr } = await supabaseAdmin
      .from("fantasy_odds_snapshots")
      .select("probability")
      .eq("market_id", leg.market_id)
      .eq("selection_key", leg.selection_key)
      .eq("event_version", eventVersions[leg.event_id])
      .eq("status", "active")
      .maybeSingle();
    if (snapErr) throw snapErr;
    if (!snapRow) {
      throw new PickError("No current odds for a leg — try again shortly", 409);
    }
    legProbabilities.set(leg.id, Number((snapRow as { probability: number }).probability));
  }

  // Joint bundles — each must match the version we just pinned (a mismatch
  // means another refresh landed between reads; quote against it and the
  // accept-time version check could never pass).
  const bundles = await loadJointMatrices(openEventIds);
  for (const [eventId, bundle] of bundles) {
    if (bundle.eventVersion != null && bundle.eventVersion !== eventVersions[eventId]) {
      throw new PickError("Odds are being refreshed — try again in a few seconds", 409);
    }
  }

  const pricingLegs: OpenLegForPricing[] = openLegs.map((leg) => {
    const market = markets.get(leg.market_id)!;
    const placement = liveByEvent.get(leg.event_id)!;
    const basis = rankingBasisFromScoringModel(placement.event.scoring_model);
    const caps = bundleCapabilities(bundles.get(leg.event_id));
    return {
      eventId: leg.event_id,
      probability: legProbabilities.get(leg.id)!,
      matrixLeg: matrixLegFor(market, leg.selection_key, basis, caps) ?? undefined,
    };
  });
  const pJoint = combineOpenLegProbability(pricingLegs, bundles);
  if (pJoint <= PROBABILITY_FLOOR || pJoint >= PROBABILITY_CEILING) {
    throw new PickError("Cash-out is unavailable — market is already decided");
  }

  const effReturn = effectiveParlayReturn(
    {
      stake: Number(parlay.stake),
      potential_return: Number(parlay.potential_return),
      joint_priced: parlay.joint_priced,
    },
    legs
  );
  const value = computeCashoutValue(pJoint, effReturn);
  if (value < 0.01) {
    throw new PickError("Cash-out value is too low to offer");
  }

  const { data: offerRow, error: offerErr } = await supabaseAdmin
    .from("fantasy_cashout_offers")
    .insert({
      parlay_id: parlay.id,
      group_id: parlay.group_id,
      parlay_version: parlay.parlay_version,
      event_versions: eventVersions,
      offer_value: value,
      probability: pJoint,
      discount_factor: CASHOUT_DISCOUNT,
      status: "offered",
      expires_at: new Date(Date.now() + CASHOUT_OFFER_TTL_MS).toISOString(),
    })
    .select("*")
    .single();
  if (offerErr) throw offerErr;

  return { offer: offerRow as ParlayCashoutOffer };
}
