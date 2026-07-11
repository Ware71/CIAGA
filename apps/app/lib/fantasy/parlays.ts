import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parsePointsAmount, readFantasyConfig } from "@/lib/fantasy/config";
import { getMarketDefinition } from "@/lib/fantasy/markets/registry";
import type { FantasyMarket } from "@/lib/fantasy/markets/types";
import { loadPlacementContext } from "@/lib/fantasy/odds";
import { PickError } from "@/lib/fantasy/picks";
import {
  ensureBudgetGrant,
  getGroupFantasyContext,
  resolveWalletScope,
} from "@/lib/fantasy/wallet";
import { COMBO_BET } from "@/lib/fantasy/terminology";
import {
  findParlayViolation,
  isCorrelatedFamily,
  isMatrixExpressible,
  MAX_LEGS,
  MIN_LEGS,
  rankingBasisFromScoringModel,
  subjectKeysFor,
} from "@/lib/fantasy/parlayRules";
import { findSelfRestriction } from "@/lib/fantasy/selfRestriction";
import type { RankingBasis } from "@/lib/fantasy/simulation/types";
import {
  combineAcca,
  type AccaLegForPricing,
  type MatrixLeg,
} from "@/lib/fantasy/simulation/jointPricing";
import { loadJointMatrices } from "@/lib/fantasy/jointSamples";

/**
 * Resolve a correlated-family leg (finishing positions / h2h) to the player(s)
 * it concerns, for joint pricing. Null when the leg can't be priced from the
 * event's positions matrix (round-scoped, or h2h off the ranking basis) — the
 * rules layer guarantees such legs never overlap another correlated leg.
 */
function matrixLegFor(
  market: FantasyMarket,
  selectionKey: string,
  eventRankingBasis: RankingBasis | undefined
): MatrixLeg | null {
  if (!isCorrelatedFamily(market.market_type)) return null;
  const params = (market.params ?? {}) as Record<string, unknown>;
  if (!isMatrixExpressible({ marketType: market.market_type, params, eventRankingBasis })) {
    return null;
  }
  if (market.market_type === "h2h") {
    if (!market.subject_profile_id || !market.opponent_profile_id) return null;
    return {
      marketType: market.market_type,
      params,
      playerId: market.subject_profile_id,
      opponentId: market.opponent_profile_id,
      selectionKey,
    };
  }
  const playerId =
    market.market_type === "finish_position" ? market.subject_profile_id : selectionKey;
  if (!playerId) return null;
  return { marketType: market.market_type, params, playerId, selectionKey };
}

/**
 * Accumulator (internal: parlay) orchestration. Game rules run here via the
 * registry (+ shared parlayRules); money invariants (balance, per-leg
 * anti-sniping, correlation guard, atomicity) live in
 * ciaga_fantasy_place_parlay.
 */

export type ParlayLegInput = {
  marketId: string;
  selectionKey: string;
  snapshotId: string;
};

export async function placeParlay(params: {
  profileId: string;
  legs: ParlayLegInput[];
  stake: unknown;
}): Promise<{ parlayId: string }> {
  const stake = parsePointsAmount(params.stake);
  if (stake === null) throw new PickError("Stake must be a whole number of points (min 1)");
  if (params.legs.length < MIN_LEGS || params.legs.length > MAX_LEGS) {
    throw new PickError(`An ${COMBO_BET.short} needs between ${MIN_LEGS} and ${MAX_LEGS} legs`);
  }

  // Legs may share a market row (e.g. two players in one Top-3 market), so
  // query by DISTINCT market id but keep every leg.
  const marketIds = [...new Set(params.legs.map((l) => l.marketId))];
  const { data: marketData, error: marketErr } = await supabaseAdmin
    .from("fantasy_markets")
    .select("*")
    .in("id", marketIds);
  if (marketErr) throw marketErr;
  const markets = new Map(((marketData ?? []) as FantasyMarket[]).map((m) => [m.id, m]));
  if (markets.size !== marketIds.length) throw new PickError("Market not found", 404);

  const groupIds = new Set([...markets.values()].map((m) => m.group_id));
  if (groupIds.size !== 1) {
    throw new PickError(`All ${COMBO_BET.short} legs must come from the same group`);
  }
  const groupId = [...groupIds][0];

  const ctx = await getGroupFantasyContext(groupId);
  const config = ctx ? readFantasyConfig(ctx.fantasyConfig) : null;
  if (!config) throw new PickError("Fantasy picks are not enabled for this group");

  // Per-event placement eligibility via the registry (one context per event).
  const eventIds = [...new Set([...markets.values()].map((m) => m.event_id))];
  if (config.budgetScope === "event" && eventIds.length > 1) {
    throw new PickError(
      `This group budgets per event — ${COMBO_BET.short} legs must all be from one event`
    );
  }
  const liveByEvent = new Map<string, Awaited<ReturnType<typeof loadPlacementContext>>["live"]>();
  const basisByEvent = new Map<string, RankingBasis>();
  for (const eventId of eventIds) {
    const placement = await loadPlacementContext(eventId);
    liveByEvent.set(eventId, placement.live);
    basisByEvent.set(eventId, rankingBasisFromScoringModel(placement.event.scoring_model));
  }

  const rpcLegs = params.legs.map((leg) => {
    const market = markets.get(leg.marketId)!;
    const def = getMarketDefinition(market.market_type);
    if (!def) throw new PickError("Unknown market type");
    if (market.status !== "open") throw new PickError("A market in this acca is no longer open");
    const live = liveByEvent.get(market.event_id)!;
    if (!def.placementAllowed(market, leg.selectionKey, live)) {
      throw new PickError("A selection in this acca can no longer be backed");
    }
    const selfBlocked = findSelfRestriction(params.profileId, market, leg.selectionKey);
    if (selfBlocked) throw new PickError(selfBlocked);
    return {
      market_id: leg.marketId,
      selection_key: leg.selectionKey,
      snapshot_id: leg.snapshotId,
      subject_keys: subjectKeysFor(market, leg.selectionKey),
    };
  });

  // Co-occurrence rules: one player per event across the finishing markets, no
  // two exclusive slots, no exact dupes, no infeasible or contradictory
  // finishing claims, and correlated overlaps (position + h2h on one player)
  // only where the matrix can price them. Independent legs combine freely.
  const violation = findParlayViolation(
    params.legs.map((leg) => {
      const market = markets.get(leg.marketId)!;
      return {
        eventId: market.event_id,
        marketId: leg.marketId,
        marketType: market.market_type,
        params: (market.params ?? {}) as Record<string, unknown>,
        subjectKeys: subjectKeysFor(market, leg.selectionKey),
        selectionKey: leg.selectionKey,
        subjectProfileId: market.subject_profile_id,
        opponentProfileId: market.opponent_profile_id,
        eventRankingBasis: basisByEvent.get(market.event_id),
      };
    })
  );
  if (violation) throw new PickError(violation);

  // Combined odds: correlated legs (finishing positions + eligible h2h)
  // jointly priced from the retained per-iteration matrices; independent legs
  // multiply in. A zero joint count means the legs contradict — reject rather
  // than price the impossible at the cap.
  const { combinedOdds: combined, jointPriced, infeasible } = await priceAcca(params.legs);
  if (infeasible) throw new PickError("Those selections can't all land together");

  const scope = await resolveWalletScope(groupId, config, eventIds[0]);
  await ensureBudgetGrant(groupId, params.profileId, config, scope);

  const { data: parlayId, error: rpcErr } = await supabaseAdmin.rpc("ciaga_fantasy_place_parlay", {
    p_profile_id: params.profileId,
    p_group_id: groupId,
    p_stake: stake,
    p_legs: rpcLegs,
    p_group_season_id: scope.kind === "season" ? scope.groupSeasonId : null,
    p_scope_event: scope.kind === "event",
    p_combined_odds: combined,
    p_joint_priced: jointPriced,
  });
  if (rpcErr) {
    throw new PickError(rpcErr.message.replace(/^.*?: /, ""), 400);
  }

  return { parlayId: parlayId as string };
}

/**
 * Price an acca's legs without placing it (drives the slip's live combined
 * odds). Correlated legs (finishing positions + h2h on the ranking basis) are
 * jointly priced from the retained matrices; everything else multiplies in.
 * Read-only, so no membership/eligibility gate beyond the odds already being
 * visible.
 */
export async function priceAcca(
  legs: ParlayLegInput[]
): Promise<{ combinedOdds: number; jointPriced: boolean; infeasible: boolean }> {
  if (legs.length === 0) return { combinedOdds: 1, jointPriced: false, infeasible: false };
  const marketIds = [...new Set(legs.map((l) => l.marketId))];
  const { data: marketData, error: marketErr } = await supabaseAdmin
    .from("fantasy_markets")
    .select("id, event_id, market_type, subject_profile_id, opponent_profile_id, params")
    .in("id", marketIds);
  if (marketErr) throw marketErr;
  const markets = new Map(((marketData ?? []) as FantasyMarket[]).map((m) => [m.id, m]));
  const eventIds = [...new Set([...markets.values()].map((m) => m.event_id))];

  const { data: eventRows, error: eventErr } = await supabaseAdmin
    .from("events")
    .select("id, scoring_model")
    .in("id", eventIds);
  if (eventErr) throw eventErr;
  const basisByEvent = new Map(
    ((eventRows ?? []) as { id: string; scoring_model: string | null }[]).map((e) => [
      e.id,
      rankingBasisFromScoringModel(e.scoring_model),
    ])
  );

  const { data: snapRows, error: snapErr } = await supabaseAdmin
    .from("fantasy_odds_snapshots")
    .select("id, decimal_odds")
    .in("id", legs.map((l) => l.snapshotId));
  if (snapErr) throw snapErr;
  const oddsBySnap = new Map(
    ((snapRows ?? []) as { id: string; decimal_odds: number | string }[]).map((s) => [
      s.id,
      Number(s.decimal_odds),
    ])
  );

  const matrices = await loadJointMatrices(eventIds);
  const pricingLegs: AccaLegForPricing[] = legs.map((leg) => {
    const market = markets.get(leg.marketId);
    return {
      eventId: market?.event_id ?? "",
      decimalOdds: oddsBySnap.get(leg.snapshotId) ?? 1,
      matrixLeg: market
        ? matrixLegFor(market, leg.selectionKey, basisByEvent.get(market.event_id)) ?? undefined
        : undefined,
    };
  });
  return combineAcca(pricingLegs, matrices);
}

export type MyParlayLeg = {
  id: string;
  market_id: string;
  event_id: string;
  selection_key: string;
  decimal_odds: number;
  status: "open" | "won" | "lost" | "void";
  market_label: string;
  selection_label: string;
  event_name: string;
};

export type MyParlay = {
  id: string;
  group_id: string;
  stake: number;
  combined_decimal_odds: number;
  potential_return: number;
  status: "open" | "won" | "lost" | "void";
  placed_at: string;
  settled_at: string | null;
  group_name: string;
  legs: MyParlayLeg[];
};

export async function getMyParlays(profileId: string): Promise<MyParlay[]> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_parlays")
    .select(
      "*, group:major_groups(id, name), legs:fantasy_parlay_legs(*, market:fantasy_markets(*), event:events(id, name))"
    )
    .eq("profile_id", profileId)
    .order("placed_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const rows = (data ?? []) as any[];

  const nameIds = new Set<string>();
  for (const row of rows) {
    for (const leg of row.legs ?? []) {
      const m = leg.market as FantasyMarket | null;
      if (m?.subject_profile_id) nameIds.add(m.subject_profile_id);
      if (m?.opponent_profile_id) nameIds.add(m.opponent_profile_id);
      if (/^[0-9a-f-]{36}$/i.test(leg.selection_key)) nameIds.add(leg.selection_key);
    }
  }
  const names: Record<string, string> = {};
  if (nameIds.size > 0) {
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, name")
      .in("id", [...nameIds]);
    for (const p of (profs ?? []) as { id: string; name: string | null }[]) {
      names[p.id] = p.name ?? "Player";
    }
  }

  return rows.map((row) => ({
    id: row.id,
    group_id: row.group_id,
    stake: Number(row.stake),
    combined_decimal_odds: Number(row.combined_decimal_odds),
    potential_return: Number(row.potential_return),
    status: row.status,
    placed_at: row.placed_at,
    settled_at: row.settled_at,
    group_name: row.group?.name ?? "",
    legs: ((row.legs ?? []) as any[]).map((leg) => {
      const market = leg.market as FantasyMarket;
      const def = market ? getMarketDefinition(market.market_type) : null;
      return {
        id: leg.id,
        market_id: leg.market_id,
        event_id: leg.event_id,
        selection_key: leg.selection_key,
        decimal_odds: Number(leg.decimal_odds),
        status: leg.status,
        market_label: def && market ? def.displayName(market, names) : market?.market_type ?? "",
        selection_label:
          def && market ? def.selectionLabel(market, leg.selection_key, names) : leg.selection_key,
        event_name: leg.event?.name ?? "Event",
      };
    }),
  }));
}
