// lib/rounds/playingHandicapPreview.ts
//
// Live PREVIEW of a player's playing handicap during round setup.
//
// At round start the authoritative value is locked by the SQL function
// `ciaga_resolve_playing_handicap` (migration 20260216120000). During setup
// (draft/scheduled) `playing_handicap_used` is still NULL, so we mirror that
// resolver here to show a faithful preview that matches what will be locked in.
//
// IMPORTANT — this is a SCORING preview only. It must never be used for AGS or
// official handicap-index calculations (use course_handicap_used for those).

import type { PlayingHandicapMode } from "@/components/rounds/PlayingHandicapSettings";

export type PlayingHandicapPreviewInput = {
  /** Course Handicap (already computed from base HI + tee). May be null if unknown. */
  courseHandicap: number | null;
  /** Manual HI override (`assigned_handicap_index`). When set, used as a DIRECT playing-handicap override. */
  assignedHandicapIndex: number | null;
  mode: PlayingHandicapMode | null | undefined;
  /** Allowance % (for allowance_pct) or fixed value (for fixed). */
  value: number | null | undefined;
  /** Lowest Course Handicap across the non-guest field — required for `compare_against_lowest`. */
  lowestCourseHandicap?: number | null;
};

/**
 * Resolve the preview playing handicap. Mirrors `ciaga_resolve_playing_handicap`:
 *   1. Manual override (assigned_handicap_index) wins → round(override).
 *   2. Otherwise apply the round's default mode to the course handicap.
 *
 * Returns null only when there isn't enough data to compute (e.g. no course
 * handicap yet for an allowance/off-the-lowest mode).
 */
export function resolvePlayingHandicapPreview(
  input: PlayingHandicapPreviewInput,
): number | null {
  const { courseHandicap, assignedHandicapIndex, mode, value, lowestCourseHandicap } = input;

  // 1. Manual override takes precedence — treated as a direct playing handicap.
  if (assignedHandicapIndex !== null && assignedHandicapIndex !== undefined) {
    return Math.round(assignedHandicapIndex);
  }

  // 2. Round default calculation by mode.
  switch (mode) {
    case "fixed":
      return value != null ? Math.round(value) : 0;

    case "allowance_pct": {
      if (courseHandicap == null) return null;
      const pct = value ?? 100;
      return Math.round((courseHandicap * pct) / 100);
    }

    case "compare_against_lowest": {
      if (courseHandicap == null || lowestCourseHandicap == null) return null;
      // Best player plays off scratch; everyone else gets the difference.
      return Math.round(courseHandicap - lowestCourseHandicap);
    }

    case "none":
      return 0;

    default:
      // Unknown / null mode → no strokes (matches resolver's ELSE 0).
      return 0;
  }
}
