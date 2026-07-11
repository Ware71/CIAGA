// Fantasy Picks — event → season points mapping.
//
// Ports ciaga_compute_event_leaderboard's points models to TS so the season
// simulation can project how many season points a player earns for a simulated
// finishing position in a remaining event. Pure (no imports) → unit-testable.

/** FedEx-style fixed points by finishing position (1-indexed, capped at 20). */
const FEDEX = [500, 300, 190, 140, 110, 90, 75, 60, 48, 38, 30, 24, 18, 14, 10, 8, 6, 4, 2, 1];

export type EventPointsConfig = {
  pointsModel: string;
  pointsTable?: Record<string, number | string> | null;
  pointsConfig?: Record<string, number | string> | null;
  numRounds?: number | null;
  /** Field size — points_config.num_participants override, else projected field. */
  fieldSize: number;
};

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Points earned finishing at `position` (1 = best). Mirrors the SQL exactly for
 * a single position (the settlement averages ties; the projection uses the raw
 * position, which is unbiased across a Monte-Carlo run).
 */
export function eventPointsForPosition(cfg: EventPointsConfig, position: number): number {
  if (position <= 0) return 0;
  const F = Math.max(1, cfg.fieldSize);
  const P = position;
  switch (cfg.pointsModel) {
    case "fedex_style":
      return FEDEX[Math.min(P, 20) - 1] ?? 0;
    case "position_based":
    case "custom_table":
      return num(cfg.pointsTable?.[String(P)], 0);
    case "ciaga_formula":
    case "custom_formula": {
      const c = cfg.pointsConfig ?? {};
      const base = num(c.base, 18);
      const scale = num(c.scale, 32);
      const compression = num(c.compression, 0.7);
      const fieldSensitivity = num(c.field_sensitivity, 0.2);
      const winBonusScale = num(c.win_bonus_scale, 5);
      const roundCoeff = num(c.round_coefficient, 0.2);
      const numRounds = cfg.numRounds ?? 1;
      const roundFactor = 1 + roundCoeff * (Math.min(numRounds, 3) - 1);
      const fieldScale = Math.pow(Math.max(F, 1) / 6, fieldSensitivity);
      const posTerm = F > 1 ? Math.pow(Math.max(F - P, 0) / (F - 1), compression) : 0;
      const winBonus = P === 1 ? winBonusScale * fieldScale : 0;
      return Math.round(base + roundFactor * scale * posTerm * fieldScale + winBonus);
    }
    default:
      return 0; // 'none' or unknown
  }
}
