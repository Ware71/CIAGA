/**
 * Pure accumulator rules shared by server (placement lib/RPC mirror) and
 * client (slip pre-checks). No server imports allowed here.
 */

import type { RankingBasis } from "@/lib/fantasy/simulation/types";

export const MIN_LEGS = 2;
export const MAX_LEGS = 8;

/**
 * Hard ceiling on an acca's combined price. Guards the DB's numeric(12,2)
 * column (1000⁴ would overflow it) and keeps payouts sane in a points game.
 */
export const MAX_COMBINED_ODDS = 10000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The finishing-position market family. These share one underlying random
 * variable per player (their finishing position), so legs across DIFFERENT
 * players are correlated and get JOINTLY priced from the simulation; legs
 * outside this set are treated as independent and multiplied in.
 */
export const POSITION_FAMILY_TYPES = new Set([
  "outright_winner",
  "top_n",
  "finish_position",
  "finish_range",
]);

export function isPositionFamily(marketType: string): boolean {
  return POSITION_FAMILY_TYPES.has(marketType);
}

/**
 * The correlated family = position family + head-to-heads. An h2h outcome is
 * a function of the same per-player results the positions come from, so a
 * player shared between an h2h leg and any other correlated leg makes the
 * combo POSITIVELY correlated ("X to win" + "X beats Y" ≈ just X to win) —
 * those must be jointly priced or blocked, never multiplied.
 */
export function isCorrelatedFamily(marketType: string): boolean {
  return marketType === "h2h" || isPositionFamily(marketType);
}

/** The exact scoring_model → sim ranking basis mapping the engine uses. */
export function rankingBasisFromScoringModel(
  model: string | null | undefined
): RankingBasis {
  return model === "stableford_points" ? "stableford" : model === "gross" ? "gross" : "net";
}

/**
 * Whether a correlated-family leg can be priced from the retained
 * per-iteration positions matrix. Positions are event-wide on the event's
 * ranking basis, so: round-scoped legs never qualify; h2h legs qualify only
 * when their basis IS the ranking basis (gross h2h in a net-ranked or
 * stableford event compares totals the matrix doesn't retain).
 */
export function isMatrixExpressible(leg: {
  marketType: string;
  params: Record<string, unknown> | null;
  eventRankingBasis?: RankingBasis;
}): boolean {
  const params = (leg.params ?? {}) as { round?: unknown; basis?: unknown };
  if (params.round != null) return false;
  if (leg.marketType === "h2h") {
    return leg.eventRankingBasis != null && params.basis === leg.eventRankingBasis;
  }
  return isPositionFamily(leg.marketType);
}

/**
 * Correlation identities for a leg — the player(s) whose finishing position the
 * leg concerns. Field markets (outright/top-N/ranges) put the SELECTED player
 * as the subject; per-player markets carry subject/opponent ids.
 */
export function subjectKeysFor(
  market: {
    market_type: string;
    subject_profile_id: string | null;
    opponent_profile_id: string | null;
  },
  selectionKey: string
): string[] {
  if (market.market_type === "field_special") return ["field"];
  const keys = new Set<string>();
  if (market.subject_profile_id) keys.add(market.subject_profile_id);
  if (market.opponent_profile_id) keys.add(market.opponent_profile_id);
  // Field markets (outright/top-N/ranges): the SELECTED player is the subject.
  if (UUID_RE.test(selectionKey)) keys.add(selectionKey);
  return [...keys];
}

/**
 * A finishing "slot" that only one player can occupy in an event — two legs
 * claiming the same slot can never both land, so they can't combine (e.g. two
 * outright winners, two wooden spoons, two "exactly 3rd"). Round-scoped
 * outrights claim their round's slot, not the event's (R1 winner + R2 winner
 * is a fine double). Returns null when many players can satisfy the selection
 * (top-N, wide finishing ranges): those combine and are priced from the true
 * joint probability.
 */
export function exclusivitySlot(
  market: { market_type: string; params?: Record<string, unknown> | null },
  selectionKey: string
): string | null {
  const params = (market.params ?? {}) as { kind?: unknown; round?: unknown };
  switch (market.market_type) {
    case "outright_winner":
      return params.round != null ? `winner:r${params.round}` : "winner";
    case "finish_position":
      return `pos:${selectionKey}`; // selection = the exact position
    case "finish_range":
      return params.kind === "last" ? "last" : null; // ranges of width ≥2: many players
    default:
      return null;
  }
}

/**
 * Whether two DIFFERENT selections on the SAME market row can co-occur, i.e.
 * the slip may hold both instead of replacing one. True for field markets where
 * several players can win the same selection (top-N, wide finishing ranges) and
 * for hole scores (each selection is a different hole — birdie-or-better on
 * holes 3 AND 7 is a fine double); false for exclusive rows (outright winner,
 * wooden spoon) and pick-one rows (h2h sides, score bands, over/unders).
 */
export function marketAllowsMultiple(market: {
  market_type: string;
  params?: Record<string, unknown> | null;
}): boolean {
  if (market.market_type === "top_n") return true;
  if (market.market_type === "hole_score") return true;
  if (market.market_type === "finish_range") {
    return (market.params as { kind?: unknown } | null)?.kind !== "last";
  }
  return false;
}

export type ParlayLeg = {
  eventId: string;
  marketId: string;
  marketType: string;
  params: Record<string, unknown> | null;
  /** Player identities from subjectKeysFor. */
  subjectKeys: string[];
  selectionKey: string;
  /** h2h only: which side is which (subjectKeys is unordered). */
  subjectProfileId?: string | null;
  opponentProfileId?: string | null;
  /**
   * The leg's event ranking basis (from rankingBasisFromScoringModel). Absent
   * on stale client slips — h2h legs then count as matrix-inexpressible, which
   * only ever blocks, never misprices.
   */
  eventRankingBasis?: RankingBasis;
};

/** A leg's event-wide finishing-position claim as an inclusive interval. */
function positionClaim(leg: ParlayLeg): { from: number; to: number } | null {
  const params = (leg.params ?? {}) as {
    n?: unknown;
    kind?: unknown;
    from?: unknown;
    to?: unknown;
    round?: unknown;
  };
  if (params.round != null) return null; // round standings, not event positions
  switch (leg.marketType) {
    case "outright_winner":
      return { from: 1, to: 1 };
    case "top_n": {
      const n = Number(params.n) || 3;
      return { from: 1, to: n };
    }
    case "finish_position": {
      const pos = Number(leg.selectionKey);
      return Number.isFinite(pos) && pos >= 1 ? { from: pos, to: pos } : null;
    }
    case "finish_range": {
      if (params.kind === "last") return null; // handled by the exclusivity slot
      const from = Number(params.from) || 1;
      const to = Number(params.to) || from;
      return { from, to };
    }
    default:
      return null;
  }
}

/**
 * Validate an accumulator's legs. Returns a human message for the first
 * violation, or null when the combination is allowed.
 *
 * Rules (correlated-acca model):
 *  - No duplicate exact (market, selection); a second selection on one market
 *    row only where the market co-occurs (top-N, wide ranges, hole scores).
 *  - Opposite hole outcomes on the same (player, hole) can't both land.
 *  - The correlated family (finishing positions + h2h) is jointly priced, so
 *    within one event: at most ONE position leg per player, no two legs
 *    sharing an exclusive slot, and a player shared between correlated legs
 *    requires every one of those legs to be priceable from the positions
 *    matrix (event-wide, h2h on the ranking basis) — otherwise blocked.
 *  - Deterministic contradictions are blocked outright ("Y to win" + "X beats
 *    Y"), and finishing claims must be satisfiable (no 4 players in a top-3).
 *  - Everything else combines as independent — a player may appear in a
 *    position leg AND own-score legs (X top-3 + X to birdie) freely.
 */
export function findParlayViolation(legs: ParlayLeg[]): string | null {
  const exact = new Set<string>();
  const perMarket = new Map<string, number>();
  const holeKeys = new Set<string>(); // `${eventId}|${player}|${holeSelection}`
  const posSubject = new Set<string>(); // `${eventId}|${player}`
  const slot = new Set<string>(); // `${eventId}|${slot}`

  for (const leg of legs) {
    const exactKey = `${leg.marketId}|${leg.selectionKey}`;
    if (exact.has(exactKey)) return "That selection is already in your acca";
    exact.add(exactKey);

    const marketCount = (perMarket.get(leg.marketId) ?? 0) + 1;
    perMarket.set(leg.marketId, marketCount);
    if (
      marketCount > 1 &&
      !marketAllowsMultiple({ market_type: leg.marketType, params: leg.params })
    ) {
      return "Only one selection from that market can go in an acca";
    }

    if (leg.marketType === "hole_score") {
      // One market row per (player, outcome), holes as selections — the same
      // hole appearing under BOTH outcomes (birdie-or-better + bogey-or-worse)
      // can never land together.
      for (const player of leg.subjectKeys) {
        const key = `${leg.eventId}|${player}|${leg.selectionKey}`;
        if (holeKeys.has(key)) return "Opposite outcomes on the same hole can't both land";
        holeKeys.add(key);
      }
    }

    if (!isPositionFamily(leg.marketType)) continue;

    for (const player of leg.subjectKeys) {
      const key = `${leg.eventId}|${player}`;
      if (posSubject.has(key)) {
        return "A player can only appear once in an event's finishing markets";
      }
      posSubject.add(key);
    }
    const ex = exclusivitySlot(
      { market_type: leg.marketType, params: leg.params },
      leg.selectionKey
    );
    if (ex) {
      const key = `${leg.eventId}|${ex}`;
      if (slot.has(key)) return "Those finishing selections can't both land";
      slot.add(key);
    }
  }

  return (
    findContradiction(legs) ?? findInexpressibleOverlap(legs) ?? findInfeasibleClaims(legs)
  );
}

/**
 * Deterministic impossibilities between h2h sides and finishing claims:
 * beating someone means you can't be last and they can't win (on the shared
 * ranking). Cheap pairwise cases the joint count would only reject as p=0.
 */
function findContradiction(legs: ParlayLeg[]): string | null {
  const winners = new Set<string>(); // `${eventId}|${player}` holding a [1,1] claim
  const lasts = new Set<string>(); // `${eventId}|${player}` holding a "last" claim
  for (const leg of legs) {
    if (!isPositionFamily(leg.marketType)) continue;
    const claim = positionClaim(leg);
    const params = (leg.params ?? {}) as { kind?: unknown; round?: unknown };
    for (const player of leg.subjectKeys) {
      if (claim && claim.from === 1 && claim.to === 1) winners.add(`${leg.eventId}|${player}`);
      if (leg.marketType === "finish_range" && params.kind === "last" && params.round == null) {
        lasts.add(`${leg.eventId}|${player}`);
      }
    }
  }
  if (winners.size === 0 && lasts.size === 0) return null;

  for (const leg of legs) {
    if (leg.marketType !== "h2h") continue;
    if ((leg.params as { round?: unknown } | null)?.round != null) continue;
    const winner = leg.selectionKey === "a" ? leg.subjectProfileId : leg.selectionKey === "b" ? leg.opponentProfileId : null;
    const loser = leg.selectionKey === "a" ? leg.opponentProfileId : leg.selectionKey === "b" ? leg.subjectProfileId : null;
    if (!winner || !loser) continue;
    if (winners.has(`${leg.eventId}|${loser}`) || lasts.has(`${leg.eventId}|${winner}`)) {
      return "Those selections can't both land";
    }
  }
  return null;
}

/**
 * A player shared between two correlated-family legs makes the combo
 * positively correlated; multiplying would overpay, so it's only allowed when
 * EVERY leg touching that player can be priced from the positions matrix.
 */
function findInexpressibleOverlap(legs: ParlayLeg[]): string | null {
  const touches = new Map<string, { count: number; allExpressible: boolean }>();
  for (const leg of legs) {
    if (!isCorrelatedFamily(leg.marketType)) continue;
    const expressible = isMatrixExpressible(leg);
    for (const player of leg.subjectKeys) {
      const key = `${leg.eventId}|${player}`;
      const entry = touches.get(key) ?? { count: 0, allExpressible: true };
      entry.count += 1;
      entry.allExpressible = entry.allExpressible && expressible;
      touches.set(key, entry);
    }
  }
  for (const entry of touches.values()) {
    if (entry.count > 1 && !entry.allExpressible) {
      return "Those selections are related and can't combine";
    }
  }
  return null;
}

/**
 * Hall-style feasibility over finishing claims, per event: for every interval
 * of positions, the players claiming inside it must fit ("4 players all
 * top-3" has no assignment). Claims are per-player-distinct already (the
 * one-position-leg-per-player rule), so counting claims counts players.
 */
function findInfeasibleClaims(legs: ParlayLeg[]): string | null {
  const byEvent = new Map<string, { from: number; to: number }[]>();
  for (const leg of legs) {
    if (!isPositionFamily(leg.marketType)) continue;
    const claim = positionClaim(leg);
    if (!claim) continue;
    const list = byEvent.get(leg.eventId) ?? [];
    list.push(claim);
    byEvent.set(leg.eventId, list);
  }
  for (const claims of byEvent.values()) {
    if (claims.length < 2) continue;
    for (const { from } of claims) {
      for (const { to } of claims) {
        if (to < from) continue;
        const inside = claims.filter((c) => c.from >= from && c.to <= to).length;
        if (inside > to - from + 1) return "Too many players for those finishing spots";
      }
    }
  }
  return null;
}

/** Naive independent-product combined odds (cross-event / no correlated legs). */
export function combinedOdds(legOdds: number[]): number {
  const product = legOdds.reduce((acc, odds) => acc * odds, 1);
  return Math.min(MAX_COMBINED_ODDS, Math.round(product * 100) / 100);
}
