/**
 * Shared handicap calculation utilities.
 * Used by scorecard components and format scoring module.
 */

export function strokesReceivedOnHole(
  courseHcp: number | null | undefined,
  holeStrokeIndex: number | null
): number {
  const raw =
    typeof courseHcp === "number" && Number.isFinite(courseHcp)
      ? Math.floor(courseHcp)
      : 0;
  const si =
    typeof holeStrokeIndex === "number" && Number.isFinite(holeStrokeIndex)
      ? holeStrokeIndex
      : null;
  if (raw === 0 || !si) return 0;

  const sign = raw < 0 ? -1 : 1;
  const abs = Math.abs(raw);
  const base = Math.floor(abs / 18);
  const rem = abs % 18;

  return sign * (base + (si <= rem ? 1 : 0));
}

/**
 * Format a handicap index for display.
 * Negative values (plus handicaps) are shown as "+X.X" per golf convention.
 */
export function formatHI(hi: number): string {
  if (hi < 0) return `+${Math.abs(hi).toFixed(1)}`;
  return hi.toFixed(1);
}

export function netFromGross(gross: number, recv: number): number {
  return Math.max(1, gross - recv);
}
