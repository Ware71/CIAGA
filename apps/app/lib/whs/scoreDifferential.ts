// lib/whs/scoreDifferential.ts
import { divRoundHalfAwayFromZero, fromTenths } from "./handicapIndex";

/**
 * Score Differential = (AGS − Course Rating) × 113 ÷ Slope, to one decimal.
 *
 * The rounding is the whole point of this file. Postgres `round(numeric, 1)`
 * rounds halves AWAY FROM ZERO, while JavaScript's `Math.round(x * 10) / 10`
 * rounds halves toward +∞ — so the two disagree on every negative tie, which is
 * exactly where a good round lands. `compute_handicap_round_result` is the
 * authority for what gets stored; this mirrors it so a figure shown in the
 * calculator can't contradict the one in a player's record.
 *
 * Worked in integer hundredths for the same reason: (99 − 71.2) in floating
 * point is 27.799999999999997, and a value sitting a hair under a .05 boundary
 * is one of the few ways to round differently from the database while looking
 * correct. Hundredths rather than tenths because quantising the inputs to 1dp
 * first would itself move a rating like 71.55 onto the wrong side of the tie —
 * Postgres does this in exact numeric arithmetic and never rounds twice.
 */
export function scoreDifferential(args: {
  /** Adjusted Gross Score. */
  ags: number;
  /** Course Rating for the tee played. */
  courseRating: number;
  /** Slope Rating for the tee played. */
  slope: number;
}): number | null {
  const { ags, courseRating, slope } = args;

  if (![ags, courseRating, slope].every((n) => typeof n === "number" && Number.isFinite(n))) {
    return null;
  }
  if (slope <= 0) return null;

  // (ags − cr) in hundredths — one multiply-and-round, which snaps off float
  // noise well below any real rating's precision without shifting a genuine tie.
  const netHundredths = Math.round((ags - courseRating) * 100);
  // Scaling the divisor by 10 alongside turns the result into tenths directly.
  return fromTenths(divRoundHalfAwayFromZero(netHundredths * 113, slope * 10));
}

/**
 * The 9-hole variant, for completeness: WHS scales a 9-hole differential onto
 * the 18-hole scale by doubling it, which is done by the caller when combining.
 * A standalone 9-hole differential uses the 9-hole rating and slope unchanged.
 */
export function nineHoleScoreDifferential(args: {
  ags: number;
  courseRating: number;
  slope: number;
}): number | null {
  return scoreDifferential(args);
}
