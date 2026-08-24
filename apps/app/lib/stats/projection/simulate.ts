// lib/stats/projection/simulate.ts
//
// Forward projection of a Handicap Index by simulating future ROUNDS and
// replaying the real WHS arithmetic over them.
//
// The model this replaces fitted HI(t) = a·e^(−b·t) + c to the handicap history
// and read the answer off the curve. That treats HI as a smooth function of
// calendar time, which it is not:
//
//   - HI is the mean of the lowest k of the last 20 differentials. It is a step
//     function that only moves when a score is posted.
//   - k and the small-sample adjustment CHANGE as a player accumulates rounds.
//     A player of perfectly constant ability drifts UPWARD from round 5 to round
//     20, because best-1-of-5 is a much better score than best-8-of-20. Fitting
//     a decay curve to that reads a mechanical artefact as improvement and
//     extrapolates it forever — for a society whose players carry 5–30 accepted
//     rounds, this was the dominant source of nonsense ETAs.
//   - The soft/hard caps against the trailing-365-day low bound how fast an
//     index can rise, and the 54.0 ceiling bounds it absolutely.
//
// So: sample future scoring, post it through lib/whs/handicapIndex.ts (proven
// equivalent to the database in lib/whs/__tests__/replay.fixture.test.ts), and
// report the distribution that comes out.

import { recencyWeightedDifferentialStats } from "@/lib/fantasy/simulation/differentials";
import { hashSeed, mulberry32, nextNormal } from "@/lib/fantasy/simulation/rng";
import {
  cloneWhsState,
  currentIndexTenths,
  dayIndexFromISO,
  fromTenths,
  initWhsState,
  isoFromDayIndex,
  lowestOfNCount,
  postInPlace,
  toTenths,
  windowSize,
  type WhsState,
} from "@/lib/whs/handicapIndex";
import {
  estimateCadence,
  firstGapDays,
  startCadenceDraw,
  type CadenceModel,
} from "./cadence";
import type { DiffPoint } from "@/lib/stats/projectionData";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Rounds over which a fitted trend decays to nothing. Nobody improves linearly
 * forever; without damping, a hot streak projects a scratch handicap.
 */
export const TREND_DAMPING_ROUNDS = 12;
/** Total strokes a trend may ever contribute, however strong it looks. */
export const MAX_TREND_STROKES = 3.0;
/** A trend must clear this many standard errors before it is extrapolated at all. */
export const TREND_SIGNIFICANCE = 1.5;
/** Below this effective sample size no trend is applied, significant or not. */
export const TREND_MIN_EFFECTIVE_N = 8;

/**
 * Strength of the population prior on round-to-round spread, in pseudo-rounds.
 * With 8 observations the estimate is half prior, half player.
 */
export const SIGMA_PRIOR_STRENGTH = 8;

/**
 * Population spread prior as a function of Handicap Index.
 *
 * TUNABLE — a plausible starting point, not a derived constant. Recalibrate from
 * `fantasy_player_profiles.differential_stddev` once there is enough data; see
 * docs/projections.md.
 */
export function priorSigmaFor(handicapIndex: number | null): number {
  const hi = handicapIndex ?? 18;
  return 2.5 + 0.06 * Math.max(0, hi);
}

/** Bootstrap the player's own residuals only once there are enough to resample. */
export const MIN_BOOTSTRAP_RESIDUALS = 12;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectionStatus = "no_data" | "pre_index" | "mechanical" | "simulated";
export type ProjectionConfidence = "low" | "medium" | "high";

export type Quantiles = { p10: number; p25: number; p50: number; p75: number; p90: number };
export type FanPoint = Quantiles & { dayIndex: number; dateISO: string };

export type EtaDistribution = {
  p10Days: number | null;
  p50Days: number | null;
  p90Days: number | null;
  /** Share of paths that ever reach the target within the horizon. */
  probEver: number;
};

export type ProjectionDiagnostics = {
  levelNow: number | null;
  sigma: number | null;
  sigmaShrunk: boolean;
  trendPerRound: number | null;
  trendApplied: boolean;
  effectiveN: number;
  sampleSize: number;
  roundsPerYear: number;
  dormancyDays: number;
  dormant: boolean;
  cadenceMethod: CadenceModel["method"];
  windowSize: number;
  lowestOfN: number;
  sims: number;
};

export type Projection = {
  status: ProjectionStatus;
  confidence: ProjectionConfidence;
  /** The player's index today, from replaying their own history. */
  currentHi: number | null;
  /** WHS state as of today — what "one more round" would act on. */
  state: WhsState;
  todayDayIndex: number;
  fan: FanPoint[];
  hiAtDate: (dateISO: string) => Quantiles | null;
  /** P(index ≤ target at ANY point on or before the date). */
  probReachBy: (target: number, dateISO: string) => number | null;
  /** P(index ≤ target ON the date). A different, usually smaller, question. */
  probBelowAt: (target: number, dateISO: string) => number | null;
  etaDistribution: (target: number) => EtaDistribution;
  /** Where the index settles if the player keeps playing at their current standard. */
  realisticFloor: { p10: number; p50: number; p90: number } | null;
  diagnostics: ProjectionDiagnostics;
};

export type ProjectionInput = {
  stream: readonly DiffPoint[];
  today: Date;
  horizonDays?: number;
  sims?: number;
  gridDays?: number;
  seedKey?: string;
};

// ---------------------------------------------------------------------------

/**
 * Simulation defaults.
 *
 * `sims` is 1000 rather than a rounder-sounding 2000 because the cost is real:
 * a full build is ~200–400ms on a desktop and several times that on a phone.
 * With antithetic pairing, 1000 paths put the standard error of the median near
 * 0.06 HI and of the p10/p90 near 0.09 — comfortably inside the 0.1 the page
 * displays, so more paths would buy precision no one can see.
 *
 * The cost is paid once per profile per page load; the target wheel and date
 * picker are pure lookups against the finished matrix.
 */
const DEFAULTS = { horizonDays: 730, sims: 1000, gridDays: 7 };

/** Reduced settings for the compare-all sweep, where a dozen players are built at once. */
export const SWEEP_SETTINGS = { sims: 400, gridDays: 30 };

function quantileFromSorted(sorted: Float32Array, offset: number, count: number, q: number) {
  const idx = Math.min(count - 1, Math.max(0, Math.round(q * (count - 1))));
  return sorted[offset + idx];
}

/**
 * Build a full predictive distribution for a player's Handicap Index.
 *
 * Deterministic for a given `seedKey`.
 */
export function buildProjection(input: ProjectionInput): Projection {
  const horizonDays = input.horizonDays ?? DEFAULTS.horizonDays;
  const gridDays = input.gridDays ?? DEFAULTS.gridDays;
  // Antithetic pairing needs an even count.
  const sims = Math.max(2, (input.sims ?? DEFAULTS.sims) & ~1);
  const todayDayIndex = dayIndexFromISO(toISODate(input.today));

  const rows = [...input.stream]
    .filter((r) => Number.isFinite(r.v))
    .map((r) => ({ dayIndex: dayIndexFromISO(r.d), diffTenths: toTenths(r.v) }))
    .sort((a, b) => a.dayIndex - b.dayIndex);

  const state = initWhsState(rows);
  const currentTenths = currentIndexTenths(state);
  const currentHi = currentTenths === null ? null : fromTenths(currentTenths);

  const cadence = estimateCadence(
    rows.map((r) => r.dayIndex),
    todayDayIndex
  );

  // Newest-first is the order recencyWeightedDifferentialStats expects.
  const diffsNewestFirst = rows.map((r) => fromTenths(r.diffTenths)).reverse();
  const stats = recencyWeightedDifferentialStats(diffsNewestFirst);

  const status = statusFor(rows.length);

  // The grid must REACH the horizon, not stop short of it. Stepping `d += 7`
  // up to 730 lands on 728, so a caller asking about the horizon date itself —
  // which is exactly what clampToHorizon hands us when a user picks the furthest
  // date the picker allows — fell off the end and got "beyond the horizon".
  const gridCount = Math.ceil(horizonDays / gridDays);
  const gridDayIndices: number[] = [];
  for (let i = 0; i <= gridCount; i++) gridDayIndices.push(todayDayIndex + i * gridDays);

  const diagnosticsBase: ProjectionDiagnostics = {
    levelNow: stats?.levelNow ?? null,
    sigma: null,
    sigmaShrunk: false,
    trendPerRound: stats?.trendPerRound ?? null,
    trendApplied: false,
    effectiveN: stats?.effectiveN ?? 0,
    sampleSize: rows.length,
    roundsPerYear: cadence.roundsPerYear,
    dormancyDays: cadence.dormancyDays,
    dormant: cadence.dormant,
    cadenceMethod: cadence.method,
    windowSize: windowSize(state),
    lowestOfN: lowestOfNCount(windowSize(state)),
    sims: 0,
  };

  if (status !== "simulated" || !stats) {
    return emptyProjection(status, currentHi, state, todayDayIndex, diagnosticsBase);
  }

  // ---- Level, spread, trend --------------------------------------------------

  const levelNow = stats.levelNow;

  const priorSigma = priorSigmaFor(currentHi);
  const observedSigma = stats.stddev;
  const nEff = stats.effectiveN;
  const sigma =
    observedSigma !== null && observedSigma > 0
      ? Math.sqrt(
          (nEff * observedSigma * observedSigma + SIGMA_PRIOR_STRENGTH * priorSigma * priorSigma) /
            (nEff + SIGMA_PRIOR_STRENGTH)
        )
      : priorSigma;
  const sigmaShrunk = observedSigma === null || nEff < 4 * SIGMA_PRIOR_STRENGTH;

  // Index 0 is the newest round, so a POSITIVE trendPerRound means the player is
  // improving; the forward per-round change is its negation.
  const trendSignificant =
    stats.trendPerRound !== null &&
    stats.trendStdErr !== null &&
    stats.trendStdErr > 0 &&
    nEff >= TREND_MIN_EFFECTIVE_N &&
    Math.abs(stats.trendPerRound) > TREND_SIGNIFICANCE * stats.trendStdErr;

  const trendPerRound = trendSignificant ? stats.trendPerRound! : 0;
  const tau = TREND_DAMPING_ROUNDS;
  /** Cumulative trend contribution after j future rounds, damped and clamped. */
  const trendAt = (j: number) => {
    if (trendPerRound === 0) return 0;
    const raw = -trendPerRound * tau * (1 - Math.exp(-j / tau));
    return Math.max(-MAX_TREND_STROKES, Math.min(MAX_TREND_STROKES, raw));
  };

  // Detrended residuals, for bootstrapping the player's own shape (blow-up
  // rounds are right-skewed; a normal draw would never produce one).
  const residuals: number[] = [];
  if (stats.rMean !== null && stats.trendPerRound !== null) {
    for (let r = 0; r < diffsNewestFirst.length; r++) {
      residuals.push(diffsNewestFirst[r] - (stats.mean + stats.trendPerRound * (r - stats.rMean)));
    }
  }
  const useBootstrap = residuals.length >= MIN_BOOTSTRAP_RESIDUALS;

  // ---- Simulate --------------------------------------------------------------

  const G = gridDayIndices.length;
  const paths = new Float32Array(G * sims); // grid-major: [g * sims + s]
  const runningMin = new Float32Array(G * sims);
  const seed = hashSeed(input.seedKey ?? "projection", rows.length, todayDayIndex);

  // Antithetic pairing. Both paths of a pair replay the SAME uniform stream, so
  // they see identical cadence draws (common random numbers) and differ only in
  // the sign of the scoring shock. Feeding mirrored uniforms into Box–Muller
  // would NOT do this — cos(2π(1−u)) = cos(2πu), so the normal comes back
  // unchanged; the negation has to be applied to the draw itself.
  for (let pair = 0; pair < sims / 2; pair++) {
    runPath(2 * pair, mulberry32(seed + pair), 1);
    runPath(2 * pair + 1, mulberry32(seed + pair), -1);
  }

  function runPath(sim: number, rand: () => number, sign: number) {
    const s = cloneWhsState(state);
    const draw = startCadenceDraw(cadence, rand);

    let day = todayDayIndex + firstGapDays(cadence, draw, rand);
    let j = 1;
    let g = 0;
    let hi = currentTenths === null ? NaN : fromTenths(currentTenths);
    let best = hi;

    while (g < G) {
      // Carry the current index forward across every grid point before the next
      // round — a Handicap Index is constant between postings.
      while (g < G && gridDayIndices[g] < day) {
        paths[g * sims + sim] = hi;
        best = Math.min(best, hi);
        runningMin[g * sims + sim] = best;
        g++;
      }
      if (g >= G) break;

      const mu = levelNow + trendAt(j);
      let shock: number;
      if (useBootstrap) {
        // The antithetic partner takes the mirrored rank, which is the analogue
        // of negating a normal for a sample that is not symmetric.
        const u = rand();
        const raw = Math.min(residuals.length - 1, Math.floor(u * residuals.length));
        shock = residuals[sign > 0 ? raw : residuals.length - 1 - raw];
      } else {
        shock = nextNormal(rand, sign) * sigma;
      }

      const resultTenths = postInPlace(s, day, toTenths(mu + shock));
      if (resultTenths !== null) hi = fromTenths(resultTenths);

      day += draw.nextGap(rand);
      j++;
    }
  }

  // Sort each grid row once so quantile lookups are O(1).
  const sortedPaths = new Float32Array(G * sims);
  const sortedMins = new Float32Array(G * sims);
  for (let g = 0; g < G; g++) {
    const row = paths.slice(g * sims, (g + 1) * sims).sort();
    sortedPaths.set(row, g * sims);
    const mins = runningMin.slice(g * sims, (g + 1) * sims).sort();
    sortedMins.set(mins, g * sims);
  }

  const quantilesAt = (g: number): Quantiles => ({
    p10: quantileFromSorted(sortedPaths, g * sims, sims, 0.1),
    p25: quantileFromSorted(sortedPaths, g * sims, sims, 0.25),
    p50: quantileFromSorted(sortedPaths, g * sims, sims, 0.5),
    p75: quantileFromSorted(sortedPaths, g * sims, sims, 0.75),
    p90: quantileFromSorted(sortedPaths, g * sims, sims, 0.9),
  });

  const fan: FanPoint[] = gridDayIndices.map((dayIndex, g) => ({
    dayIndex,
    dateISO: isoFromDayIndex(dayIndex),
    ...quantilesAt(g),
  }));

  const gridIndexFor = (dateISO: string): number | null => {
    const d = dayIndexFromISO(dateISO);
    if (d < gridDayIndices[0] || d > gridDayIndices[G - 1]) return null;
    return Math.min(G - 1, Math.round((d - todayDayIndex) / gridDays));
  };

  const share = (row: Float32Array, offset: number, target: number) => {
    // Sorted ascending — count entries <= target by binary search.
    let lo = 0;
    let hi = sims;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (row[offset + mid] <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo / sims;
  };

  const diagnostics: ProjectionDiagnostics = {
    ...diagnosticsBase,
    sigma,
    sigmaShrunk,
    trendApplied: trendSignificant,
    sims,
  };

  return {
    status,
    confidence: confidenceFor(rows.length, nEff, cadence),
    currentHi,
    state,
    todayDayIndex,
    fan,
    hiAtDate: (dateISO) => {
      const g = gridIndexFor(dateISO);
      return g === null ? null : quantilesAt(g);
    },
    probBelowAt: (targetHi, dateISO) => {
      const g = gridIndexFor(dateISO);
      return g === null ? null : share(sortedPaths, g * sims, targetHi);
    },
    probReachBy: (targetHi, dateISO) => {
      const g = gridIndexFor(dateISO);
      return g === null ? null : share(sortedMins, g * sims, targetHi);
    },
    etaDistribution: (targetHi) => etaFrom(runningMin, sims, G, gridDayIndices, todayDayIndex, targetHi),
    realisticFloor: {
      p10: quantileFromSorted(sortedPaths, (G - 1) * sims, sims, 0.1),
      p50: quantileFromSorted(sortedPaths, (G - 1) * sims, sims, 0.5),
      p90: quantileFromSorted(sortedPaths, (G - 1) * sims, sims, 0.9),
    },
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function statusFor(sampleSize: number): ProjectionStatus {
  if (sampleSize === 0) return "no_data";
  if (sampleSize < 3) return "pre_index";
  if (sampleSize < 8) return "mechanical";
  return "simulated";
}

/**
 * How much weight the projection can carry. Independently capped at `low` when
 * the cadence model is running on the prior or the player has gone quiet — the
 * dates depend on rounds that may simply not be played.
 */
function confidenceFor(
  sampleSize: number,
  effectiveN: number,
  cadence: CadenceModel
): ProjectionConfidence {
  if (cadence.method === "prior" || cadence.dormancyDays > 120) return "low";
  if (sampleSize >= 40 && effectiveN >= 12) return "high";
  if (sampleSize >= 20) return "medium";
  return "low";
}

function etaFrom(
  runningMin: Float32Array,
  sims: number,
  G: number,
  gridDayIndices: number[],
  todayDayIndex: number,
  targetHi: number
): EtaDistribution {
  const firstHit: number[] = [];
  let crossed = 0;

  for (let s = 0; s < sims; s++) {
    let hitDay: number | null = null;
    for (let g = 0; g < G; g++) {
      if (runningMin[g * sims + s] <= targetHi) {
        hitDay = gridDayIndices[g] - todayDayIndex;
        break;
      }
    }
    if (hitDay !== null) {
      crossed++;
      firstHit.push(hitDay);
    }
  }

  if (!firstHit.length) return { p10Days: null, p50Days: null, p90Days: null, probEver: 0 };

  firstHit.sort((a, b) => a - b);
  const at = (q: number) => firstHit[Math.min(firstHit.length - 1, Math.round(q * (firstHit.length - 1)))];

  const probEver = crossed / sims;
  return {
    p10Days: at(0.1),
    p50Days: probEver >= 0.5 ? at(0.5) : null,
    p90Days: probEver >= 0.9 ? at(0.9) : null,
    probEver,
  };
}

function emptyProjection(
  status: ProjectionStatus,
  currentHi: number | null,
  state: WhsState,
  todayDayIndex: number,
  diagnostics: ProjectionDiagnostics
): Projection {
  return {
    status,
    confidence: "low",
    currentHi,
    state,
    todayDayIndex,
    fan: [],
    hiAtDate: () => null,
    probReachBy: () => null,
    probBelowAt: () => null,
    etaDistribution: () => ({ p10Days: null, p50Days: null, p90Days: null, probEver: 0 }),
    realisticFloor: null,
    diagnostics,
  };
}
