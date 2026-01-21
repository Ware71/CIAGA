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

export type FeedAudience =
  | "followers"
  | "public"
  | "private"
  | "match_participants"
  | "custom_list";

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
 * What we store in feed_items.payload (jsonb).
 * We keep it typed per card, but note: runtime validation is in schemas.ts.
 */
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
    players: Array<{ profile_id: string; name: string }>;
    gross_total?: number | null;
    net_total?: number | null;
    gross_to_par?: number | null;
    net_to_par?: number | null;
    date?: string | null; // YYYY-MM-DD
  };

  course_record: {
    record_type: "course_record";
    metric: "gross" | "net";
    course_id?: string | null;
    course_name: string;
    tee_name?: string | null;
    score: number;
    to_par?: number | null;
    previous_record?: number | null;
    round_id?: string | null;
    date?: string | null; // YYYY-MM-DD
  };

  pb: {
    record_type: "pb";
    metric: "gross" | "net";
    label?: string | null; // e.g. "Personal Best Net"
    course_id?: string | null;
    course_name?: string | null;
    tee_name?: string | null;
    score: number;
    to_par?: number | null;
    previous_best?: number | null;
    round_id?: string | null;
    date?: string | null; // YYYY-MM-DD
  };

  leaderboard_move: {
    leaderboard_id: string;
    old_rank?: number | null;
    new_rank: number;
    metric_value?: number | null;
    delta?: number | null;
    label?: string | null;
  };

  hole_event: {
    event: "eagle" | "albatross" | "hole_in_one";
    round_id?: string | null;
    course_id?: string | null;
    course_name?: string | null;
    tee_name?: string | null;
    hole_number: number;
    par: number;
    score: number;
    date?: string | null; // YYYY-MM-DD
  };

  match_start: {
    match_id: string;
    course_id?: string | null;
    course_name?: string | null;
    tee_name?: string | null;
    format?: string | null;
    start_time?: string | null; // ISO
    participants: Array<{ profile_id: string; name: string }>;
  };

  match_update: {
    match_id: string;
    status?: string | null;
    summary: string; // e.g. "X is 2 up thru 11"
    thru?: number | null;
    last_updated?: string | null; // ISO
  };

  match_result: {
    match_id: string;
    winner_profile_id?: string | null;
    winner_name?: string | null;
    margin?: string | null; // "2&1", "3 up", etc.
    highlights?: string[] | null;
    finished_at?: string | null; // ISO
  };

  hi_change: {
    old_hi: number;
    new_hi: number;
    delta: number;
    effective_date?: string | null; // YYYY-MM-DD
  };

  trend: {
    label: string; // e.g. "3 straight rounds under net par"
    details?: string | null;
    window_label?: string | null; // e.g. "last 10 rounds"
  };

  system_announcement: {
    title: string;
    body?: string | null;
    cta_label?: string | null;
    cta_href?: string | null;
  };
};

export type FeedPayload = FeedPayloadByType[FeedItemType];

/**
 * DB row shape (as returned by Supabase) for feed_items.
 * Note: actual table columns may include more; keep this minimal.
 */
export type FeedItemRow = {
  id: string;
  type: FeedItemType;
  actor_profile_id: string | null;
  audience: FeedAudience;
  visibility: FeedVisibility;
  occurred_at: string; // ISO timestamp
  created_at: string; // ISO timestamp
  payload: unknown; // validate at runtime
  group_key?: string | null;
};

/**
 * Aggregates and per-viewer metadata returned with feed items.
 */
export type FeedItemAggregates = {
  reaction_counts?: Record<string, number>; // emoji -> count
  comment_count?: number;
  my_reaction?: string | null; // emoji
};

/**
 * The normalized “view model” sent to the client/UI.
 * This is what FeedCard consumes.
 */
export type FeedItemVM<TType extends FeedItemType = FeedItemType> = {
  id: string;
  type: TType;
  occurred_at: string;
  created_at: string;
  actor: FeedActor | null;
  audience: FeedAudience;
  visibility: FeedVisibility;
  payload: FeedPayloadByType[TType];
  aggregates: FeedItemAggregates;
};

export type FeedPageResponse = {
  items: FeedItemVM[];
  next_cursor: FeedCursor | null;
};
