import { normalCdf } from "@/lib/fantasy/simulation/rng";
import type { HoleSplits, SimHole, SimPlayerProfile } from "@/lib/fantasy/simulation/types";

/**
 * Per-(player, hole) discrete score model.
 *
 * Outcomes are relative to par, indexed k = 0..6 → par−2 .. par+4
 * (eagle-or-better collapsed into k=0, quad-bogey-or-worse into k=6).
 *
 * The distribution is a discretized normal over strokes-vs-par:
 *   mu    — player's expected strokes over par on this hole, blending the flat
 *           par-type average with the (par type × length band) split bucket,
 *           plus a stroke-index difficulty tilt and recent-form drift.
 *   sigma — per-hole spread derived from the player's round stddev
 *           (sigma_round / √18), widened for low-confidence profiles.
 * The birdie bin is then calibrated so the modelled birdies/round matches the
 * player's observed rate (birdie markets price off real birdie propensity).
 */

export const OUTCOME_OFFSET = 2; // k index 2 = par
export const OUTCOME_BINS = 7; // par-2 .. par+4

const DEFAULT_SIGMA_ROUND = 5;
const SI_SENSITIVITY = 0.12; // strokes: SI 1 ≈ +0.11 harder, SI 18 ≈ −0.11 easier
const SPLIT_MIN_SAMPLE = 4;
const SPLIT_WEIGHT = 0.6;

/**
 * Handicap anchor — a PRIOR for thin/no-history players, never a driver.
 * Gross history defines the model; the anchor's influence decays linearly to
 * zero by ANCHOR_FULL_SAMPLE rounds. Amateurs average ~ANCHOR_BUFFER strokes
 * over their index, so a no-history HI 20 anchors at ~95 gross, not the old
 * flat ~88 that made high-handicap newcomers runaway net favourites.
 */
const ANCHOR_BUFFER = 3;
const ANCHOR_FULL_SAMPLE = 10;

/**
 * Differential-path anchor. A player's mean score differential sits ABOVE their
 * handicap index (the index is best-8-of-20, the mean is all rounds), so a thin
 * history anchors at HI + ~3.5. The anchor's pull decays to zero by
 * ANCHOR_FULL_SAMPLE_DIFF effective differentials.
 */
const ANCHOR_BUFFER_DIFF = 3.5;
const ANCHOR_FULL_SAMPLE_DIFF = 12;

/** Recent form nudges the mean; it must never replace it. */
const FORM_WEIGHT = 0.4;
/**
 * On the differential path the mean is ALREADY recency-weighted, so form drift
 * would double-count the trend — it applies at half weight there.
 */
const FORM_WEIGHT_DIFFERENTIAL = 0.2;
const FORM_CLAMP = 4; // strokes/round before weighting

const CONFIDENCE_SIGMA_FACTOR: Record<SimPlayerProfile["confidence"], number> = {
  high: 1.0,
  medium: 1.1,
  low: 1.3,
};

export function lengthBand(par: number, yardage: number | null): "short" | "mid" | "long" | null {
  if (yardage == null || yardage <= 0) return null;
  if (par <= 3) return yardage < 150 ? "short" : yardage > 185 ? "long" : "mid";
  if (par === 4) return yardage < 360 ? "short" : yardage > 420 ? "long" : "mid";
  return yardage < 500 ? "short" : yardage > 550 ? "long" : "mid";
}

export function siBand(strokeIndex: number): "si_1_6" | "si_7_12" | "si_13_18" {
  if (strokeIndex <= 6) return "si_1_6";
  if (strokeIndex <= 12) return "si_7_12";
  return "si_13_18";
}

export function splitKey(par: number, band: "short" | "mid" | "long"): string {
  const p = par <= 3 ? 3 : par === 4 ? 4 : 5;
  return `p${p}_${band}`;
}

function parTypeAvgVsPar(profile: SimPlayerProfile, par: number): number {
  const fallback =
    profile.avgGross != null ? Math.max(0, (profile.avgGross - 72) / 18) : 0.9;
  if (par <= 3) return profile.par3AvgVsPar ?? fallback;
  if (par === 4) return profile.par4AvgVsPar ?? fallback;
  return profile.par5AvgVsPar ?? fallback;
}

function splitBucketAvg(splits: HoleSplits | null, hole: SimHole): number | null {
  if (!splits) return null;
  const band = lengthBand(hole.par, hole.yardage);
  if (!band) return null;
  const bucket = splits[splitKey(hole.par, band)];
  if (!bucket || bucket.sample < SPLIT_MIN_SAMPLE) return null;
  return bucket.avgVsPar;
}

function siAdjustment(splits: HoleSplits | null, hole: SimHole): number {
  // Player-specific SI-band deviation when sampled; otherwise a small generic
  // difficulty tilt (harder low-SI holes play over the player's average).
  const generic = ((9.5 - hole.strokeIndex) / 9.5) * SI_SENSITIVITY;
  if (!splits) return generic;
  const bucket = splits[siBand(hole.strokeIndex)];
  if (!bucket || bucket.sample < SPLIT_MIN_SAMPLE) return generic;
  // Bucket avgVsPar is stored as deviation from the player's overall
  // per-hole average, so it can replace the generic tilt directly.
  return bucket.avgVsPar;
}

/** Per-hole expectation implied by handicap alone; null when no HI. */
function anchorAvgVsPar(profile: SimPlayerProfile): number | null {
  if (profile.handicapIndex == null) return null;
  return (profile.handicapIndex + ANCHOR_BUFFER) / 18;
}

/** Clamped, weighted recent-form drift per hole. */
function formDrift(profile: SimPlayerProfile, weight: number): number {
  const form = Math.max(-FORM_CLAMP, Math.min(FORM_CLAMP, profile.recentForm ?? 0));
  return (weight * form) / 18;
}

/**
 * Effective mean differential — blends the observed recency-weighted mean with
 * the handicap anchor for thin histories. Null when the player has no
 * differential history at all (→ gross-average fallback).
 */
function effectiveDifferential(profile: SimPlayerProfile): number | null {
  const mu = profile.avgDifferential;
  if (mu == null) return null;
  if (profile.handicapIndex == null) return mu;
  const anchor = profile.handicapIndex + ANCHOR_BUFFER_DIFF;
  const w = Math.min(1, (profile.differentialEffectiveN ?? 0) / ANCHOR_FULL_SAMPLE_DIFF);
  return w * mu + (1 - w) * anchor;
}

/**
 * Expected 18-hole-equivalent gross for this hole's tee, worked back from the
 * player's differential via the inverse WHS relation: AGS ≈ D·slope/113 +
 * rating. Null when the differential or the tee's rating/slope is missing, or
 * the round isn't a full ~18 (a differential is an 18-hole quantity).
 */
function expectedRoundGrossFromDifferential(
  profile: SimPlayerProfile,
  hole: SimHole
): number | null {
  const muD = effectiveDifferential(profile);
  if (muD == null) return null;
  if (hole.rating == null || hole.slope == null || hole.slope <= 0) return null;
  if (hole.parTotal == null || hole.holesInRound == null || hole.holesInRound < 14) return null;
  return muD * (hole.slope / 113) + hole.rating;
}

/**
 * Observed par-type / length-bucket SHAPE as a deviation from the player's own
 * overall per-hole scoring — layered on the differential LEVEL so a hard par-4
 * still plays above the player's average without dragging the level back to the
 * (course-blind) gross average.
 */
function observedShapeTilt(profile: SimPlayerProfile, hole: SimHole): number {
  const overall = profile.avgGross != null ? (profile.avgGross - 72) / 18 : null;
  if (overall == null) return 0;
  let tilt = parTypeAvgVsPar(profile, hole.par) - overall;
  const bucketAvg = splitBucketAvg(profile.holeSplits, hole);
  if (bucketAvg != null) tilt = SPLIT_WEIGHT * (bucketAvg - overall) + (1 - SPLIT_WEIGHT) * tilt;
  return tilt;
}

export function holeMu(profile: SimPlayerProfile, hole: SimHole): number {
  const si = siAdjustment(profile.holeSplits, hole);

  // Differential path: LEVEL from the course-normalised differential, SHAPE from
  // the observed sample, form drift at half weight (recency already in μ_D).
  const expectedGross = expectedRoundGrossFromDifferential(profile, hole);
  if (expectedGross != null && hole.parTotal != null && hole.holesInRound != null) {
    const level = (expectedGross - hole.parTotal) / hole.holesInRound;
    return level + observedShapeTilt(profile, hole) + si + formDrift(profile, FORM_WEIGHT_DIFFERENTIAL);
  }

  // Gross-average fallback (no differential / no tee rating) — unchanged.
  const observed = parTypeAvgVsPar(profile, hole.par);
  const anchor = anchorAvgVsPar(profile);
  // Blend observed history with the handicap prior by sample weight: a full
  // sample is pure history, an empty one pure anchor (uniform generic shape —
  // par-type shape only enters through the observed component).
  const w = Math.min(1, profile.sampleSize / ANCHOR_FULL_SAMPLE);
  const base = anchor == null ? observed : w * observed + (1 - w) * anchor;
  const bucketAvg = splitBucketAvg(profile.holeSplits, hole);
  const blended =
    bucketAvg != null ? SPLIT_WEIGHT * bucketAvg + (1 - SPLIT_WEIGHT) * base : base;
  return blended + si + formDrift(profile, FORM_WEIGHT);
}

export function holeSigma(profile: SimPlayerProfile, hole?: SimHole): number {
  // Differential spread converted to gross strokes on this tee (σ_gross =
  // σ_D · slope/113) when the differential path is live; otherwise the observed
  // round stddev, then a handicap-based default (higher handicap → wider spread).
  const useDifferential =
    hole?.slope != null &&
    hole.slope > 0 &&
    hole.holesInRound != null &&
    hole.holesInRound >= 14 &&
    profile.avgDifferential != null &&
    profile.differentialStddev != null;
  const sigmaRound = useDifferential
    ? profile.differentialStddev! * (hole!.slope! / 113)
    : profile.scoreStddev ??
      (profile.handicapIndex != null
        ? Math.min(9, Math.max(3, 2.6 + 0.13 * Math.max(profile.handicapIndex, 0)))
        : DEFAULT_SIGMA_ROUND);
  const holesInRound = hole?.holesInRound && hole.holesInRound >= 14 ? hole.holesInRound : 18;
  const perHole = sigmaRound / Math.sqrt(holesInRound);
  const widened = perHole * CONFIDENCE_SIGMA_FACTOR[profile.confidence];
  return Math.min(1.8, Math.max(0.7, widened));
}

/** Discretize N(mu, sigma) over k = par−2 .. par+4 with collapsed tails. */
export function discretizedDistribution(mu: number, sigma: number): number[] {
  const dist = new Array<number>(OUTCOME_BINS).fill(0);
  let prevCdf = 0;
  for (let k = 0; k < OUTCOME_BINS; k++) {
    const upper = k - OUTCOME_OFFSET + 0.5;
    const cdf = k === OUTCOME_BINS - 1 ? 1 : normalCdf((upper - mu) / sigma);
    dist[k] = Math.max(0, cdf - prevCdf);
    prevCdf = cdf;
  }
  return normalize(dist);
}

function normalize(dist: number[]): number[] {
  const total = dist.reduce((s, p) => s + p, 0);
  if (total <= 0) {
    const uniform = new Array<number>(dist.length).fill(1 / dist.length);
    return uniform;
  }
  return dist.map((p) => p / total);
}

/**
 * Build the outcome distribution for every hole, then calibrate the
 * birdie-or-better mass so Σ P(birdie) over the holes matches the player's
 * observed birdies/round (factor clipped to [0.5, 2] to stay sane on thin
 * data), and the eagle-or-better bin against observed eagles/round — the
 * normal tail wildly overstates rare outcomes, so without this a mid
 * handicapper "eagles" several times a season in the model.
 */
export function buildHoleDistributions(
  profile: SimPlayerProfile,
  holes: SimHole[]
): number[][] {
  const dists = holes.map((hole) =>
    discretizedDistribution(holeMu(profile, hole), holeSigma(profile, hole))
  );

  const observed = profile.birdiesPerRound;
  if (observed != null && observed >= 0 && holes.length > 0) {
    const perRoundScale = holes.length / 18;
    const modelBirdies = dists.reduce((s, d) => s + d[0] + d[1], 0);
    if (modelBirdies > 0.01) {
      const factor = Math.min(2, Math.max(0.5, (observed * perRoundScale) / modelBirdies));
      for (const d of dists) {
        d[0] *= factor;
        d[1] *= factor;
        const scaled = normalize(d);
        for (let k = 0; k < OUTCOME_BINS; k++) d[k] = scaled[k];
      }
    }
  }

  const observedEagles = profile.eaglesPerRound;
  if (observedEagles != null && observedEagles >= 0 && holes.length > 0) {
    const perRoundScale = holes.length / 18;
    const modelEagles = dists.reduce((s, d) => s + d[0], 0);
    if (modelEagles > 0.001) {
      // Wider clip than birdies (rarer event, thinner data); floor keeps a
      // small tail alive even for players who have never recorded an eagle.
      const factor = Math.min(3, Math.max(0.1, (observedEagles * perRoundScale) / modelEagles));
      for (const d of dists) {
        d[0] *= factor;
        const scaled = normalize(d);
        for (let k = 0; k < OUTCOME_BINS; k++) d[k] = scaled[k];
      }
    }
  }

  return dists;
}

/** Cumulative lookup tables for fast inverse-CDF sampling. */
export function toCumulative(dists: number[][]): Float64Array[] {
  return dists.map((d) => {
    const cum = new Float64Array(d.length);
    let acc = 0;
    for (let k = 0; k < d.length; k++) {
      acc += d[k];
      cum[k] = acc;
    }
    cum[d.length - 1] = 1;
    return cum;
  });
}

export function sampleOutcome(cumulative: Float64Array, u: number): number {
  for (let k = 0; k < cumulative.length; k++) {
    if (u <= cumulative[k]) return k;
  }
  return cumulative.length - 1;
}

/**
 * Handicap strokes received on a hole, allocated by stroke index.
 * Positive playing handicaps take strokes on the hardest (lowest SI) holes
 * first; plus handicaps give strokes back starting from the easiest (SI 18).
 */
export function strokesReceived(playingHandicap: number, strokeIndex: number, holeCount = 18): number {
  if (!Number.isFinite(playingHandicap) || playingHandicap === 0) return 0;
  if (playingHandicap > 0) {
    const base = Math.floor(playingHandicap / holeCount);
    const extra = playingHandicap % holeCount;
    return base + (strokeIndex <= extra ? 1 : 0);
  }
  const give = Math.abs(playingHandicap);
  const base = Math.floor(give / holeCount);
  const extra = give % holeCount;
  const back = base + (strokeIndex > holeCount - extra ? 1 : 0);
  return back === 0 ? 0 : -back;
}
