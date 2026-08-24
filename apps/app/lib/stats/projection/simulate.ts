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
import { levelChangePerRound, sampleFloor } from "./improvement";
import type { DiffPoint } from "@/lib/stats/projectionData";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Rounds over which a player's OWN recent slope decays to nothing.
 *
 * Calibrated, not guessed: regressing a player's next-20-round slope on their
 * prior-20-round slope gives 0.13, which is a half-life of about 7 rounds.
 * Momentum is real but short-lived — sustained improvement comes from the
 * level/experience curve in ./improvement.ts, not from extrapolating a streak.
 */
export const TREND_DAMPING_ROUNDS = 7;
/** Total strokes a momentum term may ever contribute, however strong it looks. */
export const MAX_TREND_STROKES = 2.0;
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

/**
 * How far back the residual pool reaches. Recent noise is the relevant noise,
 * and it keeps the pool inside the range where the recency-weighted trend line
 * actually describes the data.
 */
export const RESIDUAL_WINDOW_ROUNDS = 60;

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
  /**
   * The simulated indices on a date, sorted ascending. Raw material for
   * comparisons; prefer the named queries above for anything else.
   */
  samplesAt: (dateISO: string) => Float32Array | null;
  /**
   * P(this player's index is lower than the other player's on that date).
   *
   * The honest head-to-head. It replaced a "your trends cross on DATE" readout
   * computed by intersecting two fitted curves — a date with no uncertainty
   * attached and no chance of being right.
   */
  probBelowOther: (other: Projection, dateISO: string) => number | null;
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
 * Five years, because the question the page exists to answer — "when will I go
 * scratch?" — is a multi-year question for anyone who is not already close.
 *
 * With antithetic pairing, 1000 paths put the standard error of the median near
 * 0.06 HI and of the p10/p90 near 0.09, comfortably inside the 0.1 the page
 * displays. More paths would buy precision nobody can see.
 */
const DEFAULTS = { horizonDays: 1826, sims: 1000, gridDays: 7 };

/** Reduced settings for the compare-all sweep, where a dozen players are built at once. */
export const SWEEP_SETTINGS = { sims: 400, gridDays: 60 };

/**
 * Work budget in simulated round-postings, used to scale the path count down for
 * players who post a lot of rounds.
 *
 * Cost is `sims × rounds-per-path`, and rounds-per-path tracks cadence: over five
 * years a 25-round-a-year player simulates ~125 rounds while a 110-a-year player
 * simulates ~550. Without this the second player waits four times as long for
 * the same page. Measured at roughly 3.3us per posting, so this lands near half
 * a second on a development desktop.
 */
const WORK_BUDGET_POSTINGS = 150_000;
/** Never drop below this many paths — the quantiles stop meaning anything. */
const MIN_SIMS = 300;

/**
 * Grid resolution past the near term. Weekly detail matters for the next couple
 * of years; beyond that the fan is wide and smooth and monthly points carry it
 * just as well, for a third of the memory.
 */
const FINE_GRID_DAYS_LIMIT = 730;
const COARSE_GRID_MULTIPLE = 4;

/**
 * Grid day-offsets from today: fine early, coarse later, always reaching the
 * horizon exactly so the furthest date the UI offers can be answered.
 */
function buildGridOffsets(horizonDays: number, gridDays: number): number[] {
  const offsets: number[] = [];
  let d = 0;
  while (d < horizonDays) {
    offsets.push(d);
    d += d < FINE_GRID_DAYS_LIMIT ? gridDays : gridDays * COARSE_GRID_MULTIPLE;
  }
  offsets.push(horizonDays);
  return offsets;
}

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
  const requestedSims = input.sims ?? DEFAULTS.sims;
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
  // up to the horizon can land short, and the furthest date the picker offers is
  // exactly what clampToHorizon hands back — which then fell off the end and got
  // "beyond the horizon".
  const gridOffsets = buildGridOffsets(horizonDays, gridDays);
  const gridDayIndices = gridOffsets.map((d) => todayDayIndex + d);

  // Scale the path count to what this player's cadence will cost, so a
  // 110-round-a-year player does not wait four times as long as everyone else.
  const expectedRounds = Math.max(
    1,
    Math.round((horizonDays * Math.max(1, cadence.roundsPerYear)) / 365)
  );
  const sims = Math.max(
    2,
    Math.min(requestedSims, Math.max(MIN_SIMS, Math.round(WORK_BUDGET_POSTINGS / expectedRounds))) & ~1
  );

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

  /**
   * The player's scoring level right now, and the starting point of every path.
   *
   * `stats.levelNow` projects the fitted line forward to the newest round, which
   * is right when there IS a trend — the plain weighted mean sits at a centroid
   * ~28 rounds back and would start an improving player too high. But it applies
   * `mean − slope × rMean` using the RAW slope, so for a player with no real
   * trend it multiplies slope NOISE by 28 and injects a stroke or more of error
   * into the starting level. That error then shows up as a phantom rise or fall
   * as the counting window turns over. Gate it on the same significance test the
   * momentum term uses.
   */
  const levelNow = trendSignificant ? stats.levelNow : stats.mean;

  const tau = TREND_DAMPING_ROUNDS;
  /**
   * Short-lived momentum: the player's OWN recent slope, decaying with a
   * half-life of ~7 rounds because that is all the persistence the data shows.
   * Sustained improvement is not this — it is the level/experience curve applied
   * per round inside runPath.
   */
  const momentumAt = (j: number) => {
    if (trendPerRound === 0) return 0;
    const raw = -trendPerRound * tau * (1 - Math.exp(-j / tau));
    return Math.max(-MAX_TREND_STROKES, Math.min(MAX_TREND_STROKES, raw));
  };

  // Detrended residuals, for bootstrapping the player's own shape (blow-up
  // rounds are right-skewed; a normal draw would never produce one).
  const residuals: number[] = [];
  if (stats.rMean !== null && stats.trendPerRound !== null) {
    // Only the recent window. The fitted line uses a RECENCY-WEIGHTED slope
    // through a centroid ~28 rounds back, so extrapolating it across a 250-round
    // history puts it far from the data at the old end and makes those residuals
    // systematically signed.
    const windowLen = Math.min(diffsNewestFirst.length, RESIDUAL_WINDOW_ROUNDS);
    for (let r = 0; r < windowLen; r++) {
      residuals.push(diffsNewestFirst[r] - (stats.mean + stats.trendPerRound * (r - stats.rMean)));
    }
    // Re-centre. A bootstrap shock has to be zero-mean or it silently shifts the
    // whole projection: any residual bias is added to every simulated round, and
    // over hundreds of rounds it dwarfs the improvement curve it is riding on.
    const bias = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    for (let i = 0; i < residuals.length; i++) residuals[i] -= bias;
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

    // Each path gets its own ceiling. This is where the honest uncertainty about
    // how good a player can ultimately get enters the fan — and it is what makes
    // "when will I go scratch" a probability rather than a date. See the header
    // of ./improvement.ts: the floor is a prior, not a measurement.
    const floor = sampleFloor(levelNow, nextNormal(rand, sign), nextNormal(rand, sign));

    let day = todayDayIndex + firstGapDays(cadence, draw, rand);
    let j = 1;
    let g = 0;
    let hi = currentTenths === null ? NaN : fromTenths(currentTenths);
    let best = hi;
    // The player's ability, which now moves as they play.
    let level = levelNow;

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

      // Sustained improvement: ability decays toward this path's floor, in
      // proportion to headroom. Momentum rides on top and dies within a few rounds.
      level += levelChangePerRound(level, floor);
      const mu = level + momentumAt(j);
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

  /**
   * Nearest grid point to a date, by binary search — the grid is no longer
   * uniformly spaced (fine for the first two years, coarse beyond), so index
   * arithmetic on `gridDays` would silently point at the wrong column.
   */
  const gridIndexFor = (dateISO: string): number | null => {
    const d = dayIndexFromISO(dateISO);
    if (d < gridDayIndices[0] || d > gridDayIndices[G - 1]) return null;

    let lo = 0;
    let hi = G - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (gridDayIndices[mid] <= d) lo = mid;
      else hi = mid;
    }
    return d - gridDayIndices[lo] <= gridDayIndices[hi] - d ? lo : hi;
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
    samplesAt: (dateISO) => {
      const g = gridIndexFor(dateISO);
      return g === null ? null : sortedPaths.subarray(g * sims, (g + 1) * sims);
    },
    probBelowOther: (other, dateISO) => {
      const g = gridIndexFor(dateISO);
      if (g === null) return null;
      const theirs = other.samplesAt(dateISO);
      if (!theirs || !theirs.length) return null;
      return probLess(sortedPaths.subarray(g * sims, (g + 1) * sims), theirs);
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

/**
 * P(a < b) for two independent sorted samples, ties split evenly.
 *
 * An all-pairs estimate by merge walk, O(na + nb). Two deliberate choices:
 *
 *   - All-pairs rather than index-pairing. Pairing path i of one player with
 *     path i of the other is a valid draw from the joint under independence, but
 *     it is noisier and it silently requires equal path counts — which this
 *     engine does NOT have, because `sims` scales with each player's cadence.
 *   - Ties count a half each, so P(a<b) + P(b<a) = 1. Handicap indices are
 *     quoted to a tenth, so exact ties carry real mass; counting them as losses
 *     for both players would show two golfers each with under 50%.
 */
function probLess(a: Float32Array, b: Float32Array): number {
  const na = a.length;
  const nb = b.length;
  if (!na || !nb) return 0.5;

  let lo = 0; // count of a strictly below b[j]
  let hi = 0; // count of a at or below b[j]
  let lt = 0;
  let eq = 0;

  for (let j = 0; j < nb; j++) {
    const v = b[j];
    while (lo < na && a[lo] < v) lo++;
    while (hi < na && a[hi] <= v) hi++;
    lt += lo;
    eq += hi - lo;
  }
  return (lt + 0.5 * eq) / (na * nb);
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
    samplesAt: () => null,
    probBelowOther: () => null,
    etaDistribution: () => ({ p10Days: null, p50Days: null, p90Days: null, probEver: 0 }),
    realisticFloor: null,
    diagnostics,
  };
}
