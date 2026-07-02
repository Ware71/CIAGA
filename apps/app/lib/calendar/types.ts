// lib/calendar/types.ts
// Shared types for the calendar & scheduling feature.

export type CalendarEventKind = "available" | "unavailable";

/** A stored calendar_events row (availability / unavailability block). */
export type CalendarEvent = {
  id: string;
  profile_id: string;
  kind: CalendarEventKind;
  title: string | null;
  all_day: boolean;
  start_at: string; // ISO timestamptz
  end_at: string; // ISO timestamptz
  rrule: string | null; // iCal RRULE string; null = one-off (standalone)
  created_at?: string;
  updated_at?: string;
};

export type RoundStatus = "draft" | "scheduled" | "starting" | "live" | "finished";

/** A scheduled/live/finished round surfaced from get_calendar_rounds. */
export type CalendarRound = {
  round_id: string;
  profile_id: string;
  participant_id: string;
  name: string | null;
  course_name: string | null;
  scheduled_at: string | null; // ISO timestamptz
  started_at: string | null;
  finished_at: string | null;
  status: RoundStatus;
  format_type: string | null;
  gross: number | null;
  course_handicap: number | null;
  player_names: string[] | null;
};

/** A participant row inside the round info window. */
export type RoundInfoParticipant = {
  profile_id: string;
  name: string | null;
  gross: number | null;
  course_handicap: number | null;
};

/** Full detail for the round info window (from get_calendar_round_info). */
export type RoundInfo = {
  round_id: string;
  name: string | null;
  course_name: string | null;
  status: RoundStatus;
  format_type: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  participants: RoundInfoParticipant[];
};

/** The kind of a resolved occurrence rendered on the calendar. */
export type OccurrenceKind = "round" | "available" | "unavailable";

/**
 * A concrete, dated occurrence ready to render. Recurring events expand into
 * many of these; one-off events and scheduled rounds produce one each.
 */
export type ResolvedOccurrence = {
  /** Stable-ish key: `${sourceId}:${start ISO}`. */
  key: string;
  /** id of the source calendar_event or round. */
  sourceId: string;
  profileId: string;
  kind: OccurrenceKind;
  title: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  recurring: boolean;
  /** Rounds and unavailability events both make a person "busy". */
  busy: boolean;
  /** Present only for round occurrences — used to route/open info on click. */
  roundStatus?: CalendarRound["status"];
  /** Finished-round headline number (gross), pre-formatted for the chip. */
  resultLabel?: string;
  /** Round course name, for richer round chips/bars. */
  courseName?: string | null;
  /** All players in a round, for the wide day-row bars. */
  playerNames?: string[] | null;
};

export type Circle = {
  id: string;
  owner_profile_id: string;
  name: string;
  members: CircleMember[];
};

export type CircleMember = {
  profile_id: string;
  name: string | null;
  avatar_url: string | null;
};

export type ViewMode = "week" | "month" | "weekends" | "agenda";

export type ProfileLite = {
  id: string;
  name: string | null;
  avatar_url: string | null;
};

/** What the calendar is currently showing. */
export type Scope =
  | { kind: "me" }
  | { kind: "people"; ids: string[]; includeSelf: boolean }
  | { kind: "circle"; id: string }
  | { kind: "looking" };

export type AvailabilityFilter = "all" | "hide_unavailable" | "available_only";

/** Aggregate availability state for a day (or slot) across displayed people. */
export type BucketState = "unavailable" | "available" | "neutral";
