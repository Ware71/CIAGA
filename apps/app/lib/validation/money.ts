/**
 * Validate a user-supplied money amount: finite, positive, sane upper bound.
 * Returns the amount rounded to 2 decimal places, or null if invalid.
 */
export const MAX_MONEY_AMOUNT = 100000;

export function parseMoneyAmount(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n <= 0 || n > MAX_MONEY_AMOUNT) return null;
  return Math.round(n * 100) / 100;
}
