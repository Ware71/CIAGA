/**
 * Odds display formats — decimal (engine native), fractional (nearest
 * standard book fraction), American moneyline. Pure functions; the display
 * preference lives per-device in localStorage via useOddsFormat.
 */

export type OddsFormat = "decimal" | "fractional" | "american";

export const ODDS_FORMATS: { id: OddsFormat; label: string }[] = [
  { id: "decimal", label: "Decimal" },
  { id: "fractional", label: "Fractional" },
  { id: "american", label: "American" },
];

/**
 * The fraction ladder real books quote from. Profit-per-unit values; we snap
 * to the nearest rung rather than doing exact rational arithmetic so 1.53
 * shows as 8/15, not 53/100.
 */
const FRACTION_LADDER: [number, number][] = [
  [1, 100], [1, 50], [1, 33], [1, 25], [1, 20], [1, 16], [1, 14], [1, 12],
  [1, 10], [1, 9], [1, 8], [1, 7], [2, 13], [1, 6], [2, 11], [1, 5], [2, 9],
  [1, 4], [2, 7], [3, 10], [1, 3], [4, 11], [2, 5], [4, 9], [1, 2], [8, 15],
  [4, 7], [8, 13], [4, 6], [8, 11], [4, 5], [5, 6], [10, 11], [1, 1],
  [11, 10], [6, 5], [5, 4], [11, 8], [6, 4], [13, 8], [7, 4], [15, 8], [2, 1],
  [9, 4], [5, 2], [11, 4], [3, 1], [10, 3], [7, 2], [4, 1], [9, 2], [5, 1],
  [11, 2], [6, 1], [13, 2], [7, 1], [15, 2], [8, 1], [17, 2], [9, 1], [10, 1],
  [11, 1], [12, 1], [14, 1], [16, 1], [18, 1], [20, 1], [25, 1], [33, 1],
  [40, 1], [50, 1], [66, 1], [80, 1], [100, 1], [125, 1], [150, 1], [200, 1],
];

/** Decimal odds → nearest standard fractional string, e.g. 2.5 → "6/4". */
export function toFractional(decimalOdds: number): string {
  const profit = decimalOdds - 1;
  if (!Number.isFinite(profit) || profit <= 0) return "1/100";
  let best = FRACTION_LADDER[0];
  let bestErr = Infinity;
  for (const [num, den] of FRACTION_LADDER) {
    // Relative error so short and long prices snap equally well.
    const err = Math.abs(num / den - profit) / Math.max(profit, 0.01);
    if (err < bestErr) {
      bestErr = err;
      best = [num, den];
    }
  }
  return `${best[0]}/${best[1]}`;
}

/** Decimal odds → American moneyline string, e.g. 2.5 → "+150", 1.5 → "-200". */
export function toAmerican(decimalOdds: number): string {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return "-10000";
  if (decimalOdds >= 2) return `+${Math.round((decimalOdds - 1) * 100)}`;
  return `${Math.round(-100 / (decimalOdds - 1))}`;
}

export function formatOdds(decimalOdds: number, format: OddsFormat): string {
  switch (format) {
    case "fractional":
      return toFractional(decimalOdds);
    case "american":
      return toAmerican(decimalOdds);
    default:
      return decimalOdds.toFixed(2);
  }
}
