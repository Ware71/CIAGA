// Fantasy Picks — simulation types.
// Pure data shapes: no runtime imports so the engine stays unit-testable.

export type SimHole = {
  holeNumber: number;
  par: number;
  yardage: number | null;
  /** Stroke index 1–18 (course "handicap" column). */
  strokeIndex: number;
  /** Event round this hole belongs to (1-based). Absent = round 1. */
  round?: number;
};

/**
 * Canonical key for a (round, hole) pair — hole numbers repeat across the
 * rounds of a multi-round event, so completed-hole maps use this key.
 */
export function holeKey(round: number, holeNumber: number): number {
  return round * 100 + holeNumber;
}

export type HoleSplitBucket = {
  /** Average strokes over par in this bucket. */
  avgVsPar: number;
  birdieRate: number;
  bogeyPlusRate: number;
  sample: number;
};

/**
 * Performance splits keyed by bucket:
 *   par-type × length band — p3_short, p3_mid, p3_long, p4_short, … p5_long
 *   stroke-index band      — si_1_6, si_7_12, si_13_18
 */
export type HoleSplits = Record<string, HoleSplitBucket>;

export type SimPlayerProfile = {
  profileId: string;
  handicapIndex: number | null;
  avgGross: number | null;
  scoreStddev: number | null;
  /** Recent-form drift in strokes/round (negative = trending better). */
  recentForm: number | null;
  birdiesPerRound: number | null;
  /** Eagle-or-better holes per round (calibrates rare-outcome markets). */
  eaglesPerRound: number | null;
  parsPerRound: number | null;
  bogeysPerRound: number | null;
  doublesPlusPerRound: number | null;
  par3AvgVsPar: number | null;
  par4AvgVsPar: number | null;
  par5AvgVsPar: number | null;
  holeSplits: HoleSplits | null;
  sampleSize: number;
  confidence: "low" | "medium" | "high";
};

export type SimPlayer = {
  profileId: string;
  displayName: string;
  profile: SimPlayerProfile;
  /**
   * Event playing handicap (allowance % applied) — drives net scores.
   * Applied per round: event net = gross − PH × rounds, same as the
   * leaderboard's per-submission handicap sum.
   */
  playingHandicap: number;
  /** Gross strokes for holes already played: holeKey(round, hole) → strokes. */
  completedHoles: Record<number, number>;
  /** True when the player has finished EVERY round of the event. */
  roundComplete: boolean;
  /**
   * Rounds the player has finished — their unscored holes in these rounds are
   * skipped (played but not recorded), not simulated. Absent = derive from
   * roundComplete alone (single-round behaviour).
   */
  completedRounds?: number[];
};

export type RankingBasis = "gross" | "net";

export type SimulationInputs = {
  players: SimPlayer[];
  holes: SimHole[];
  /** How event positions are decided (stableford ranks by net equivalent). */
  rankingBasis: RankingBasis;
  simulationCount: number;
  seed: number;
};

export type SimPlayerResult = {
  profileId: string;
  /** Joint samples: index i across players = same simulated event. */
  grossTotals: Int16Array;
  netTotals: Int16Array;
  /** Per-round joint samples, keyed by round number (prices round markets). */
  roundGrossTotals: Record<number, Int16Array>;
  roundNetTotals: Record<number, Int16Array>;
  /** birdieHistogram[c] = iterations with exactly c simulated birdies. */
  birdieHistogram: number[];
  /** P(win) on the ranking basis; ties split evenly. */
  winProb: number;
  /** P(position ≤ N), ties count as in. Keys 3, 5, 10. */
  topNProb: Record<number, number>;
  /** P(finishing exactly position i+1) under "1224" ranking; ties share the tied position. */
  positionHistogram: number[];
  /** P(finishing last); ties at the bottom split evenly (mirrors winProb). */
  lastProb: number;
  meanGross: number;
  meanNet: number;
  /**
   * holeOutcomes[holeIdx][k] = iterations scoring par+(k-2) on that hole
   * (k 0..6 → eagle-or-better .. quad-or-worse). Foundation for future
   * hole-specific markets; already-played holes have their real outcome.
   */
  holeOutcomes: number[][];
};

export type SimulationResult = {
  simulationCount: number;
  rankingBasis: RankingBasis;
  players: SimPlayerResult[];
  /** profileId → index into players (and into every totals array). */
  playerIndex: Record<string, number>;
  /** The simulated hole set — holeOutcomes[i] corresponds to holes[i]. */
  holes: SimHole[];
};

/** Engine-wide probability clamp: no impossible or infinite odds. */
export const PROBABILITY_FLOOR = 0.005;
export const PROBABILITY_CEILING = 0.995;

export function clampProbability(p: number): number {
  if (!Number.isFinite(p)) return PROBABILITY_FLOOR;
  return Math.min(PROBABILITY_CEILING, Math.max(PROBABILITY_FLOOR, p));
}

export function probabilityToDecimalOdds(p: number): number {
  const clamped = clampProbability(p);
  return Math.round((1 / clamped) * 100) / 100;
}
