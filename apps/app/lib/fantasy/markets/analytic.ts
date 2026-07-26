// Fantasy Picks — exact (noise-free) pricing for single-player markets.
//
// Score bands / totals and birdie/eagle counts depend only on ONE player's own
// holes. The engine samples them by Monte Carlo, which leaves ~14% relative
// noise on longshot tails and locks that noise into the odds ladder per version.
// Because the model samples each round's holes through a one-factor Gaussian
// copula (shared "day" factor, correlation ρ — see engine.ts / holeModel.ts),
// the holes are CONDITIONALLY INDEPENDENT given the day factor. So the exact
// distribution is a Gauss–Hermite quadrature over the day factor of the
// convolution of the calibrated per-hole distributions — no sampling, no seed
// dependence, and it honours the same correlation the engine uses.

import { normalCdf, normalInvCdf } from "@/lib/fantasy/simulation/rng";
import {
  INTRA_ROUND_CORRELATION,
  OUTCOME_BINS,
  OUTCOME_OFFSET,
} from "@/lib/fantasy/simulation/holeModel";
import type { AnalyticModel } from "@/lib/fantasy/simulation/types";

const SQRT_RHO = Math.sqrt(INTRA_ROUND_CORRELATION);
const SQRT_1MRHO = Math.sqrt(1 - INTRA_ROUND_CORRELATION);

// 10-point Gauss–Hermite nodes/weights (physicists', weight e^{-x²}). A
// standard-normal expectation E[f(G)] ≈ Σ (wᵢ/√π)·f(√2·xᵢ); the integrand (a
// convolution of smooth conditional pmfs) is easily resolved at 10 nodes.
const GH_X = [
  0.3429013272237046, 1.0366108297895136, 1.7566836492998817,
  2.5327316742327897, 3.4361591188377374,
];
const GH_W = [
  0.6108626337353258, 0.2401386110823147, 0.03387439445548106,
  0.001343645746781233, 7.64043285523262e-6,
];
const NODES: { g: number; w: number }[] = (() => {
  const raw: { g: number; w: number }[] = [];
  const norm = Math.sqrt(Math.PI);
  for (let i = 0; i < GH_X.length; i++) {
    raw.push({ g: Math.SQRT2 * GH_X[i], w: GH_W[i] / norm });
    raw.push({ g: -Math.SQRT2 * GH_X[i], w: GH_W[i] / norm });
  }
  // Renormalise so the weights sum to exactly 1 (table rounding aside).
  const wsum = raw.reduce((s, n) => s + n.w, 0);
  return raw.map((n) => ({ g: n.g, w: n.w / wsum }));
})();

export type AnalyticPmf = {
  /** Score value of probs[0]. */
  min: number;
  /** probs[i] = P(total = min + i). */
  probs: number[];
};

export type AnalyticResult = {
  gross: AnalyticPmf;
  net: AnalyticPmf;
  /** Birdie-or-better count pmf, indexed by ABSOLUTE count (incl. fixed holes). */
  birdies: number[];
  /** Eagle-or-better count pmf, indexed by absolute count. */
  eagles: number[];
};

/** Latent normal bin edges Φ⁻¹(cumulative mass) for one hole's marginal pmf. */
function latentEdges(dist: number[]): number[] {
  const edges = new Array<number>(OUTCOME_BINS - 1);
  let cum = 0;
  for (let k = 0; k < OUTCOME_BINS - 1; k++) {
    cum += dist[k];
    edges[k] = normalInvCdf(Math.min(1, Math.max(0, cum)));
  }
  return edges;
}

/** Conditional bin pmf for a hole given the round's day factor g (copula). */
function conditionalBins(zEdges: number[], g: number): number[] {
  const out = new Array<number>(OUTCOME_BINS);
  let prev = 0;
  for (let k = 0; k < OUTCOME_BINS; k++) {
    const hi =
      k === OUTCOME_BINS - 1 ? 1 : normalCdf((zEdges[k] - SQRT_RHO * g) / SQRT_1MRHO);
    out[k] = Math.max(0, hi - prev);
    prev = hi;
  }
  return out;
}

/** Convolve two integer-support pmfs. */
function convolve(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return out;
}

/** Add `scale`·src into target in place, growing target as needed. */
function addScaled(target: number[], src: number[], scale: number): void {
  for (let i = 0; i < src.length; i++) {
    target[i] = (target[i] ?? 0) + scale * src[i];
  }
}

/**
 * Exact gross/net total and birdie/eagle-count distributions for one player,
 * from their calibrated per-hole model. Rounds are integrated independently
 * over their own day factor (Gauss–Hermite), then convolved together; fixed
 * (already-played) holes shift the supports deterministically.
 */
const memo = new WeakMap<AnalyticModel, AnalyticResult>();

export function analyticDistributions(a: AnalyticModel): AnalyticResult {
  const cached = memo.get(a);
  if (cached) return cached;
  const result = computeAnalyticDistributions(a);
  memo.set(a, result);
  return result;
}

function computeAnalyticDistributions(a: AnalyticModel): AnalyticResult {
  // Group remaining holes by round (day factor is shared within a round).
  const byRound = new Map<number, number[]>();
  a.holeRounds.forEach((r, i) => {
    const list = byRound.get(r);
    if (list) list.push(i);
    else byRound.set(r, [i]);
  });

  // Deterministic gross offset: fixed strokes + Σ(par − OFFSET) over remaining
  // holes (each hole's stroke = par + k − OFFSET; k is convolved from 0).
  let strokeOffset = a.fixedGross;
  for (let i = 0; i < a.holePars.length; i++) strokeOffset += a.holePars[i] - OUTCOME_OFFSET;

  const zEdgesByHole = a.holeDists.map(latentEdges);

  let grossK: number[] = [1]; // pmf over Σk across remaining holes
  let birdieCount: number[] = [1];
  let eagleCount: number[] = [1];

  for (const holeIdxs of byRound.values()) {
    const roundK: number[] = [];
    const roundB: number[] = [];
    const roundE: number[] = [];
    for (const { g, w } of NODES) {
      let convK: number[] = [1];
      let convB: number[] = [1];
      let convE: number[] = [1];
      for (const h of holeIdxs) {
        const cb = conditionalBins(zEdgesByHole[h], g);
        convK = convolve(convK, cb);
        const pb = cb[0] + cb[1]; // birdie-or-better
        const pe = cb[0]; // eagle-or-better
        convB = convolve(convB, [1 - pb, pb]);
        convE = convolve(convE, [1 - pe, pe]);
      }
      addScaled(roundK, convK, w);
      addScaled(roundB, convB, w);
      addScaled(roundE, convE, w);
    }
    grossK = convolve(grossK, roundK);
    birdieCount = convolve(birdieCount, roundB);
    eagleCount = convolve(eagleCount, roundE);
  }

  const gross: AnalyticPmf = { min: strokeOffset, probs: grossK };
  const net: AnalyticPmf = { min: strokeOffset - a.playingHandicap * a.roundCount, probs: grossK };

  // Shift count pmfs by the fixed (already-banked) birdies/eagles.
  const birdies = new Array<number>(a.fixedBirdies + birdieCount.length).fill(0);
  for (let j = 0; j < birdieCount.length; j++) birdies[a.fixedBirdies + j] = birdieCount[j];
  const eagles = new Array<number>(a.fixedEagles + eagleCount.length).fill(0);
  for (let j = 0; j < eagleCount.length; j++) eagles[a.fixedEagles + j] = eagleCount[j];

  return { gross, net, birdies, eagles };
}

/** P(total ≤ hi) − P(total < lo), from an analytic pmf (null bound = open). */
export function pmfBandProbability(pmf: AnalyticPmf, lo: number | null, hi: number | null): number {
  let sum = 0;
  for (let i = 0; i < pmf.probs.length; i++) {
    const v = pmf.min + i;
    if (lo != null && v < lo) continue;
    if (hi != null && v > hi) continue;
    sum += pmf.probs[i];
  }
  return sum;
}

/** P(total < v) / P(total = v) / P(total > v) from an analytic pmf. */
export function pmfUnderExactOver(
  pmf: AnalyticPmf,
  v: number
): { under: number; exact: number; over: number } {
  let under = 0;
  let exact = 0;
  let over = 0;
  for (let i = 0; i < pmf.probs.length; i++) {
    const value = pmf.min + i;
    if (value < v) under += pmf.probs[i];
    else if (value === v) exact += pmf.probs[i];
    else over += pmf.probs[i];
  }
  return { under, exact, over };
}

/** P(count ≥ n) from a count pmf indexed by absolute count. */
export function pmfCountAtLeast(pmf: number[], n: number): number {
  let sum = 0;
  for (let c = n; c < pmf.length; c++) sum += pmf[c];
  return sum;
}

/**
 * Current probability of a score_band / score_total selection from the exact
 * per-score pmf — the "cumulative of the exact scores". The selection key is
 * self-describing, so this prices a pick's OWN band/value regardless of what's
 * currently offered (used by cash-out to track drift). Key parsing is inlined
 * here so this stays in the pmf-math layer with no market-definition import.
 * Null for other market types or an unparseable key.
 */
export function scoreSelectionProbability(
  marketType: string,
  selectionKey: string,
  pmf: AnalyticPmf
): number | null {
  if (marketType === "score_band") {
    let m = /^le_(-?\d+)$/.exec(selectionKey);
    if (m) return pmfBandProbability(pmf, null, Number(m[1]));
    m = /^ge_(-?\d+)$/.exec(selectionKey);
    if (m) return pmfBandProbability(pmf, Number(m[1]), null);
    m = /^(-?\d+)_(-?\d+)$/.exec(selectionKey);
    if (m) return pmfBandProbability(pmf, Number(m[1]), Number(m[2]));
    return null;
  }
  if (marketType === "score_total") {
    const m = /^(u|e|o)_(-?\d+)$/.exec(selectionKey);
    if (!m) return null;
    const { under, exact, over } = pmfUnderExactOver(pmf, Number(m[2]));
    return m[1] === "u" ? under : m[1] === "o" ? over : exact;
  }
  return null;
}
