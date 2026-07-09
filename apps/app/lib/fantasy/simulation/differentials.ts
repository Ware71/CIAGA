// Fantasy Picks — WHS score-differential recency weighting.
// Pure math, no runtime imports, so it stays unit-testable alongside the engine.

/**
 * Recency half-life in ROUNDS: a differential this many rounds back counts half
 * as much as the newest one. Deliberately generous so a 200-round history still
 * contributes, just with the recent form dominating.
 */
export const DIFFERENTIAL_HALFLIFE_ROUNDS = 20;

export type WeightedDifferentialStats = {
  /** Recency-weighted mean differential. */
  mean: number;
  /** Reliability-corrected weighted stddev; null with < 2 samples. */
  stddev: number | null;
  /** Effective sample size (Σw)²/Σw² — 1 round ≈ 1, decays as weights spread. */
  effectiveN: number;
  /** Raw count of differentials used. */
  sampleSize: number;
};

/**
 * Exponentially recency-weight a player's differential history.
 * `diffsNewestFirst` must be ordered newest → oldest (index 0 = latest round).
 */
export function recencyWeightedDifferentialStats(
  diffsNewestFirst: number[],
  halflife = DIFFERENTIAL_HALFLIFE_ROUNDS
): WeightedDifferentialStats | null {
  const values = diffsNewestFirst.filter((d) => Number.isFinite(d));
  if (values.length === 0) return null;

  let v1 = 0; // Σw
  let v2 = 0; // Σw²
  let weightedSum = 0; // Σw·x
  const weights = values.map((_, r) => Math.pow(0.5, r / halflife));
  for (let i = 0; i < values.length; i++) {
    v1 += weights[i];
    v2 += weights[i] * weights[i];
    weightedSum += weights[i] * values[i];
  }
  const mean = weightedSum / v1;
  const effectiveN = (v1 * v1) / v2;

  let stddev: number | null = null;
  if (values.length >= 2) {
    let num = 0;
    for (let i = 0; i < values.length; i++) {
      const d = values[i] - mean;
      num += weights[i] * d * d;
    }
    // Reliability weights → unbiased denominator V1 − V2/V1.
    const denom = v1 - v2 / v1;
    if (denom > 0) stddev = Math.sqrt(num / denom);
  }

  return { mean, stddev, effectiveN, sampleSize: values.length };
}
