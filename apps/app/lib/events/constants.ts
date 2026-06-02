import type {
  EventTypeV2,
  EventScoringModel,
  EventPointsModel,
  EventCategory,
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

export const EVENT_TYPES: { value: EventTypeV2; label: string }[] = [
  { value: "stroke", label: "Strokeplay" },
  { value: "stableford", label: "Stableford" },
  { value: "matchplay", label: "Match Play" },
  { value: "skins", label: "Skins" },
  { value: "scramble", label: "Scramble" },
  { value: "bestball", label: "Best Ball" },
  { value: "custom", label: "Custom" },
];

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
];

export const STANDINGS_CONTRIBUTIONS = [
  { value: "event_only" as const, label: "Event only" },
  { value: "season" as const, label: "Season" },
  { value: "both" as const, label: "Both" },
];
