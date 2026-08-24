/**
 * WHS acceptability — the canonical TypeScript mirror of the database gate.
 *
 * SOURCE OF TRUTH: `public.compute_handicap_round_result(uuid)` and
 * `public.ciaga_is_authorised_format(round_format_type)` in
 * supabase/migrations/20260824000000_whs_acceptability_gbi_alignment.sql.
 * If those change, this file changes with them.
 *
 * The standard is the R&A Rules of Handicapping as applied within GB&I
 * (England Golf / CONGU guidance v2.8). Citations and the full comparison
 * against what CIAGA used to do live in docs/whs-acceptable-scores.md.
 *
 * Why a TS copy exists: the scorecard has to tell a player *before* they
 * finish that their round will not count, and why. That is the same rule the
 * database will apply minutes later, so it must be the same rule — the
 * previous version of this logic lived inline in RoundDetailClient with its
 * own hard-coded `14`, and drifted.
 *
 * This module decides ACCEPTABILITY only. The index calculation that consumes
 * accepted scores is handicapIndex.ts.
 */

/**
 * Round formats, mirroring the `round_format_type` Postgres enum. Declared
 * here rather than imported from `lib/rounds/hooks/useRoundDetail` so that
 * server code can use this module without pulling in a client hook.
 */
export type WhsRoundFormat =
  | "strokeplay"
  | "stableford"
  | "matchplay"
  | "pairs_stableford"
  | "team_strokeplay"
  | "team_stableford"
  | "team_bestball"
  | "scramble"
  | "greensomes"
  | "foursomes"
  | "skins"
  | "wolf";

/** GB&I G2.2(1)B: at least 10 holes for an 18-hole score (2024 revision; was 14). */
export const MIN_HOLES_18 = 10;

/** GB&I G2.2(1)B: ALL 9 holes of a measured 9-hole course must be played. */
export const MIN_HOLES_9 = 9;

/**
 * Formats that never post an individual differential: the player does not play
 * their own ball throughout, so the returned score is not theirs.
 *
 * Note what is NOT here: `matchplay`. GB&I does not authorise match play
 * (G3.3/1 notes it counts only "in some Jurisdictions"), but CIAGA is a
 * society where match play is common and has chosen to keep counting it. That
 * is a deliberate divergence, recorded in docs/whs-acceptable-scores.md.
 *
 * Four-ball formats are authorised per G5.10.
 */
export const UNAUTHORISED_FORMATS: readonly WhsRoundFormat[] = [
  "scramble",
  "greensomes",
  "foursomes",
];

/** Mirrors `public.ciaga_is_authorised_format`. Unknown formats are treated as authorised. */
export function isAuthorisedFormat(format: string | null | undefined): boolean {
  if (!format) return true;
  return !(UNAUTHORISED_FORMATS as readonly string[]).includes(format);
}

/**
 * The `rejected_reason` values written by `compute_handicap_round_result`.
 * Kept as a string union rather than an enum so it can be compared directly
 * against the text column.
 */
export type RejectedReason =
  | "round_not_finished"
  | "format_not_authorised"
  | "no_course_rating"
  | "no_hole_data"
  | "min_holes_not_met_9"
  | "min_holes_not_met_18"
  | "incomplete_round_no_index";

/** Player-facing explanations for why a round did not count. */
export const REJECTED_REASON_LABELS: Record<RejectedReason, string> = {
  round_not_finished: "Round not finished",
  format_not_authorised: "Format not acceptable for handicapping",
  no_course_rating: "Course has no rating or slope",
  no_hole_data: "Course has no hole data",
  min_holes_not_met_9: `Fewer than ${MIN_HOLES_9} holes played`,
  min_holes_not_met_18: `Fewer than ${MIN_HOLES_18} holes played`,
  incomplete_round_no_index: "Incomplete round, and no handicap index yet",
};

/** Human-readable label for a `rejected_reason` from the database. */
export function rejectedReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return REJECTED_REASON_LABELS[reason as RejectedReason] ?? "Not acceptable for handicapping";
}

/** Minimum holes that must be played for a score on a tee of this many holes. */
export function minHolesForAcceptance(holeCount: number): number {
  return holeCount === 9 ? MIN_HOLES_9 : MIN_HOLES_18;
}

export type AcceptabilityInput = {
  /** Holes on the tee played — 9 or 18. */
  holeCount: number;
  /**
   * Holes STARTED. A hole begun and picked up counts as played (Rule 3.1, net
   * double bogey); a hole never started does not (Rule 3.2, scaled up).
   */
  holesStarted: number;
  format: string | null | undefined;
  /** True once the round has been finished. */
  isFinished: boolean;
  /** The player's Handicap Index at the time of the round, or null if they have none. */
  handicapIndex: number | null | undefined;
  /** Tee course rating; null/absent makes the score unacceptable. */
  courseRating?: number | null;
  /** Tee slope rating; null/absent/zero makes the score unacceptable. */
  slopeRating?: number | null;
  /** Whether the tee has per-hole par data. */
  hasHoleData?: boolean;
};

export type AcceptabilityResult = {
  accepted: boolean;
  rejectedReason: RejectedReason | null;
};

/**
 * Mirrors the `reason` CTE in `compute_handicap_round_result`, including its
 * ordering: the reason names the FIRST condition that failed, and `accepted`
 * is derived from it so the two can never disagree.
 */
export function acceptabilityFor(input: AcceptabilityInput): AcceptabilityResult {
  const {
    holeCount,
    holesStarted,
    format,
    isFinished,
    handicapIndex,
    courseRating,
    slopeRating,
    hasHoleData = true,
  } = input;

  const reason = ((): RejectedReason | null => {
    if (!isFinished) return "round_not_finished";
    if (!isAuthorisedFormat(format)) return "format_not_authorised";

    // Rule 2.1: the course must have a current Course Rating and Slope Rating.
    // `courseRating`/`slopeRating` are optional so callers that genuinely
    // cannot see them (the live scorecard) are not forced to guess.
    if (courseRating === null || slopeRating === null || slopeRating === 0) {
      return "no_course_rating";
    }
    if (!hasHoleData) return "no_hole_data";

    if (holesStarted < minHolesForAcceptance(holeCount)) {
      return holeCount === 9 ? "min_holes_not_met_9" : "min_holes_not_met_18";
    }

    // G2.2(1)A: the initial award is built from COMPLETE rounds only — without
    // an index there is no expected score to scale the missing holes up with.
    if (handicapIndex == null && holesStarted < holeCount) {
      return "incomplete_round_no_index";
    }

    return null;
  })();

  return { accepted: reason === null, rejectedReason: reason };
}
