import { normalCdf } from "@/lib/fantasy/simulation/rng";
import type { HoleSplits, SimHole, SimPlayerProfile } from "@/lib/fantasy/simulation/types";

/**
 * Per-(player, hole) discrete score model.
 *
 * Outcomes are relative to par, indexed k = 0..10 → par−2 .. par+8
 * (eagle-or-better collapsed into k=0, the blow-up tail into k=10).
 *
 * The distribution is a discretized normal over strokes-vs-par:
 *   mu    — player's expected strokes over par on this hole, blending the flat
 *           par-type average with the (par type × length band) split bucket,
 *           plus a stroke-index difficulty tilt and recent-form drift.
 *   sigma — per-hole spread derived from the player's round stddev
 *           (sigma_round / √18), widened for low-confidence profiles.
 *
 * The birdie-or-better mass is then calibrated EXACTLY to a Bayesian-shrunk
 * target rate (observed birdies/round shrunk toward a handicap-based prior —
 * the normal tail wildly overstates amateur birdie odds), the eagle bin is set
 * within that mass, and a fixed-point loop re-adjusts each hole's latent mean
 * so the POST-calibration expected score still equals holeMu (the differential
 * level already includes the player's real birdies, so calibration must fix
 * the shape without moving the level).
 */

export const OUTCOME_OFFSET = 2; // k index 2 = par
// par-2 .. par+8. The old +4 ceiling truncated high-handicap blow-up holes:
// a 40+ handicapper averages > +2/hole, so +4 sat barely above their mean and
// collapsed ~40% of the upper tail — understating their gross and (net) making
// them a false favourite. +8 covers even max handicaps with negligible loss.
export const OUTCOME_BINS = 11;

const DEFAULT_SIGMA_ROUND = 5;
const SI_SENSITIVITY = 0.12; // strokes: SI 1 ≈ +0.11 harder, SI 18 ≈ −0.11 easier
const SPLIT_MIN_SAMPLE = 4;
const SPLIT_WEIGHT = 0.6;

/**
 * Net-consistency anchor for thin/no-history players. With no ability signal we
 * model the player to shoot (playingHandicap + POPULATION_GAP) over par on gross
 * → net ≈ par + POPULATION_GAP, whatever their handicap. This is what stops a
 * big handicap from making a player a net favourite: the old anchor set gross
 * from the handicap INDEX while net deducted the (larger, course-scaled) playing
 * handicap, so high handicappers were modelled below par on net. POPULATION_GAP
 * is the typical amateur gap between average and best-8 rounds (μ_D − HI).
 */
export const POPULATION_GAP = 4;
/** Gross-sample weight reaches 1 (pure observed history) by this many rounds. */
const ANCHOR_FULL_SAMPLE = 10;
/** Differential-sample weight reaches 1 (pure μ_D) by this effective count. */
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

/**
 * Rare-event calibration priors (Gamma-Poisson): the observed rate over the
 * ≤20-round shape sample is shrunk toward a handicap-based prior mean with
 * strength K (in rounds): λ* = (λ_obs·n + λ0·K)/(n + K). Prior curves are fit
 * to published amateur rates (birdies/round: scratch ≈ 2.2, HI 10 ≈ 0.70,
 * HI 20 ≈ 0.22; eagles are ~1 per 15–25 rounds even for scratch).
 */
export const BIRDIE_PRIOR_STRENGTH = 8;
export const EAGLE_PRIOR_STRENGTH = 40;

export function birdiePriorMean(hi: number): number {
  return Math.min(3.0, Math.max(0.03, 2.2 * Math.exp(-0.115 * hi)));
}

export function eaglePriorMean(hi: number): number {
  return Math.min(0.15, Math.max(0.001, 0.06 * Math.exp(-0.18 * hi)));
}

/** Gamma-Poisson posterior mean; a null observation contributes zero rounds. */
export function shrunkRate(
  observed: number | null,
  sampleRounds: number,
  priorMean: number,
  priorStrength: number
): number {
  const n = observed != null && observed >= 0 ? Math.max(0, sampleRounds) : 0;
  const obs = observed != null && observed >= 0 ? observed : 0;
  return (obs * n + priorMean * priorStrength) / (n + priorStrength);
}

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

/** Clamped, weighted recent-form drift per hole. */
function formDrift(profile: SimPlayerProfile, weight: number): number {
  const form = Math.max(-FORM_CLAMP, Math.min(FORM_CLAMP, profile.recentForm ?? 0));
  return (weight * form) / 18;
}

/**
 * Expected 18-hole gross for this hole's tee, worked straight back from the
 * player's RAW recency-weighted differential (no internal handicap anchor — the
 * anchor is applied at the level blend in holeMu): AGS ≈ μ_D·slope/113 + rating.
 * Null when the differential or the tee's rating/slope is missing, or the round
 * isn't a full ~18 (a differential is an 18-hole quantity).
 */
function grossFromDifferential(profile: SimPlayerProfile, hole: SimHole): number | null {
  const mu = profile.avgDifferential;
  if (mu == null) return null;
  if (hole.rating == null || hole.slope == null || hole.slope <= 0) return null;
  if (hole.parTotal == null || hole.holesInRound == null || hole.holesInRound < 14) return null;
  return mu * (hole.slope / 113) + hole.rating;
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

export function holeMu(profile: SimPlayerProfile, hole: SimHole, playingHandicap = 0): number {
  const si = siAdjustment(profile.holeSplits, hole);
  const holesInRound = hole.holesInRound != null && hole.holesInRound >= 14 ? hole.holesInRound : 18;
  // Net-consistent anchor (per-hole over par) for thin data: a player with no
  // signal is modelled to shoot PH + POPULATION_GAP over par → net ≈ par +
  // POPULATION_GAP, independent of handicap (so a big handicap can't make you a
  // net favourite). PH is threaded from the engine's per-player playing handicap.
  const anchorLevel = (playingHandicap + POPULATION_GAP) / holesInRound;

  // Differential path: LEVEL from the raw course-normalised differential, blended
  // toward the anchor for thin differential samples; SHAPE from the observed
  // sample; form drift at half weight (recency already in μ_D).
  const diffGross = grossFromDifferential(profile, hole);
  if (diffGross != null && hole.parTotal != null && hole.holesInRound != null) {
    const diffLevel = (diffGross - hole.parTotal) / hole.holesInRound;
    const w = Math.min(1, (profile.differentialEffectiveN ?? 0) / ANCHOR_FULL_SAMPLE_DIFF);
    const level = w * diffLevel + (1 - w) * anchorLevel;
    return level + observedShapeTilt(profile, hole) + si + formDrift(profile, FORM_WEIGHT_DIFFERENTIAL);
  }

  // Gross-average fallback (no differential / no tee rating): the observed gross
  // sample when we have one, else the net-consistent PH anchor.
  const observed = parTypeAvgVsPar(profile, hole.par);
  const w = Math.min(1, profile.sampleSize / ANCHOR_FULL_SAMPLE);
  const base = w * observed + (1 - w) * anchorLevel;
  const bucketAvg = splitBucketAvg(profile.holeSplits, hole);
  const blended =
    bucketAvg != null ? SPLIT_WEIGHT * bucketAvg + (1 - SPLIT_WEIGHT) * base : base;
  return blended + si + formDrift(profile, FORM_WEIGHT);
}

/** Audit detail of the sigma resolution (odds inspector). */
export type SigmaDetail = {
  /** Per-hole sigma the simulation uses (post widening + clamp). */
  sigma: number;
  /** The round-level sigma the per-hole value was derived from. */
  sigmaRound: number;
  /** Which fallback tier supplied sigmaRound. */
  source: "differential" | "observed" | "handicap" | "default";
  /** True when the per-hole clamp [0.5, 2.6] changed the value. */
  clamped: boolean;
};

export function holeSigmaDetailed(profile: SimPlayerProfile, hole?: SimHole): SigmaDetail {
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
  const source: SigmaDetail["source"] = useDifferential
    ? "differential"
    : profile.scoreStddev != null
    ? "observed"
    : profile.handicapIndex != null
    ? "handicap"
    : "default";
  const sigmaRound = useDifferential
    ? profile.differentialStddev! * (hole!.slope! / 113)
    : profile.scoreStddev ??
      (profile.handicapIndex != null
        ? Math.min(9, Math.max(3, 2.6 + 0.13 * Math.max(profile.handicapIndex, 0)))
        : DEFAULT_SIGMA_ROUND);
  const holesInRound = hole?.holesInRound && hole.holesInRound >= 14 ? hole.holesInRound : 18;
  const perHole = sigmaRound / Math.sqrt(holesInRound);
  const widened = perHole * CONFIDENCE_SIGMA_FACTOR[profile.confidence];
  // Wider than V3's [0.7,1.8]: that flattened round σ to ~3–7.6 for everyone, so
  // a volatile player and a steady one simulated almost identically. [0.5,2.6]
  // (round σ ≈ 2.1–11) lets σ_D actually separate them; the top of the range is
  // about all the par−2…par+8 outcome grid can express.
  const sigma = Math.min(2.6, Math.max(0.5, widened));
  return { sigma, sigmaRound, source, clamped: Math.abs(sigma - widened) > 1e-12 };
}

export function holeSigma(profile: SimPlayerProfile, hole?: SimHole): number {
  return holeSigmaDetailed(profile, hole).sigma;
}

/** Discretize N(mu, sigma) over k = par−2 .. par+8 with collapsed tails. */
export function discretizedDistribution(mu: number, sigma: number): number[] {
  const build = (m: number): number[] => {
    const dist = new Array<number>(OUTCOME_BINS).fill(0);
    let prevCdf = 0;
    for (let k = 0; k < OUTCOME_BINS; k++) {
      const upper = k - OUTCOME_OFFSET + 0.5;
      const cdf = k === OUTCOME_BINS - 1 ? 1 : normalCdf((upper - m) / sigma);
      dist[k] = Math.max(0, cdf - prevCdf);
      prevCdf = cdf;
    }
    return normalize(dist);
  };
  // Collapsing the tails into the end bins biases the discrete mean toward the
  // nearer bound (badly for volatile players, whose mass reaches a bound). One
  // Newton step on the target keeps the discrete mean ≈ mu — mean-preserving, so
  // a player's simulated gross matches their modelled level.
  const raw = build(mu);
  const discreteMean = raw.reduce((s, p, k) => s + (k - OUTCOME_OFFSET) * p, 0);
  return build(mu + (mu - discreteMean));
}

function normalize(dist: number[]): number[] {
  const total = dist.reduce((s, p) => s + p, 0);
  if (total <= 0) {
    const uniform = new Array<number>(dist.length).fill(1 / dist.length);
    return uniform;
  }
  return dist.map((p) => p / total);
}

/** Audit trail of one player's rare-event calibration (odds inspector). */
export type CalibrationMeta = {
  birdie: {
    observedRate: number | null;
    sampleRounds: number;
    priorMean: number;
    priorStrength: number;
    /** λ*: shrunk birdies/round the sim is calibrated to. */
    targetRate: number;
    /** T = λ* × holes/18 — target mass over these holes. */
    targetMass: number;
    /** Raw discretized-normal mass before any calibration (first pass). */
    preMass: number;
    /** Σ P(birdie-or-better) after the final pass — equals targetMass unless capped. */
    postMass: number;
    /** Final global scale factor applied to the birdie bins. */
    factor: number;
    /** True when the 0.95-per-hole guard capped the factor short of the target. */
    capped: boolean;
  };
  eagle: {
    observedRate: number | null;
    sampleRounds: number;
    priorMean: number;
    priorStrength: number;
    targetRate: number;
    targetMass: number;
    preMass: number;
    postMass: number;
    capped: boolean;
  };
  /** Max per-hole |holeMu − E[score]| after the final pass (strokes). */
  meanResidual: number;
  /** Fixed-point passes run (1 when already converged). */
  iterations: number;
};

const CALIBRATION_EPS = 1e-9;
// Fixed-point convergence is a damped contraction but can be slow when the
// calibration removes a lot of birdie mass (heavy downscales contract ~0.75/
// pass); a pass is only holes × bins CDF evaluations, so run plenty.
const CALIBRATION_MAX_PASSES = 20;
const CALIBRATION_MEAN_TOL = 0.01; // strokes per hole
const CALIBRATION_MU_ADJ_CLAMP = 2; // strokes per hole
/** Birdie mass on a single hole never scales above this (keeps bins sane). */
const CALIBRATION_MAX_HOLE_MASS = 0.95;

/** Exact mass-transfer calibration, in place. Returns the audit numbers. */
function calibrateDistributions(
  dists: number[][],
  targetBirdieMass: number,
  targetEagleMass: number
): { factor: number; capped: boolean; eagleCapped: boolean } {
  const birdieMass = dists.map((d) => d[0] + d[1]);
  const total = birdieMass.reduce((s, x) => s + x, 0);
  let factor = 1;
  let capped = false;
  if (total > CALIBRATION_EPS) {
    // One GLOBAL factor preserves the relative birdie shape across holes and
    // makes Σ birdie mass land on the target exactly; the cap only binds under
    // absurd targets (recorded so the audit can show the shortfall).
    const maxHole = Math.max(...birdieMass);
    const factorCap = maxHole > CALIBRATION_EPS ? CALIBRATION_MAX_HOLE_MASS / maxHole : 1;
    factor = targetBirdieMass / total;
    if (factor > factorCap) {
      factor = factorCap;
      capped = true;
    }
    for (let i = 0; i < dists.length; i++) {
      const d = dists[i];
      const bh = birdieMass[i];
      if (bh <= CALIBRATION_EPS) continue;
      const nonBirdie = 1 - bh;
      d[0] *= factor;
      d[1] *= factor;
      if (nonBirdie <= CALIBRATION_EPS) {
        // Degenerate hole (all mass birdie-or-better): park the removed mass on par.
        d[2] += (1 - factor) * bh;
      } else {
        // Scale the other bins so the hole still sums to exactly 1 — this is
        // what the old normalize() got wrong (it re-divided the birdie bins
        // too, pulling the "calibrated" mass off target).
        const g = (1 - factor * bh) / nonBirdie;
        for (let k = 2; k < OUTCOME_BINS; k++) d[k] *= g;
      }
    }
  }

  // Eagle bin is set WITHIN the birdie-or-better mass (moving weight between
  // k=0 and k=1) so the just-calibrated birdie total is untouched.
  let eagleCapped = false;
  const eagleTotal = dists.reduce((s, d) => s + d[0], 0);
  if (eagleTotal > CALIBRATION_EPS) {
    const eagleFactor = targetEagleMass / eagleTotal;
    for (const d of dists) {
      const bb = d[0] + d[1];
      const d0 = Math.min(eagleFactor * d[0], CALIBRATION_MAX_HOLE_MASS * bb);
      if (d0 < eagleFactor * d[0] - CALIBRATION_EPS) eagleCapped = true;
      d[1] = bb - d0;
      d[0] = d0;
    }
  }

  return { factor, capped, eagleCapped };
}

/**
 * Build the outcome distribution for every hole, calibrated so that:
 *   1. Σ P(birdie-or-better) = λ*_birdie × holes/18 EXACTLY, where λ* is the
 *      observed rate shrunk toward the handicap prior (Gamma-Poisson);
 *   2. Σ P(eagle-or-better) ≈ λ*_eagle × holes/18, moved within the birdie
 *      mass so (1) survives;
 *   3. each hole's expected score still equals holeMu — a fixed-point loop
 *      re-targets the latent mean because calibration shifts it (removing
 *      overstated birdie mass would otherwise raise the simulated gross).
 * Returns the distributions plus the full audit trail.
 */
export function buildHoleDistributionsDetailed(
  profile: SimPlayerProfile,
  holes: SimHole[],
  playingHandicap = 0
): { dists: number[][]; meta: CalibrationMeta } {
  // Handicap proxy for the priors, per the model's handicap-as-prior doctrine:
  // HI, else the differential level minus the population gap, else the PH.
  const hiProxy =
    profile.handicapIndex ??
    (profile.avgDifferential != null ? profile.avgDifferential - POPULATION_GAP : playingHandicap);

  const birdieRounds = profile.birdiesPerRound != null ? profile.sampleSize : 0;
  const eagleRounds = profile.eaglesPerRound != null ? profile.sampleSize : 0;
  const birdiePrior = birdiePriorMean(hiProxy);
  const eaglePrior = eaglePriorMean(hiProxy);
  const birdieTargetRate = shrunkRate(
    profile.birdiesPerRound,
    birdieRounds,
    birdiePrior,
    BIRDIE_PRIOR_STRENGTH
  );
  // Eagles are a subset of birdie-or-better, so the target can never exceed it.
  const eagleTargetRate = Math.min(
    birdieTargetRate,
    shrunkRate(profile.eaglesPerRound, eagleRounds, eaglePrior, EAGLE_PRIOR_STRENGTH)
  );

  const perRoundScale = holes.length / 18;
  const targetBirdieMass = birdieTargetRate * perRoundScale;
  const targetEagleMass = eagleTargetRate * perRoundScale;

  const mus = holes.map((hole) => holeMu(profile, hole, playingHandicap));
  const sigmas = holes.map((hole) => holeSigma(profile, hole));
  const muAdj = mus.slice();

  let dists: number[][] = [];
  let preMass = 0;
  let preEagleMass = 0;
  let factor = 1;
  let capped = false;
  let eagleCapped = false;
  let meanResidual = 0;
  let iterations = 0;

  for (let pass = 0; pass < CALIBRATION_MAX_PASSES && holes.length > 0; pass++) {
    iterations = pass + 1;
    dists = holes.map((_, i) => discretizedDistribution(muAdj[i], sigmas[i]));
    if (pass === 0) {
      preMass = dists.reduce((s, d) => s + d[0] + d[1], 0);
      preEagleMass = dists.reduce((s, d) => s + d[0], 0);
    }
    const cal = calibrateDistributions(dists, targetBirdieMass, targetEagleMass);
    factor = cal.factor;
    capped = cal.capped;
    eagleCapped = cal.eagleCapped;

    // Calibration is always the LAST operation on the distributions (birdie
    // exactness prices the birdie markets); the loop only decides whether the
    // latent means need another nudge.
    meanResidual = 0;
    const residuals = new Array<number>(holes.length).fill(0);
    for (let i = 0; i < holes.length; i++) {
      const mean = dists[i].reduce((s, p, k) => s + (k - OUTCOME_OFFSET) * p, 0);
      residuals[i] = mus[i] - mean;
      meanResidual = Math.max(meanResidual, Math.abs(residuals[i]));
    }
    if (meanResidual < CALIBRATION_MEAN_TOL || pass === CALIBRATION_MAX_PASSES - 1) break;
    for (let i = 0; i < holes.length; i++) {
      muAdj[i] = Math.min(
        mus[i] + CALIBRATION_MU_ADJ_CLAMP,
        Math.max(mus[i] - CALIBRATION_MU_ADJ_CLAMP, muAdj[i] + residuals[i])
      );
    }
  }

  const postMass = dists.reduce((s, d) => s + d[0] + d[1], 0);
  const postEagleMass = dists.reduce((s, d) => s + d[0], 0);

  return {
    dists,
    meta: {
      birdie: {
        observedRate: profile.birdiesPerRound,
        sampleRounds: birdieRounds,
        priorMean: birdiePrior,
        priorStrength: BIRDIE_PRIOR_STRENGTH,
        targetRate: birdieTargetRate,
        targetMass: targetBirdieMass,
        preMass,
        postMass,
        factor,
        capped,
      },
      eagle: {
        observedRate: profile.eaglesPerRound,
        sampleRounds: eagleRounds,
        priorMean: eaglePrior,
        priorStrength: EAGLE_PRIOR_STRENGTH,
        targetRate: eagleTargetRate,
        targetMass: targetEagleMass,
        preMass: preEagleMass,
        postMass: postEagleMass,
        capped: eagleCapped,
      },
      meanResidual,
      iterations,
    },
  };
}

/** Distribution-only wrapper — what the simulation engine consumes. */
export function buildHoleDistributions(
  profile: SimPlayerProfile,
  holes: SimHole[],
  playingHandicap = 0
): number[][] {
  return buildHoleDistributionsDetailed(profile, holes, playingHandicap).dists;
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
