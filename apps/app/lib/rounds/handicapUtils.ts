/**
 * Shared handicap calculation utilities.
 * Used by scorecard components and format scoring module.
 */

export function strokesReceivedOnHole(
  courseHcp: number | null | undefined,
  holeStrokeIndex: number | null
): number {
  const hcp =
    typeof courseHcp === "number" && Number.isFinite(courseHcp)
      ? Math.max(0, Math.floor(courseHcp))
      : 0;
  const si =
    typeof holeStrokeIndex === "number" && Number.isFinite(holeStrokeIndex)
      ? holeStrokeIndex
      : null;
  if (!hcp || !si) return 0;

  const base = Math.floor(hcp / 18);
  const rem = hcp % 18;

  return base + (si <= rem ? 1 : 0);
}

export function netFromGross(gross: number, recv: number): number {
  return Math.max(1, gross - recv);
}
