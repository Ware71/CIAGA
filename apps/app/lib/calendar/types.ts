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
  gross: number | null; // AGS when available, else raw total
  course_handicap: number | null;
  score_differential: number | null;
  player_names: string[] | null;
  /** Client-computed: did the viewer participate in this round? */
  selfParticipated?: boolean;
};

/** A competition event from a Majors group the viewer belongs to. */
export type CalendarGroupEvent = {
  event_id: string;
  name: string | null;
  group_name: string | null;
  event_date: string | null; // date
  tee_time: string | null; // ISO timestamptz, null = TBC
  status: "draft" | "confirmed"; // confirmed = the viewer has entered
  event_type: string | null;
  entry_window_start: string | null; // ISO timestamptz — when entry opens
  entry_window_end: string | null; // ISO timestamptz — when entry closes
};

/**
 * Entry state of a Majors event for the viewer, driving the calendar tag:
 * - `entered`: the viewer has an entry (a real commitment).
 * - `enter_now`: entry is open (and the viewer hasn't entered) — act now.
 * - `entry_soon`: entry opens in the future.
 * - `entry_closed`: the entry window has passed and the viewer never entered.
 */
export type EntryState = "entered" | "enter_now" | "entry_soon" | "entry_closed";

/** A participant row inside the round info window (finished-round stats). */
export type RoundInfoParticipant = {
  profile_id: string;
  name: string | null;
  raw_strokes: number | null; // actual total strokes (= gross)
  par_played: number | null; // par of holes actually scored
  ags: number | null; // adjusted gross score
  course_handicap: number | null;
  score_differential: number | null;
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
export type OccurrenceKind = "round" | "available" | "unavailable" | "event";

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
  /** Finished-round headline number (AGS), pre-formatted for the chip. */
  resultLabel?: string;
  /** Finished-round score differential (e.g. +9.4). */
  scoreDiff?: number | null;
  /** Round course name, for richer round chips/bars. */
  courseName?: string | null;
  /** Round format (strokeplay/stableford/…), for the full-detail round card. */
  formatType?: string | null;
  /** All players in a round, for the wide day-row bars. */
  playerNames?: string[] | null;
  /** Did the viewer participate in this round? (past-result rendering) */
  selfParticipated?: boolean;
  /** Group-event only: draft (not entered) vs confirmed (entered). Drives `busy`. */
  eventStatus?: "draft" | "confirmed";
  /** Group-event only: the entry-window state, drives the calendar tag. */
  entryState?: EntryState;
  /** Group-event only: no individual tee time set yet. */
  tbc?: boolean;
  /** Group-event only: the group name. */
  groupName?: string | null;
};

/** A single player's status on a given day, for the month heat-map dots. */
export type PlayerDayStatus = "available" | "scheduled" | "unavailable" | "none";

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

/**
 * Zoom ladder for the interactive calendar: the level drives both the time span
 * and how much detail each occurrence shows (the "hierarchy"). Each level
 * auto-fits the screen (no scroll); pinching steps up/down the ladder.
 *   0 = Month · 1 = 4 Weeks · 2 = 3 Weeks · 3 = 2 Weeks · 4 = Week
 *   5 = 3-Day (time grid) · 6 = Day (time grid)
 * In the Weekends view the ladder is capped at 4 (no time-grid levels).
 */
export type ZoomLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The deepest zoom levels render a per-hour time grid rather than a day grid. */
export const TIME_GRID_MIN_ZOOM = 5;
/** Weekends view has no time-grid levels — it stops at the 1-week grid. */
export const WEEKENDS_MAX_ZOOM = 4;

/** Top-level calendar mode. "looking" is driven by `Scope`, not this. */
export type CalendarMode = "calendar" | "agenda";

/** How richly a round/event renders — scales with zoom. */
export type Density = "pip" | "compact" | "medium" | "full";

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

/**
 * Availability filter — rounds & events ALWAYS survive both filters; only
 * unavailability ("busy") blocks are ever dropped.
 * - `all`: show everything.
 * - `hide_busy`: drop unavailability blocks. Days that were *only* busy blank
 *   out as "removed"; empty days stay as normal empty cells.
 * - `available_only`: additionally blank out days with no explicit availability
 *   (and no round/event) — only "available" days keep their normal cell.
 */
export type AvailabilityFilter = "all" | "hide_busy" | "available_only";

/**
 * Per-day render state under the active filter, so a day emptied *by the
 * filter* looks distinct from a genuinely empty day.
 * - `shown`: the day has content to render.
 * - `removed`: the filter hid this day's content (draw the "removed" hatch).
 * - `empty`: nothing here either way (plain empty cell).
 */
export type DayFilterState = "shown" | "removed" | "empty";

/** Aggregate availability state for a day (or slot) across displayed people. */
export type BucketState = "unavailable" | "available" | "neutral";
