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

/** Recent form nudges the gross mean; it must never replace it. */
const FORM_WEIGHT = 0.4;
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

export function holeMu(profile: SimPlayerProfile, hole: SimHole): number {
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
  const form = Math.max(-FORM_CLAMP, Math.min(FORM_CLAMP, profile.recentForm ?? 0));
  const drift = (FORM_WEIGHT * form) / 18;
  return blended + siAdjustment(profile.holeSplits, hole) + drift;
}

export function holeSigma(profile: SimPlayerProfile): number {
  // Observed round variability always wins; the handicap-based default only
  // covers players with no stddev yet (higher handicap → wider spread).
  const sigmaRound =
    profile.scoreStddev ??
    (profile.handicapIndex != null
      ? Math.min(9, Math.max(3, 2.6 + 0.13 * Math.max(profile.handicapIndex, 0)))
      : DEFAULT_SIGMA_ROUND);
  const perHole = sigmaRound / Math.sqrt(18);
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
 * observed birdies/round (factor clipped to [0.5, 2] to stay sane on thin data).
 */
export function buildHoleDistributions(
  profile: SimPlayerProfile,
  holes: SimHole[]
): number[][] {
  const sigma = holeSigma(profile);
  const dists = holes.map((hole) => discretizedDistribution(holeMu(profile, hole), sigma));

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
