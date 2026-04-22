import type { CompetitionWithGroup, CompetitionStructure, MajorGroupType } from "./types";

const STRUCTURE_LABELS: Partial<Record<CompetitionStructure, string>> = {
  league_fixture: "League Round",
  knockout_match: "Knockout Match",
  season_event:   "Season Round",
  multi_round:    "Tournament Round",
  standalone:     "Tournament Round",
};

const GROUP_TYPE_LABELS: Partial<Record<MajorGroupType, string>> = {
  league:           "League Round",
  matchplay_series: "Matchplay Round",
  society:          "Society Round",
  tour:             "Tour Event",
  season:           "Season Round",
  major_series:     "Major Round",
  friend_group:     "Group Round",
};

/**
 * Returns a human-readable label for a competition status badge.
 * For live/completed/cancelled states this is a short status word.
 * For upcoming/scheduled/entry states it returns the round type
 * derived from competition_structure and group type.
 */
export function competitionStatusLabel(
  comp: Pick<CompetitionWithGroup, "majors_status" | "competition_structure" | "group">
): string {
  switch (comp.majors_status) {
    case "live":       return "Live";
    case "completed":
    case "official":
    case "unofficial": return "Completed";
    case "cancelled":  return "Cancelled";
    case "draft":      return "Draft";
    case "archived":   return "Archived";
  }

  // For upcoming / entry_open / entry_closed / published — show round type
  const structureLabel = STRUCTURE_LABELS[comp.competition_structure];
  if (structureLabel) return structureLabel;

  const groupType = comp.group?.type;
  if (groupType && GROUP_TYPE_LABELS[groupType]) {
    return GROUP_TYPE_LABELS[groupType]!;
  }

  return "Tournament Round";
}
