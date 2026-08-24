// Fantasy Picks — WHS score-differential recency weighting.
// Pure math, no runtime imports, so it stays unit-testable alongside the engine.

/**
 * Recency half-life in ROUNDS: a differential this many rounds back counts half
 * as much as the newest one. Deliberately generous so a 200-round history still
 * contributes, just with the recent form dominating.
 */
export const DIFFERENTIAL_HALFLIFE_ROUNDS = 20;

/**
 * Below this many samples we do NOT fit a trend when estimating spread: a
 * 2-point line has zero residual, and a 3-point fit leaves one noisy residual
 * DoF. We fall back to deviations from the level instead (see below).
 */
export const MIN_DETREND_SAMPLES = 4;

export type WeightedDifferentialStats = {
  /** Recency-weighted mean differential (the LEVEL — unaffected by detrending). */
  mean: number;
  /** Reliability-corrected weighted stddev of the round-to-round NOISE; null with < 2 samples. */
  stddev: number | null;
  /**
   * Weighted-least-squares slope of differential vs round index (newest = index
   * 0). Positive ⇒ older rounds scored higher ⇒ the player is improving toward
   * the present. Informational (inspector / future form cross-check); null when
   * no trend was fitted.
   */
  trendPerRound: number | null;
  /** Effective sample size (Σw)²/Σw² — 1 round ≈ 1, decays as weights spread. */
  effectiveN: number;
  /** Raw count of differentials used. */
  sampleSize: number;
  /** Weighted centroid of the round index. Null when no trend was fitted. */
  rMean: number | null;
  /**
   * The fitted level AT THE NEWEST ROUND, i.e. `mean − trendPerRound·rMean`.
   *
   * `mean` is the weighted mean, which sits at the weighted CENTROID of the
   * sample — around 28 rounds back at the default half-life. For a player
   * trending 0.05 strokes/round that is a 1.4-stroke difference. Anything
   * projecting FORWARD must start from `levelNow`, not `mean`. Equal to `mean`
   * when no trend was fitted.
   */
  levelNow: number;
  /**
   * Standard error of `trendPerRound`. Lets a caller ask whether an apparent
   * trend is distinguishable from noise before extrapolating it. Null when no
   * trend was fitted.
   */
  trendStdErr: number | null;
};

/**
 * Exponentially recency-weight a player's differential history.
 * `diffsNewestFirst` must be ordered newest → oldest (index 0 = latest round).
 *
 * The LEVEL is the recency-weighted mean. The SPREAD is the reliability-weighted
 * stddev of the round-to-round noise AROUND A FITTED TREND: an improving (or
 * declining) player's old rounds sit far from their current mean, so measuring
 * spread as deviations from that single mean would count their trajectory as
 * volatility and over-widen their simulated distribution. A weighted-least-
 * squares detrend (recency weights make it a local, recent-form slope) removes
 * that trajectory and leaves genuine noise. When there are too few samples to
 * fit a trend we fall back to deviations from the level.
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
  let trendPerRound: number | null = null;
  let rMeanOut: number | null = null;
  let trendStdErr: number | null = null;

  if (values.length >= 2) {
    // Detrended path: fit x ≈ a + b·r by WLS, measure spread around the line.
    if (values.length >= MIN_DETREND_SAMPLES) {
      let swr = 0; // Σw·r
      for (let i = 0; i < values.length; i++) swr += weights[i] * i;
      const rMean = swr / v1;

      let srrW = 0; // Σw·(r−r̄)²
      let srxW = 0; // Σw·(r−r̄)(x−x̄)
      let srrW2 = 0; // Σw²·(r−r̄)²  — slope's weighted hat-trace numerator
      for (let i = 0; i < values.length; i++) {
        const dr = i - rMean;
        srrW += weights[i] * dr * dr;
        srxW += weights[i] * dr * (values[i] - mean);
        srrW2 += weights[i] * weights[i] * dr * dr;
      }

      if (srrW > 0) {
        const slope = srxW / srrW; // b
        // The WLS line passes through the weighted centroid, so the fit at r is
        // mean + slope·(r − r̄). Residuals are the noise we want the spread of.
        let num = 0;
        for (let i = 0; i < values.length; i++) {
          const e = values[i] - (mean + slope * (i - rMean));
          num += weights[i] * e * e;
        }
        // Unbiased reliability-weighted denominator, LESS the extra degree of
        // freedom the slope consumes. The intercept and the centred slope are
        // W-orthogonal directions; each removes Σw²v²/Σw·v² of the hat trace —
        // V2/V1 for the constant, srrW2/srrW for the slope.
        const denom = v1 - v2 / v1 - srrW2 / srrW;
        if (denom > 0) {
          stddev = Math.sqrt(num / denom);
          trendPerRound = slope;
          rMeanOut = rMean;
          // Var(slope) for a WLS fit is σ²/Σw(r−r̄)², with σ² the residual
          // variance already computed as num/denom.
          trendStdErr = Math.sqrt(num / denom / srrW);
        }
      }
    }

    // Mean-only fallback (original estimator) — used with < MIN_DETREND_SAMPLES
    // samples, or if the detrend denominator degenerated.
    if (stddev === null) {
      let num = 0;
      for (let i = 0; i < values.length; i++) {
        const d = values[i] - mean;
        num += weights[i] * d * d;
      }
      const denom = v1 - v2 / v1;
      if (denom > 0) stddev = Math.sqrt(num / denom);
    }
  }

  // Index 0 is the NEWEST round, so the fitted line at r = 0 is the level today.
  // A POSITIVE trendPerRound means older rounds scored higher, i.e. the player
  // is improving, and the forward per-round change is −trendPerRound.
  const levelNow =
    trendPerRound !== null && rMeanOut !== null ? mean - trendPerRound * rMeanOut : mean;

  return {
    mean,
    stddev,
    trendPerRound,
    effectiveN,
    sampleSize: values.length,
    rMean: rMeanOut,
    levelNow,
    trendStdErr,
  };
}
