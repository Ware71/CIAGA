import type {
  EventTypeV2,
  EventScoringModel,
  EventPointsModel,
  EventCategory,
  PointsConfig,
} from "@/lib/majors/types";

export const FORMAT_DEFAULT_SCORING: Record<EventTypeV2, EventScoringModel> = {
  stroke: "net",
  stableford: "stableford_points",
  matchplay: "match_result",
  skins: "net",
  scramble: "net",
  bestball: "net",
  custom: "net",
  stroke_play: "net",
  matchplay_fixture: "match_result",
  matchplay_knockout_match: "match_result",
  aggregate_stroke_play: "net",
  team_best_ball: "net",
  team_scramble: "net",
};

export const FORMAT_ALLOWS_SCORING_CHOICE = (type: EventTypeV2): boolean =>
  !["stableford", "matchplay", "matchplay_fixture", "matchplay_knockout_match"].includes(type);

export const EVENT_CATEGORIES: { value: EventCategory; label: string; desc: string }[] = [
  { value: "round_based", label: "Round-based", desc: "Requires round submissions to score" },
  { value: "aggregate", label: "Aggregate", desc: "Points race / Order of Merit — no round needed" },
  { value: "standalone", label: "Standalone", desc: "Own leaderboard, round is optional" },
];

// Curated, user-selectable formats. This list is what selectors render. The
// spec-aligned aliases below (stroke_play, *_fixture, team_*) are NOT offered
// here on purpose — they are internal/duplicate variants of these base formats.
export const EVENT_TYPES: { value: EventTypeV2; label: string }[] = [
  { value: "stroke", label: "Strokeplay" },
  { value: "stableford", label: "Stableford" },
  { value: "matchplay", label: "Match Play" },
  { value: "skins", label: "Skins" },
  { value: "scramble", label: "Scramble" },
  { value: "bestball", label: "Best Ball" },
  { value: "custom", label: "Custom" },
];

// Complete display-name map for EVERY EventTypeV2, including the internal/spec
// aliases that aren't user-selectable. Use this for labelling a stored event's
// type (so e.g. a "team_best_ball" record renders as "Team Best Ball" rather
// than the raw enum string). Selectors should still iterate EVENT_TYPES.
export const EVENT_TYPE_LABELS: Record<EventTypeV2, string> = {
  stroke: "Strokeplay",
  stableford: "Stableford",
  matchplay: "Match Play",
  skins: "Skins",
  scramble: "Scramble",
  bestball: "Best Ball",
  custom: "Custom",
  stroke_play: "Strokeplay",
  matchplay_fixture: "Match Play Fixture",
  matchplay_knockout_match: "Knockout Match",
  aggregate_stroke_play: "Aggregate Strokeplay",
  team_best_ball: "Team Best Ball",
  team_scramble: "Team Scramble",
};

export const SCORING_MODELS: { value: EventScoringModel; label: string; shortLabel: string }[] = [
  { value: "net", label: "Net (handicap adjusted)", shortLabel: "Net" },
  { value: "gross", label: "Gross (no handicap)", shortLabel: "Gross" },
  { value: "stableford_points", label: "Stableford Points", shortLabel: "Stableford" },
  { value: "match_result", label: "Match Result", shortLabel: "Match Result" },
];

export const POINTS_MODELS: { value: EventPointsModel; label: string; shortLabel: string; desc?: string }[] = [
  { value: "none", label: "No points (event result only)", shortLabel: "None", desc: "Results stand alone — no points awarded to the season table." },
  { value: "fedex_style", label: "FedEx-style season points", shortLabel: "FedEx-style", desc: "Points taper through the field, with a sharp premium for finishing at the top." },
  { value: "position_based", label: "Position-based points", shortLabel: "Position-based", desc: "Fixed points per finishing position." },
  { value: "custom_table", label: "Custom points table", shortLabel: "Custom table", desc: "Set your own points for each position." },
  { value: "ciaga_formula", label: "CIAGA Formula", shortLabel: "CIAGA Formula", desc: "Sqrt-style curve scaled to field size and rounds. Floor of 18 pts — ratio ~3.6:1. Rewards consistent top finishes." },
  { value: "custom_formula", label: "Custom Formula", shortLabel: "Custom Formula", desc: "Same structure as CIAGA Formula with configurable base, scale, compression, and win bonus." },
];

/** CIAGA formula defaults — shared between SQL and TypeScript. */
export const FORMULA_DEFAULTS = {
  base: 18,
  scale: 32,
  compression: 0.7,
  field_sensitivity: 0.2,
  win_bonus_scale: 5,
  round_coefficient: 0.2,
} as const;

/**
 * Compute points for one position using the CIAGA/custom formula.
 * numRounds comes from event.num_rounds (not stored in PointsConfig).
 * fieldSize should be the actual or override participant count (F).
 */
export function computeFormulaPoints(
  position: number,
  fieldSize: number,
  numRounds: number,
  config: PointsConfig
): number {
  const {
    base = FORMULA_DEFAULTS.base,
    scale = FORMULA_DEFAULTS.scale,
    compression = FORMULA_DEFAULTS.compression,
    field_sensitivity = FORMULA_DEFAULTS.field_sensitivity,
    win_bonus_scale = FORMULA_DEFAULTS.win_bonus_scale,
    round_coefficient = FORMULA_DEFAULTS.round_coefficient,
  } = config;
  const F = Math.max(fieldSize, 1);
  const roundFactor = 1 + round_coefficient * (Math.min(numRounds, 3) - 1);
  const fieldScale = Math.pow(F / 6, field_sensitivity);
  const posFrac = F > 1 ? Math.max(F - position, 0) / (F - 1) : 0;
  const positionTerm = roundFactor * scale * Math.pow(posFrac, compression) * fieldScale;
  const winTerm = position === 1 ? win_bonus_scale * fieldScale : 0;
  return Math.round(base + positionTerm + winTerm);
}

export const FEDEX_POINTS: number[] = [500, 300, 190, 140, 110, 90, 75, 60, 48, 38, 30, 24, 18, 14, 10, 8, 6, 4, 2, 1];

export const STANDINGS_CONTRIBUTIONS = [
  { value: "event_only" as const, label: "Event only" },
  { value: "season" as const, label: "Season" },
  { value: "both" as const, label: "Both" },
];
