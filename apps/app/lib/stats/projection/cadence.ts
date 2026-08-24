// lib/stats/projection/cadence.ts
//
// How often this player actually posts a score.
//
// A Handicap Index moves per ROUND, not per day: it is the mean of the lowest k
// of the last 20 differentials, so a player posting four rounds a month cycles
// their counting window in five months while one posting monthly takes twenty.
// Projecting to a calendar DATE therefore requires a model of how many rounds
// will have been played by then — which is the piece the old calendar-time curve
// fit had no representation of at all.

/** Weak prior for a player with no observed gaps: a round a month. */
export const PRIOR_ROUNDS_PER_YEAR = 12;
/** Below this many observed gaps, bootstrap resampling has nothing to resample. */
export const MIN_BOOTSTRAP_GAPS = 5;
/** Sampled gaps are clamped here — a decade-long gap is not a forecast. */
export const MIN_GAP_DAYS = 1;
export const MAX_GAP_DAYS = 400;

export type CadenceMethod = "bootstrap" | "gamma" | "prior";

export type CadenceModel = {
  roundsPerYear: number;
  /** Observed inter-round gaps in days, from the estimation window. */
  gaps: number[];
  method: CadenceMethod;
  lastPlayedDayIndex: number | null;
  /** Days since the last posted round. */
  dormancyDays: number;
  /** Median observed gap, or null when there are none. */
  medianGapDays: number | null;
  /** True when the player has been quiet for much longer than their own rhythm. */
  dormant: boolean;
};

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Estimate play cadence from the day indices of past rounds (ascending).
 *
 * The estimation window steps outward — a year, then eighteen months, then all
 * history — so an active player is described by their current rhythm and an
 * occasional player still gets an estimate rather than the prior.
 */
export function estimateCadence(
  playedDayIndicesAsc: readonly number[],
  todayDayIndex: number,
  opts?: { lookbackDays?: number; priorRoundsPerYear?: number }
): CadenceModel {
  const all = [...new Set(playedDayIndicesAsc)].sort((a, b) => a - b);
  const lastPlayedDayIndex = all.length ? all[all.length - 1] : null;
  const dormancyDays = lastPlayedDayIndex === null ? 0 : Math.max(0, todayDayIndex - lastPlayedDayIndex);

  // Step the window outward until it holds enough gaps to resample: an active
  // player is described by their current rhythm, an occasional one still gets an
  // estimate rather than falling back to the prior.
  let gaps: number[] = [];
  for (const w of [opts?.lookbackDays ?? 365, 540, Infinity]) {
    const cutoff = todayDayIndex - w;
    const inWindow = all.filter((d) => d >= cutoff);
    if (inWindow.length < 2) continue;

    gaps = [];
    for (let i = 1; i < inWindow.length; i++) gaps.push(clampGap(inWindow[i] - inWindow[i - 1]));
    if (gaps.length >= MIN_BOOTSTRAP_GAPS) break;
  }

  const prior = opts?.priorRoundsPerYear ?? PRIOR_ROUNDS_PER_YEAR;
  const med = median(gaps);

  let method: CadenceMethod;
  let roundsPerYear: number;

  if (gaps.length >= MIN_BOOTSTRAP_GAPS) {
    method = "bootstrap";
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    roundsPerYear = 365 / meanGap;
  } else if (gaps.length >= 1) {
    method = "gamma";
    const observedDays = gaps.reduce((a, b) => a + b, 0);
    // Gamma(α₀ + N, β₀ + T) with α₀ = 2, β₀ = 365/prior (prior mean = `prior`/yr).
    roundsPerYear = (365 * (2 + gaps.length)) / (365 / prior + observedDays);
  } else {
    method = "prior";
    roundsPerYear = prior;
  }

  return {
    roundsPerYear,
    gaps,
    method,
    lastPlayedDayIndex,
    dormancyDays,
    medianGapDays: med,
    dormant: med !== null && dormancyDays > 2 * med,
  };
}

function clampGap(days: number): number {
  return Math.min(MAX_GAP_DAYS, Math.max(MIN_GAP_DAYS, Math.round(days)));
}

/**
 * Per-path cadence state. The Gamma path draws its rate ONCE per simulated path
 * rather than once per round, so uncertainty about how often the player plays
 * propagates into the fan instead of averaging itself away.
 */
export type CadenceDraw = { nextGap: (rand: () => number) => number };

export function startCadenceDraw(m: CadenceModel, rand: () => number): CadenceDraw {
  if (m.method === "bootstrap") {
    // Resample the player's own gaps. Society golf comes in bursts — a Poisson
    // process would smooth away exactly the clustering that makes a player's
    // counting window turn over in spurts.
    const gaps = m.gaps;
    return {
      nextGap: (r) => gaps[Math.min(gaps.length - 1, Math.floor(r() * gaps.length))],
    };
  }

  if (m.method === "gamma") {
    const observedDays = m.gaps.reduce((a, b) => a + b, 0);
    const shape = 2 + m.gaps.length;
    const rate = 365 / PRIOR_ROUNDS_PER_YEAR + observedDays;
    const lambdaPerDay = sampleGamma(shape, rand) / rate;
    const meanGap = lambdaPerDay > 0 ? 1 / lambdaPerDay : 365 / PRIOR_ROUNDS_PER_YEAR;
    return { nextGap: (r) => clampGap(-Math.log(1 - r()) * meanGap) };
  }

  const meanGap = 365 / PRIOR_ROUNDS_PER_YEAR;
  return { nextGap: (r) => clampGap(-Math.log(1 - r()) * meanGap) };
}

/** Gamma(shape, 1) via Marsaglia–Tsang. `shape` >= 1 here by construction. */
function sampleGamma(shape: number, rand: () => number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let guard = 0; guard < 1000; guard++) {
    let x: number;
    let v: number;
    do {
      // Box–Muller, inline to keep this file free of simulation imports.
      const u1 = Math.max(1e-12, rand());
      const u2 = rand();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return d; // pathological RNG — fall back to the mean
}

/**
 * First gap for a dormant player. Someone who has not posted in months is
 * unlikely to play tomorrow, and pretending otherwise would date every
 * projection from a round they are not about to play.
 */
export function firstGapDays(m: CadenceModel, draw: CadenceDraw, rand: () => number): number {
  const g = draw.nextGap(rand);
  if (!m.dormant || m.medianGapDays === null) return g;
  // Memoryless-ish catch-up: they are at least as far from their next round as a
  // typical gap, having already waited longer than two of them.
  return clampGap(Math.max(g, m.medianGapDays));
}
