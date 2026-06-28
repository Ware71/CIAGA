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
  /** Course Handicap (computed from effective HI + tee — caller must apply any HI override before passing). */
  courseHandicap: number | null;
  mode: PlayingHandicapMode | null | undefined;
  /** Allowance % (for allowance_pct) or fixed value (for fixed). */
  value: number | null | undefined;
  /** Lowest Course Handicap across the non-guest field — required for `compare_against_lowest`. */
  lowestCourseHandicap?: number | null;
};

/**
 * Resolve the preview playing handicap. Mirrors `ciaga_resolve_playing_handicap`.
 * Apply the round's default mode to the (pre-computed) course handicap.
 *
 * When a player has an assigned_handicap_index override, the caller must derive
 * courseHandicap from that override HI (not from handicap_index_history) so that
 * the preview matches what ciaga_persist_playing_handicaps will lock in.
 *
 * Returns null only when there isn't enough data to compute (e.g. no course
 * handicap yet for an allowance/off-the-lowest mode).
 */
export function resolvePlayingHandicapPreview(
  input: PlayingHandicapPreviewInput,
): number | null {
  const { courseHandicap, mode, value, lowestCourseHandicap } = input;

  // Apply round default calculation by mode.
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
      // Allowance applied to each CH first, then subtract the lowest
      // allowance-adjusted CH. Stored 0 means 100% (backward compat) — mirrors
      // ciaga_resolve_playing_handicap.
      const pct = value && value !== 0 ? value : 100;
      return Math.max(
        0,
        Math.round((courseHandicap * pct) / 100) -
          Math.round((lowestCourseHandicap * pct) / 100),
      );
    }

    case "none":
      return 0;

    default:
      // Unknown / null mode → no strokes (matches resolver's ELSE 0).
      return 0;
  }
}
