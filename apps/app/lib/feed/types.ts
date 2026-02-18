/**
 * Social Feed domain types.
 *
 * Goal:
 * - Keep DB shapes separate from UI “view models”.
 * - Make card types extensible without touching unrelated code.
 */

export type FeedItemType =
  | "user_post"
  | "round_played"
  | "course_record"
  | "pb"
  | "leaderboard_move"
  | "hole_event"
  | "match_start"
  | "match_update"
  | "match_result"
  | "hi_change"
  | "trend"
  | "system_announcement";

export type FeedAudience = "followers" | "public" | "private" | "match_participants" | "custom_list";
export type FeedVisibility = "visible" | "hidden" | "removed";

/**
 * Cursor-based pagination uses a stable tuple (occurred_at, id).
 * We encode/decode it as a string for query params.
 */
export type FeedCursor = {
  occurred_at: string; // ISO timestamp
  id: string; // uuid
};

export type FeedPageParams = {
  cursor?: FeedCursor | null;
  limit: number;
};

export type FeedActor = {
  profile_id: string;
  display_name: string;
  avatar_url?: string | null;
};

/**
 * Subject(s) of a feed item.
 * For most items this is the profile the card is "about" (often the actor),
 * but for multi-player items (e.g. round_played) there can be multiple subjects.
 */
export type FeedSubject = FeedActor;

/**
 * Optional “preview” of the highest-voted comment on an item.
 * Tie-breaker handled server-side (most recent when same votes).
 */
export type FeedTopComment = {
  id: string;
  body: string;
  created_at: string;
  vote_count: number;
  author: {
    profile_id: string;
    display_name: string;
    avatar_url?: string | null;
  };
};

/**
 * Optional reaction summary for subtle display on cards.
 * This is derived from reaction_counts (top N).
 */
export type FeedReactionSummary = Array<{
  emoji: string;
  count: number;
}>;

export type FeedPayloadByType = {
  user_post: {
    text?: string | null;
    image_urls?: string[] | null;
    tagged_profiles?: Array<{ profile_id: string; name: string }> | null;
    tagged_round_id?: string | null;
    tagged_course_id?: string | null;
    tagged_course_name?: string | null;
    created_from?: "web" | "mobile" | "system";
  };

  round_played: {
    round_id: string;
    course_id?: string | null;
    course_name: string;
    tee_name?: string | null;

    // For “collaboration” cards, list all players (subjects usually align)
    players: Array<{
      profile_id?: string | null;
      name: string;
      avatar_url?: string | null;

      // Desired display fields
      gross_total?: number | null;
      net_total?: number | null;
      net_to_par?: number | null;
      par_total?: number | null;
      holes_completed?: number | null;
    }>;

    date?: string | null;
  };

  /**
   * Course record cards should show the gross total strokes (not AGS).
   * Optionally include tee_name for clarity.
   */
  course_record: {
    round_id?: string | null;
    course_id?: string | null;
    course_name: string;
    tee_name?: string | null;

    // Who holds the record (often a single player)
    profile_id?: string | null;
    name?: string | null;
    avatar_url?: string | null;

    gross_total?: number | null;
    date?: string | null;
  };

  /**
   * Personal best cards should show the gross total strokes (not AGS).
   * This is PB on course+tee (per your spec).
   */
  pb: {
    round_id?: string | null;
    course_id?: string | null;
    course_name: string;
    tee_name?: string | null;

    profile_id?: string | null;
    name?: string | null;
    avatar_url?: string | null;

    gross_total?: number | null;
    date?: string | null;
  };

  /**
   * Hole event cards should include hole number, yardage and par.
   */
  hole_event: {
    round_id?: string | null;
    course_id?: string | null;
    course_name?: string | null;
    tee_name?: string | null;

    profile_id?: string | null;
    name?: string | null;
    avatar_url?: string | null;

    kind: "hio" | "albatross" | "eagle";
    hole_number?: number | null;
    par?: number | null;
    yardage?: number | null;

    date?: string | null;
  };

  // Keep the rest permissive for now (we’ll tighten later if needed)
  leaderboard_move: any;
  match_start: any;
  match_update: any;
  match_result: any;
  hi_change: any;
  trend: any;
  system_announcement: any;
};

export type FeedItemAggregates = {
  reaction_counts: Record<string, number>;
  comment_count: number;
  my_reaction: string | null;

  /**
   * Optional server-provided helpers (non-breaking):
   * - top_comment: highest voted comment preview (tie-break most recent)
   * - reaction_summary: small top-N emoji summary derived from reaction_counts
   */
  top_comment?: FeedTopComment | null;
  reaction_summary?: FeedReactionSummary | null;
};

export type FeedItemVM<TType extends FeedItemType = FeedItemType> = {
  id: string;
  type: TType;
  occurred_at: string;
  created_at: string;

  /** Who performed the action (may be null for synthetic/live items) */
  actor: FeedActor | null;

  /**
   * Who the card is about.
   * - For user_post: the posting profile
   * - For round_played: players in the round (often multiple)
   */
  subject: FeedSubject | null;
  subjects: FeedSubject[];

  audience: FeedAudience;
  visibility: FeedVisibility;
  payload: FeedPayloadByType[TType];
  aggregates: FeedItemAggregates;
};

export type FeedPageResponse = {
  items: FeedItemVM[];
  next_cursor: FeedCursor | null;
};
