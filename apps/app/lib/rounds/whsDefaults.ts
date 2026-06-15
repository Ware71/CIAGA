// lib/rounds/whsDefaults.ts
//
// Single source of truth for WHS-recommended handicap defaults per format.
// Reused by the Casual (Rounds) and Competitive (Events) surfaces so the two
// stop diverging. Everything returned here is a SEED, applied when a format is
// chosen — it stays fully user-overridable in PlayingHandicapSettings (rounds)
// and HandicapRulesEditor (events). We never hard-lock a value.
//
// Reference: WHS Rules of Handicapping, Appendix C — Handicap Allowances.

import type { PlayingHandicapMode } from "@/components/rounds/PlayingHandicapSettings";
import type { RoundFormatType } from "@/components/rounds/FormatSelector";
import type { EventTypeV2 } from "@/lib/majors/types";

export type WhsPolicy = { mode: PlayingHandicapMode; allowance_pct: number };

/**
 * Count-based aggregate allowance (best N scores of the team count per hole).
 * WHS Appendix C "Best Ball / Aggregate" guidance. Falls back to 85% when the
 * count is unknown (or all scores count), which is the conservative middle.
 */
function aggregateAllowance(countPerHole?: number): number {
  switch (countPerHole) {
    case 1:
      return 75; // best 1 of N
    case 2:
      return 85; // best 2 of N
    case 3:
      return 90; // best 3 of N
    default:
      return 85;
  }
}

/**
 * WHS default handicap policy (mode + allowance %) to seed when a round format
 * is selected. Pass team config (count_per_hole) for count-based formats.
 */
export function getWhsDefaultPolicy(
  format: RoundFormatType,
  opts?: { countPerHole?: number },
): WhsPolicy {
  switch (format) {
    case "strokeplay":
    case "stableford":
      return { mode: "allowance_pct", allowance_pct: 95 };

    // Singles match play: the lowest player plays off scratch and everyone else
    // receives 100% of the *difference* — that is the "off the lowest" mode,
    // not a flat 100% of each player's own handicap.
    case "matchplay":
      return { mode: "compare_against_lowest", allowance_pct: 100 };

    case "pairs_stableford":
      return { mode: "allowance_pct", allowance_pct: 85 };

    case "team_strokeplay":
    case "team_stableford":
    case "team_bestball":
      return { mode: "allowance_pct", allowance_pct: aggregateAllowance(opts?.countPerHole) };

    // Single-ball team formats: the per-player weighting in the team-handicap
    // formula (TeamBuilderSheet) already encodes the WHS allowance, so 100% of
    // the resulting team handicap applies.
    case "scramble":
    case "greensomes":
    case "foursomes":
      return { mode: "allowance_pct", allowance_pct: 100 };

    // Skins is not a WHS event; convention is net off full (100%) handicap so
    // the lowest net wins fairly.
    case "skins":
      return { mode: "allowance_pct", allowance_pct: 100 };

    // Wolf has no scoring engine yet (tracked as a separate follow-up). Neutral
    // default; do not rely on this until the engine lands.
    case "wolf":
    default:
      return { mode: "allowance_pct", allowance_pct: 100 };
  }
}

/**
 * Maps competitive event types to the round format whose WHS policy applies.
 * The spec-aligned aliases (stroke_play, *_fixture, team_*) collapse onto their
 * base format.
 */
const EVENT_TO_FORMAT: Record<EventTypeV2, RoundFormatType> = {
  stroke: "strokeplay",
  stroke_play: "strokeplay",
  stableford: "stableford",
  matchplay: "matchplay",
  matchplay_fixture: "matchplay",
  matchplay_knockout_match: "matchplay",
  skins: "skins",
  scramble: "scramble",
  team_scramble: "scramble",
  bestball: "team_bestball",
  team_best_ball: "team_bestball",
  aggregate_stroke_play: "team_strokeplay",
  custom: "strokeplay",
};

/** WHS default handicap policy to seed when a competitive event format is chosen. */
export function getWhsDefaultPolicyForEvent(type: EventTypeV2): WhsPolicy {
  // Custom is intentionally neutral — the organiser defines the scoring, so we
  // don't presume a WHS allowance beyond full handicap.
  if (type === "custom") return { mode: "allowance_pct", allowance_pct: 100 };
  return getWhsDefaultPolicy(EVENT_TO_FORMAT[type] ?? "strokeplay");
}
