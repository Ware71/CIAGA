/**
 * The bookmaker fraction ladder — the single price grid every quoted price
 * snaps to. Rungs are profit-per-unit fractions; a rung's decimal is
 * 1 + num/den (2dp). Decimal, fractional and American displays all derive
 * from the SAME rung, so the three formats can never disagree.
 * Pure module: imported by both the display layer (oddsFormat) and the
 * pricing engine (simulation/types), so it must import nothing.
 */

export type LadderRung = { num: number; den: number; decimal: number };

const RAW_LADDER: [number, number][] = [
  [1, 100], [1, 50], [1, 33], [1, 25], [1, 20], [1, 16], [1, 14], [1, 12],
  [1, 10], [1, 9], [1, 8], [1, 7], [2, 13], [1, 6], [2, 11], [1, 5], [2, 9],
  [1, 4], [2, 7], [3, 10], [1, 3], [4, 11], [2, 5], [4, 9], [1, 2], [8, 15],
  [4, 7], [8, 13], [4, 6], [8, 11], [4, 5], [5, 6], [10, 11], [1, 1],
  [11, 10], [6, 5], [5, 4], [11, 8], [6, 4], [13, 8], [7, 4], [15, 8], [2, 1],
  [9, 4], [5, 2], [11, 4], [3, 1], [10, 3], [7, 2], [4, 1], [9, 2], [5, 1],
  [11, 2], [6, 1], [13, 2], [7, 1], [15, 2], [8, 1], [17, 2], [9, 1], [10, 1],
  [11, 1], [12, 1], [14, 1], [16, 1], [18, 1], [20, 1], [25, 1], [33, 1],
  [40, 1], [50, 1], [66, 1], [80, 1], [100, 1], [125, 1], [150, 1], [200, 1],
  [250, 1], [300, 1], [400, 1], [500, 1], [750, 1], [1000, 1],
];

export const FRACTION_LADDER: LadderRung[] = RAW_LADDER.map(([num, den]) => ({
  num,
  den,
  decimal: Math.round((1 + num / den) * 100) / 100,
}));

/** Shortest and longest quotable prices (1.01 … 1000.00). */
export const MIN_LADDER_DECIMAL = FRACTION_LADDER[0].decimal;
export const MAX_LADDER_DECIMAL = FRACTION_LADDER[FRACTION_LADDER.length - 1].decimal;

/**
 * Snap decimal odds to the nearest ladder rung. Relative error on profit so
 * short and long prices snap equally well; degenerate inputs (≤ 1, NaN) pin
 * to the shortest rung.
 */
export function quantizeToLadder(decimalOdds: number): LadderRung {
  const profit = decimalOdds - 1;
  if (!Number.isFinite(profit) || profit <= 0) return FRACTION_LADDER[0];
  let best = FRACTION_LADDER[0];
  let bestErr = Infinity;
  for (const rung of FRACTION_LADDER) {
    const err = Math.abs(rung.num / rung.den - profit) / Math.max(profit, 0.01);
    if (err < bestErr) {
      bestErr = err;
      best = rung;
    }
  }
  return best;
}
