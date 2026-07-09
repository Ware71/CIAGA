// Fantasy Picks — correlated-acca joint pricing.
// Pure math over an in-memory positions matrix; no server imports so it stays
// unit-testable alongside the engine.

import { probabilityToDecimalOdds } from "@/lib/fantasy/simulation/types";

/** A retained per-iteration positions matrix for one event's simulation. */
export type JointMatrix = {
  /** Column index → profileId. */
  playerIds: string[];
  simCount: number;
  /** [playerIdx * simCount + iter], 1-based finishing position; 0 = absent. */
  positions: Int8Array;
};

/** One finishing-position-family leg, resolved to the player it concerns. */
export type PositionLeg = {
  marketType: string;
  params: Record<string, unknown> | null;
  playerId: string;
  selectionKey: string;
};

type Compiled = { idx: number; needsMax: boolean; test: (pos: number, maxPresent: number) => boolean };

/** Predicate over a player's finishing position for one position-family leg. */
function compileLeg(leg: PositionLeg, index: Map<string, number>): Compiled | null {
  const idx = index.get(leg.playerId);
  if (idx === undefined) return null;
  const params = (leg.params ?? {}) as { n?: unknown; kind?: unknown; from?: unknown; to?: unknown };
  switch (leg.marketType) {
    case "outright_winner":
      return { idx, needsMax: false, test: (pos) => pos === 1 };
    case "top_n": {
      const n = Number(params.n) || 3;
      return { idx, needsMax: false, test: (pos) => pos > 0 && pos <= n };
    }
    case "finish_position": {
      const target = Number(leg.selectionKey);
      return { idx, needsMax: false, test: (pos) => pos === target };
    }
    case "finish_range": {
      if (params.kind === "last") {
        return { idx, needsMax: true, test: (pos, maxPresent) => pos > 0 && pos === maxPresent };
      }
      const from = Number(params.from) || 1;
      const to = Number(params.to) || from;
      return { idx, needsMax: false, test: (pos) => pos > 0 && pos >= from && pos <= to };
    }
    default:
      return null;
  }
}

/**
 * True joint probability that ALL position-family legs (one event) land,
 * counted straight from the retained per-iteration positions. A leg on a player
 * absent from the matrix, or an unknown market type, collapses the joint to 0
 * (can't be priced from this matrix).
 */
export function jointPositionProbability(matrix: JointMatrix, legs: PositionLeg[]): number {
  if (legs.length === 0) return 1;
  const { positions, simCount, playerIds } = matrix;
  if (simCount <= 0) return 0;
  const index = new Map(playerIds.map((id, i) => [id, i]));
  const compiled = legs.map((leg) => compileLeg(leg, index));
  if (compiled.some((c) => c === null)) return 0;
  const legsC = compiled as Compiled[];
  const needMax = legsC.some((c) => c.needsMax);
  const playerCount = playerIds.length;

  let count = 0;
  for (let iter = 0; iter < simCount; iter++) {
    let maxPresent = 0;
    if (needMax) {
      for (let pi = 0; pi < playerCount; pi++) {
        const p = positions[pi * simCount + iter];
        if (p > maxPresent) maxPresent = p;
      }
    }
    let all = true;
    for (const c of legsC) {
      const pos = positions[c.idx * simCount + iter];
      if (!c.test(pos, maxPresent)) {
        all = false;
        break;
      }
    }
    if (all) count++;
  }
  return count / simCount;
}

/** An acca leg, carrying its displayed marginal odds + (if position-family) its resolved leg. */
export type AccaLegForPricing = {
  eventId: string;
  decimalOdds: number;
  position?: PositionLeg;
};

/**
 * Combined decimal odds for an acca. Per event, the position-family legs are
 * replaced by their TRUE joint price; that is multiplied by every independent
 * leg's marginal odds and across events (events are independent). A single
 * position leg keeps its displayed marginal odds — the matrix and the snapshot
 * agree there, and it avoids wooden-spoon tie-handling drift.
 */
export function combineAccaOdds(
  legs: AccaLegForPricing[],
  matrices: Map<string, JointMatrix>
): number {
  let odds = 1;
  for (const leg of legs) {
    if (!leg.position) odds *= leg.decimalOdds; // independent leg
  }
  const byEvent = new Map<string, AccaLegForPricing[]>();
  for (const leg of legs) {
    if (!leg.position) continue;
    const list = byEvent.get(leg.eventId) ?? [];
    list.push(leg);
    byEvent.set(leg.eventId, list);
  }
  for (const [eventId, posLegs] of byEvent) {
    if (posLegs.length === 1) {
      odds *= posLegs[0].decimalOdds;
      continue;
    }
    const matrix = matrices.get(eventId);
    if (!matrix) {
      // No joint data available → independent product (never under-prices; the
      // true negatively-correlated joint is longer, so this is conservative).
      for (const l of posLegs) odds *= l.decimalOdds;
      continue;
    }
    const p = jointPositionProbability(
      matrix,
      posLegs.map((l) => l.position as PositionLeg)
    );
    odds *= probabilityToDecimalOdds(p);
  }
  return Math.round(odds * 100) / 100;
}
