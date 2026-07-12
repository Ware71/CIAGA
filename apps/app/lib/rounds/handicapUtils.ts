/**
 * Shared handicap calculation utilities.
 * Used by scorecard components and format scoring module.
 */

export function strokesReceivedOnHole(
  courseHcp: number | null | undefined,
  holeStrokeIndex: number | null,
  holeCount: number = 18
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

  const abs = Math.abs(raw);
  const base = Math.floor(abs / holeCount);
  const rem = abs % holeCount;

  if (raw < 0) {
    // Plus handicap: strokes assigned to easiest holes (highest SI)
    return -(base + (si > holeCount - rem ? 1 : 0));
  }
  return base + (si <= rem ? 1 : 0);
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
  return gross - recv;
}

/**
 * WHS net double bogey: the gross score assigned to an unplayed/picked-up
 * hole for scoring purposes (par + 2 + strokes received on that hole).
 */
export function netDoubleBogeyGross(
  par: number,
  courseHcp: number | null | undefined,
  strokeIndex: number | null,
  holeCount: number = 18
): number {
  return par + 2 + strokesReceivedOnHole(courseHcp, strokeIndex, holeCount);
}
