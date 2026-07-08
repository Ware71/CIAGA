// Fantasy Picks — simulation types.
// Pure data shapes: no runtime imports so the engine stays unit-testable.

export type SimHole = {
  holeNumber: number;
  par: number;
  yardage: number | null;
  /** Stroke index 1–18 (course "handicap" column). */
  strokeIndex: number;
};

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
  /** Event playing handicap (allowance % applied) — drives net scores. */
  playingHandicap: number;
  /** Gross strokes for holes already played in-event: holeNumber → strokes. */
  completedHoles: Record<number, number>;
  roundComplete: boolean;
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
  /** birdieHistogram[c] = iterations with exactly c simulated birdies. */
  birdieHistogram: number[];
  /** P(win) on the ranking basis; ties split evenly. */
  winProb: number;
  /** P(position ≤ N), ties count as in. Keys 3, 5, 10. */
  topNProb: Record<number, number>;
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
