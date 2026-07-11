// Fantasy Picks — correlated-acca joint pricing.
// Pure math over an in-memory positions matrix; no server imports so it stays
// unit-testable alongside the engine.

import { probabilityToDecimalOdds } from "@/lib/fantasy/simulation/types";
import { MAX_COMBINED_ODDS } from "@/lib/fantasy/parlayRules";

/** A retained per-iteration positions matrix for one event's simulation. */
export type JointMatrix = {
  /** Column index → profileId. */
  playerIds: string[];
  simCount: number;
  /** [playerIdx * simCount + iter], 1-based finishing position; 0 = absent. */
  positions: Int8Array;
};

/**
 * One correlated-family leg (finishing positions or head-to-head), resolved
 * to the player(s) it concerns. Only matrix-expressible legs belong here:
 * event-wide, and for h2h on the event's ranking basis (the caller gates
 * that — see matrixLegFor / isMatrixExpressible).
 */
export type MatrixLeg = {
  marketType: string;
  params: Record<string, unknown> | null;
  playerId: string;
  /** h2h only: the "b" side. */
  opponentId?: string;
  selectionKey: string;
};

/** @deprecated old name, kept for call sites mid-migration. */
export type PositionLeg = MatrixLeg;

type Compiled = {
  idx: number;
  /** Second player column for h2h legs; -1 when the predicate is single-player. */
  idx2: number;
  needsMax: boolean;
  test: (pos: number, pos2: number, maxPresent: number) => boolean;
};

/**
 * Predicate over per-iteration finishing positions for one correlated leg.
 * Returns null when this matrix can't express the leg (unknown market type,
 * player not in the matrix, round-scoped leg) — the caller must then fall
 * back; never price such a leg as p=0.
 *
 * h2h reads off positions exactly: competition ranking ("1224") on the shared
 * basis preserves both order and ties of the underlying totals, so
 * posA < posB ⟺ A beat B and posA === posB ⟺ draw. Both players must be
 * present that iteration (pos > 0); an absent player fails the leg, mirroring
 * settlement where a withdrawal voids rather than wins.
 */
function compileLeg(leg: MatrixLeg, index: Map<string, number>): Compiled | null {
  const idx = index.get(leg.playerId);
  if (idx === undefined) return null;
  const params = (leg.params ?? {}) as {
    n?: unknown;
    kind?: unknown;
    from?: unknown;
    to?: unknown;
    round?: unknown;
  };
  // Round-scoped legs concern round standings; the matrix holds event-wide
  // positions only.
  if (params.round != null) return null;
  switch (leg.marketType) {
    case "outright_winner":
      return { idx, idx2: -1, needsMax: false, test: (pos) => pos === 1 };
    case "top_n": {
      const n = Number(params.n) || 3;
      return { idx, idx2: -1, needsMax: false, test: (pos) => pos > 0 && pos <= n };
    }
    case "finish_position": {
      const target = Number(leg.selectionKey);
      return { idx, idx2: -1, needsMax: false, test: (pos) => pos === target };
    }
    case "finish_range": {
      if (params.kind === "last") {
        return {
          idx,
          idx2: -1,
          needsMax: true,
          test: (pos, _pos2, maxPresent) => pos > 0 && pos === maxPresent,
        };
      }
      const from = Number(params.from) || 1;
      const to = Number(params.to) || from;
      return { idx, idx2: -1, needsMax: false, test: (pos) => pos > 0 && pos >= from && pos <= to };
    }
    case "h2h": {
      const idx2 = leg.opponentId != null ? index.get(leg.opponentId) : undefined;
      if (idx2 === undefined) return null;
      switch (leg.selectionKey) {
        case "a":
          return { idx, idx2, needsMax: false, test: (pos, pos2) => pos > 0 && pos2 > 0 && pos < pos2 };
        case "draw":
          return { idx, idx2, needsMax: false, test: (pos, pos2) => pos > 0 && pos2 > 0 && pos === pos2 };
        case "b":
          return { idx, idx2, needsMax: false, test: (pos, pos2) => pos > 0 && pos2 > 0 && pos2 < pos };
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/**
 * True joint probability that ALL correlated legs (one event) land, counted
 * straight from the retained per-iteration positions. Returns null when the
 * matrix can't express some leg (caller falls back to the marginal product).
 */
export function jointPositionProbability(
  matrix: JointMatrix,
  legs: MatrixLeg[]
): number | null {
  if (legs.length === 0) return 1;
  const { positions, simCount, playerIds } = matrix;
  if (simCount <= 0) return null;
  const index = new Map(playerIds.map((id, i) => [id, i]));
  const compiled = legs.map((leg) => compileLeg(leg, index));
  if (compiled.some((c) => c === null)) return null;
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
      const pos2 = c.idx2 >= 0 ? positions[c.idx2 * simCount + iter] : 0;
      if (!c.test(pos, pos2, maxPresent)) {
        all = false;
        break;
      }
    }
    if (all) count++;
  }
  return count / simCount;
}

/** An acca leg, carrying its displayed marginal odds + (if correlated-family) its resolved leg. */
export type AccaLegForPricing = {
  eventId: string;
  decimalOdds: number;
  /** Present only when the leg is matrix-expressible (see matrixLegFor). */
  matrixLeg?: MatrixLeg;
};

export type AccaPrice = {
  combinedOdds: number;
  /** True when any event group was priced from its joint distribution. */
  jointPriced: boolean;
  /** True when a joint count came back 0 — the combo can't land; reject it. */
  infeasible: boolean;
};

/**
 * Combined decimal odds for an acca. Per event, the correlated legs (finishing
 * positions + eligible h2h) are replaced by their TRUE joint price; that is
 * multiplied by every independent leg's marginal odds and across events
 * (events are independent). A single correlated leg keeps its displayed
 * marginal odds — the matrix and the snapshot agree there, and it avoids
 * wooden-spoon tie-handling drift.
 *
 * The product fallback (matrix missing / inexpressible leg) is safe ONLY for
 * negatively-correlated combos, where the true joint is longer. The rules
 * layer (findParlayViolation) blocks every positively-correlated combo that
 * can't be matrix-priced, so nothing that reaches the fallback overpays.
 *
 * A joint count of exactly 0 marks the acca infeasible — the legs contradict
 * each other in every iteration (e.g. an ordering cycle) — rather than
 * pricing an impossible combo at the odds cap.
 */
export function combineAcca(
  legs: AccaLegForPricing[],
  matrices: Map<string, JointMatrix>
): AccaPrice {
  let odds = 1;
  let jointPriced = false;
  let infeasible = false;
  for (const leg of legs) {
    if (!leg.matrixLeg) odds *= leg.decimalOdds; // independent leg
  }
  const byEvent = new Map<string, AccaLegForPricing[]>();
  for (const leg of legs) {
    if (!leg.matrixLeg) continue;
    const list = byEvent.get(leg.eventId) ?? [];
    list.push(leg);
    byEvent.set(leg.eventId, list);
  }
  for (const [eventId, corrLegs] of byEvent) {
    if (corrLegs.length === 1) {
      odds *= corrLegs[0].decimalOdds;
      continue;
    }
    const matrix = matrices.get(eventId);
    const p = matrix
      ? jointPositionProbability(
          matrix,
          corrLegs.map((l) => l.matrixLeg as MatrixLeg)
        )
      : null;
    if (p === null) {
      // No joint data → independent product (negatively-correlated combos
      // only, per the rules layer; the true joint is longer, so this never
      // under-prices for the house).
      for (const l of corrLegs) odds *= l.decimalOdds;
      continue;
    }
    if (p === 0) infeasible = true;
    jointPriced = true;
    odds *= probabilityToDecimalOdds(p);
  }
  return {
    combinedOdds: Math.min(MAX_COMBINED_ODDS, Math.round(odds * 100) / 100),
    jointPriced,
    infeasible,
  };
}
