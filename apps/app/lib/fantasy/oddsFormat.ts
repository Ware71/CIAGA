/**
 * Odds display formats — decimal (engine native), fractional, American.
 * Prices are quantized to the bookmaker fraction ladder at pricing time
 * (probabilityToDecimalOdds), so all three formats here resolve to the SAME
 * ladder rung and can never disagree. Pure functions; the display preference
 * lives per-device in localStorage via useOddsFormat.
 */

import { quantizeToLadder } from "@/lib/fantasy/oddsLadder";

export type OddsFormat = "decimal" | "fractional" | "american";

export const ODDS_FORMATS: { id: OddsFormat; label: string }[] = [
  { id: "decimal", label: "Decimal" },
  { id: "fractional", label: "Fractional" },
  { id: "american", label: "American" },
];

/** Decimal odds → the matched ladder rung as a fractional string, e.g. 2.5 → "6/4". */
export function toFractional(decimalOdds: number): string {
  const rung = quantizeToLadder(decimalOdds);
  return `${rung.num}/${rung.den}`;
}

/**
 * Decimal odds → American moneyline, derived from the ladder rung (not the
 * 2dp decimal) so it matches the fractional exactly: 8/15 → -188, 5/1 → +500,
 * evens → +100, 1/100 → -10000.
 */
export function toAmerican(decimalOdds: number): string {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return "-10000";
  const { num, den } = quantizeToLadder(decimalOdds);
  return num >= den ? `+${Math.round((100 * num) / den)}` : `${-Math.round((100 * den) / num)}`;
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
