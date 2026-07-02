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

/** A scheduled/live round surfaced from get_calendar_rounds. */
export type CalendarRound = {
  round_id: string;
  profile_id: string;
  name: string | null;
  course_name: string | null;
  scheduled_at: string; // ISO timestamptz
  status: "scheduled" | "starting" | "live";
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
  /** Present only for round occurrences — used to route on click. */
  roundStatus?: CalendarRound["status"];
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
