// Fantasy Picks — correlated-acca joint pricing.
// Pure math over an in-memory joint-sample bundle; no server imports so it
// stays unit-testable alongside the engine.

import { probabilityToDecimalOdds } from "@/lib/fantasy/simulation/types";
import { MAX_COMBINED_ODDS } from "@/lib/fantasy/parlayRules";
import type { JointBundle } from "@/lib/fantasy/simulation/jointBundle";

/** A retained per-iteration positions matrix for one event's simulation. */
export type JointMatrix = {
  /** Column index → profileId. */
  playerIds: string[];
  simCount: number;
  /** [playerIdx * simCount + iter], 1-based finishing position; 0 = absent. */
  positions: Int8Array;
};

/**
 * Minimum iterations that must satisfy ALL of a group's legs before the joint
 * count is a price rather than tail noise. At the 20k simulation count this is
 * p = 0.001 — exactly the engine's PROBABILITY_FLOOR / the odds ladder's
 * 1000/1 top rung — so every priceable joint lands on the ladder. Groups with
 * 0 < support < this are flagged lowSupport and rejected at placement.
 */
export const MIN_JOINT_SUPPORT = 20;

/**
 * One correlated-family leg, resolved to the player(s) it concerns. Only
 * bundle-expressible legs belong here (the caller gates that — see
 * matrixLegFor / isMatrixExpressible): finishing positions off the positions
 * matrix; h2h / score totals / score bands off the totals arrays; birdie and
 * eagle counts off their count arrays; round-scoped legs off round totals.
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

/** Per-iteration aggregates shared by the compiled legs that need them. */
type IterAggregates = {
  /** Highest present finishing position (wooden-spoon legs). */
  maxPresent: number;
  /** Field-wide minimum round total, keyed `${round}|${basis}`. */
  roundMin: Map<string, number>;
};

type Compiled = {
  needsMaxPresent?: boolean;
  /** Round-winner legs need the field minimum of this round-basis array. */
  needsRoundMin?: { key: string; totals: Int16Array };
  test: (iter: number, aggs: IterAggregates) => boolean;
};

type ScoreBasis = "gross" | "net";

function scoreBasisOf(params: Record<string, unknown>): ScoreBasis {
  return params.basis === "net" ? "net" : "gross";
}

/** The flat totals array for a basis/round, or null when the bundle lacks it. */
function totalsArray(
  bundle: JointBundle,
  basis: ScoreBasis,
  round: number | null
): Int16Array | null {
  if (round != null) {
    const rb = bundle.rounds?.[round];
    if (!rb) return null;
    return basis === "gross" ? rb.gross : rb.net;
  }
  return (basis === "gross" ? bundle.grossTotals : bundle.netTotals) ?? null;
}

/**
 * Predicate over the bundle's per-iteration samples for one correlated leg.
 * Returns null when the bundle can't express the leg (unknown market type,
 * player not in the matrix, missing arrays — e.g. a row written before the
 * extended columns) — the caller must then fall back; never price such a leg
 * as p=0.
 *
 * h2h prefers the retained totals (any basis, presence-blind — mirroring the
 * marginal simulate); rows without totals fall back to positions, exact when
 * the h2h basis IS the ranking basis: competition ranking ("1224") preserves
 * both order and ties of the underlying totals, so posA < posB ⟺ A beat B.
 * On the positions path both players must be present that iteration (pos >
 * 0); an absent player fails the leg, mirroring settlement where a withdrawal
 * voids rather than wins.
 */
function compileLeg(
  leg: MatrixLeg,
  index: Map<string, number>,
  bundle: JointBundle
): Compiled | null {
  const idx = index.get(leg.playerId);
  if (idx === undefined) return null;
  const s = bundle.simCount;
  const { positions } = bundle;
  const params = (leg.params ?? {}) as {
    n?: unknown;
    kind?: unknown;
    from?: unknown;
    to?: unknown;
    round?: unknown;
    count?: unknown;
    basis?: unknown;
    resolvedBasis?: unknown;
    bands?: unknown;
  };
  const round = params.round != null ? Number(params.round) : null;
  const base = idx * s;

  switch (leg.marketType) {
    case "outright_winner": {
      if (round != null) {
        // Round winner: field-wide minimum of that round's totals on the
        // event ranking basis (resolved by the caller; stableford collapses
        // to net, mirroring totalsFor). Ties all win — matches settlement.
        const basis = params.resolvedBasis === "gross" ? "gross" : ("net" as ScoreBasis);
        const totals = totalsArray(bundle, basis, round);
        if (!totals) return null;
        const key = `${round}|${basis}`;
        return {
          needsRoundMin: { key, totals },
          test: (iter, aggs) => totals[base + iter] === aggs.roundMin.get(key),
        };
      }
      return { test: (iter) => positions[base + iter] === 1 };
    }
    case "top_n": {
      if (round != null) return null;
      const n = Number(params.n) || 3;
      return {
        test: (iter) => {
          const pos = positions[base + iter];
          return pos > 0 && pos <= n;
        },
      };
    }
    case "finish_position": {
      if (round != null) return null;
      const target = Number(leg.selectionKey);
      return { test: (iter) => positions[base + iter] === target };
    }
    case "finish_range": {
      if (round != null) return null;
      if (params.kind === "last") {
        return {
          needsMaxPresent: true,
          test: (iter, aggs) => {
            const pos = positions[base + iter];
            return pos > 0 && pos === aggs.maxPresent;
          },
        };
      }
      const from = Number(params.from) || 1;
      const to = Number(params.to) || from;
      return {
        test: (iter) => {
          const pos = positions[base + iter];
          return pos > 0 && pos >= from && pos <= to;
        },
      };
    }
    case "h2h": {
      const idx2 = leg.opponentId != null ? index.get(leg.opponentId) : undefined;
      if (idx2 === undefined) return null;
      const base2 = idx2 * s;
      if (leg.selectionKey !== "a" && leg.selectionKey !== "draw" && leg.selectionKey !== "b") {
        return null;
      }
      const sel = leg.selectionKey;
      const totals = totalsArray(bundle, scoreBasisOf(params), round);
      if (totals) {
        return {
          test:
            sel === "a"
              ? (iter) => totals[base + iter] < totals[base2 + iter]
              : sel === "draw"
              ? (iter) => totals[base + iter] === totals[base2 + iter]
              : (iter) => totals[base2 + iter] < totals[base + iter],
        };
      }
      // Positions fallback (pre-extension rows) — only ranking-basis,
      // event-wide h2h reaches here (isMatrixExpressible gates the rest).
      if (round != null) return null;
      return {
        test: (iter) => {
          const pos = positions[base + iter];
          const pos2 = positions[base2 + iter];
          if (pos <= 0 || pos2 <= 0) return false;
          return sel === "a" ? pos < pos2 : sel === "draw" ? pos === pos2 : pos2 < pos;
        },
      };
    }
    case "birdies": {
      if (leg.selectionKey !== "yes") return null;
      const count = Number(params.count) || 1;
      const counts = round != null ? bundle.rounds?.[round]?.birdies : bundle.birdies;
      if (!counts) return null;
      return { test: (iter) => counts[base + iter] >= count };
    }
    case "eagle_count": {
      if (leg.selectionKey !== "yes" || round != null) return null;
      const count = Number(params.count) || 1;
      const counts = bundle.eagles;
      if (!counts) return null;
      return { test: (iter) => counts[base + iter] >= count };
    }
    case "score_total": {
      if (round != null) return null; // event-wide only
      const m = /^(u|e|o)_(-?\d+)$/.exec(leg.selectionKey);
      if (!m) return null;
      const side = m[1];
      const v = Number(m[2]);
      const totals = totalsArray(bundle, scoreBasisOf(params), null);
      if (!totals) return null;
      return {
        test:
          side === "u"
            ? (iter) => totals[base + iter] < v
            : side === "e"
            ? (iter) => totals[base + iter] === v
            : (iter) => totals[base + iter] > v,
      };
    }
    case "score_band": {
      if (round != null) return null;
      const bands = Array.isArray(params.bands)
        ? (params.bands as { key?: unknown; lo?: unknown; hi?: unknown }[])
        : [];
      const band = bands.find((b) => b.key === leg.selectionKey);
      if (!band) return null;
      const lo = band.lo == null ? null : Number(band.lo);
      const hi = band.hi == null ? null : Number(band.hi);
      const totals = totalsArray(bundle, scoreBasisOf(params), null);
      if (!totals) return null;
      return {
        test: (iter) => {
          const score = totals[base + iter];
          if (lo != null && score < lo) return false;
          if (hi != null && score > hi) return false;
          return true;
        },
      };
    }
    default:
      return null;
  }
}

export type JointProbability = {
  p: number;
  /** Iterations in which every leg landed — the count behind p. */
  support: number;
};

/**
 * True joint probability that ALL correlated legs (one event) land, counted
 * straight from the retained per-iteration samples. Returns null when the
 * bundle can't express some leg (caller falls back to the marginal product).
 */
export function jointProbability(
  bundle: JointBundle,
  legs: MatrixLeg[]
): JointProbability | null {
  const { simCount, playerIds, positions } = bundle;
  if (simCount <= 0) return null;
  if (legs.length === 0) return { p: 1, support: simCount };
  const index = new Map(playerIds.map((id, i) => [id, i]));
  const compiled = legs.map((leg) => compileLeg(leg, index, bundle));
  if (compiled.some((c) => c === null)) return null;
  const legsC = compiled as Compiled[];
  const needMax = legsC.some((c) => c.needsMaxPresent);
  const roundMins = new Map<string, Int16Array>();
  for (const c of legsC) {
    if (c.needsRoundMin) roundMins.set(c.needsRoundMin.key, c.needsRoundMin.totals);
  }
  const playerCount = playerIds.length;
  const aggs: IterAggregates = { maxPresent: 0, roundMin: new Map() };

  let count = 0;
  for (let iter = 0; iter < simCount; iter++) {
    if (needMax) {
      let maxPresent = 0;
      for (let pi = 0; pi < playerCount; pi++) {
        const p = positions[pi * simCount + iter];
        if (p > maxPresent) maxPresent = p;
      }
      aggs.maxPresent = maxPresent;
    }
    for (const [key, totals] of roundMins) {
      let min = Infinity;
      for (let pi = 0; pi < playerCount; pi++) {
        const v = totals[pi * simCount + iter];
        if (v < min) min = v;
      }
      aggs.roundMin.set(key, min);
    }
    let all = true;
    for (const c of legsC) {
      if (!c.test(iter, aggs)) {
        all = false;
        break;
      }
    }
    if (all) count++;
  }
  return { p: count / simCount, support: count };
}

/** @deprecated use jointProbability — kept for call sites that only want p. */
export function jointPositionProbability(
  matrix: JointBundle,
  legs: MatrixLeg[]
): number | null {
  const result = jointProbability(matrix, legs);
  return result === null ? null : result.p;
}

/** An acca leg, carrying its displayed marginal odds + (if correlated-family) its resolved leg. */
export type AccaLegForPricing = {
  eventId: string;
  decimalOdds: number;
  /** Present only when the leg is bundle-expressible (see matrixLegFor). */
  matrixLeg?: MatrixLeg;
};

export type AccaPrice = {
  combinedOdds: number;
  /** True when any event group was priced from its joint distribution. */
  jointPriced: boolean;
  /** True when a joint count came back 0 — the combo can't land; reject it. */
  infeasible: boolean;
  /**
   * True when a joint count landed below MIN_JOINT_SUPPORT — too few
   * iterations to price the combo reliably; reject it at placement.
   */
  lowSupport: boolean;
};

/**
 * Combined decimal odds for an acca. Per event, the correlated legs
 * (finishing positions, h2h, score totals/bands, birdie/eagle counts) are
 * replaced by their TRUE joint price; that is multiplied by every independent
 * leg's marginal odds and across events (events are independent). A single
 * correlated leg keeps its displayed marginal odds — marginal pricing stays
 * the (sometimes analytic) snapshot price, and it avoids wooden-spoon
 * tie-handling drift.
 *
 * The product fallback (bundle missing / inexpressible leg) is safe ONLY for
 * negatively-correlated combos, where the true joint is longer. The rules
 * layer (findParlayViolation) blocks every positively-correlated combo that
 * can't be bundle-priced, so nothing that reaches the fallback overpays.
 *
 * A joint count of exactly 0 marks the acca infeasible — the legs contradict
 * each other in every iteration (e.g. an ordering cycle) — rather than
 * pricing an impossible combo at the odds cap; a count below
 * MIN_JOINT_SUPPORT marks it lowSupport (rejected the same way, with a
 * "too rare to price" message).
 */
export function combineAcca(
  legs: AccaLegForPricing[],
  bundles: Map<string, JointBundle>
): AccaPrice {
  let odds = 1;
  let jointPriced = false;
  let infeasible = false;
  let lowSupport = false;
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
    const bundle = bundles.get(eventId);
    const joint = bundle
      ? jointProbability(
          bundle,
          corrLegs.map((l) => l.matrixLeg as MatrixLeg)
        )
      : null;
    if (joint === null) {
      // No joint data → independent product (negatively-correlated combos
      // only, per the rules layer; the true joint is longer, so this never
      // under-prices for the house).
      for (const l of corrLegs) odds *= l.decimalOdds;
      continue;
    }
    if (joint.support === 0) infeasible = true;
    else if (joint.support < MIN_JOINT_SUPPORT) lowSupport = true;
    jointPriced = true;
    odds *= probabilityToDecimalOdds(joint.p);
  }
  return {
    combinedOdds: Math.min(MAX_COMBINED_ODDS, Math.round(odds * 100) / 100),
    jointPriced,
    infeasible,
    lowSupport,
  };
}
