// lib/calendar/recurrence.ts
// Pure logic: expand recurring events, apply standalone-overrides-recurring
// precedence, fold scheduled rounds in as "busy", and compute the aggregate
// availability used by the show-all / hide-unavailable / available-only filters.

import { RRule } from "rrule";
import type {
  AvailabilityFilter,
  BucketState,
  CalendarEvent,
  CalendarGroupEvent,
  CalendarRound,
  PlayerDayStatus,
  ResolvedOccurrence,
} from "./types";
import { dayKey, startOfDay, endOfDay } from "./dateUtils";

/** A round with no explicit duration is treated as this many hours of "busy". */
const ROUND_DURATION_MS = 4 * 60 * 60 * 1000;

/** The playable day window, in minutes from local midnight: 6am–10pm. */
export const DAY_WINDOW_START_MIN = 6 * 60; // 360
export const DAY_WINDOW_END_MIN = 22 * 60; // 1320
/** A free gap shorter than this is too short for a round → treated unavailable. */
export const MIN_USABLE_WINDOW_MIN = 3 * 60; // 180

function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * rrule works in a "floating"/UTC frame. To recur at a fixed local wall-clock
 * time we encode local fields into a Date's UTC fields, let rrule iterate, then
 * decode back to a real local Date. This keeps "9am" as 9am across DST.
 */
function toFloating(d: Date): Date {
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0)
  );
}
function fromFloating(d: Date): Date {
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    0
  );
}

/** Expand one recurring event into concrete occurrences within [rangeStart, rangeEnd). */
export function expandRecurring(
  event: CalendarEvent,
  rangeStart: Date,
  rangeEnd: Date
): ResolvedOccurrence[] {
  const start = new Date(event.start_at);
  const end = new Date(event.end_at);
  const durationMs = Math.max(0, end.getTime() - start.getTime());

  let rule: RRule;
  try {
    const options = RRule.parseString(event.rrule as string);
    options.dtstart = toFloating(start);
    if (options.until) options.until = toFloating(options.until);
    rule = new RRule(options);
  } catch {
    // Malformed rule — fall back to treating it as a single occurrence.
    return [makeEventOccurrence(event, start, end, true)];
  }

  const starts = rule.between(toFloating(rangeStart), toFloating(rangeEnd), true);
  return starts.map((floating) => {
    const occStart = fromFloating(floating);
    const occEnd = new Date(occStart.getTime() + durationMs);
    return makeEventOccurrence(event, occStart, occEnd, true);
  });
}

function makeEventOccurrence(
  event: CalendarEvent,
  start: Date,
  end: Date,
  recurring: boolean
): ResolvedOccurrence {
  return {
    key: `${event.id}:${start.toISOString()}`,
    sourceId: event.id,
    profileId: event.profile_id,
    kind: event.kind,
    title: event.title,
    start,
    end,
    allDay: event.all_day,
    recurring,
    busy: event.kind === "unavailable",
  };
}

function makeRoundOccurrence(round: CalendarRound): ResolvedOccurrence {
  const finished = round.status === "finished";
  let start: Date;
  let end: Date;
  if (finished) {
    // Place on the day it was played.
    end = round.finished_at ? new Date(round.finished_at) : new Date();
    start = round.started_at
      ? new Date(round.started_at)
      : new Date(end.getTime() - ROUND_DURATION_MS);
  } else {
    const anchor = round.scheduled_at ?? round.started_at ?? new Date().toISOString();
    start = new Date(anchor);
    end = new Date(start.getTime() + ROUND_DURATION_MS);
  }

  return {
    key: `round:${round.round_id}:${round.profile_id}`,
    sourceId: round.round_id,
    profileId: round.profile_id,
    kind: "round",
    title: round.name ?? round.course_name ?? "Round",
    start,
    end,
    allDay: false,
    recurring: false,
    // A scheduled/live round makes the player busy; a finished round is in the
    // past and does not gate future availability.
    busy: !finished,
    roundStatus: round.status,
    resultLabel: finished && round.gross != null ? String(round.gross) : undefined,
    scoreDiff: finished ? round.score_differential : undefined,
    courseName: round.course_name,
    formatType: round.format_type,
    playerNames: round.player_names,
    selfParticipated: round.selfParticipated,
  };
}

/** A Majors group event → occurrence (self only). Timed at the player's tee
 *  time, else an all-day "TBC" block on the event date. */
function makeGroupEventOccurrence(ev: CalendarGroupEvent, selfId: string): ResolvedOccurrence {
  const confirmed = ev.status === "confirmed";
  let start: Date;
  let end: Date;
  let allDay: boolean;
  let tbc: boolean;
  if (ev.tee_time) {
    start = new Date(ev.tee_time);
    end = new Date(start.getTime() + ROUND_DURATION_MS);
    allDay = false;
    tbc = false;
  } else {
    const d = ev.event_date ? new Date(`${ev.event_date}T00:00:00`) : new Date();
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
    end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0);
    allDay = true;
    tbc = true;
  }
  return {
    key: `event:${ev.event_id}`,
    sourceId: ev.event_id,
    profileId: selfId,
    kind: "event",
    title: ev.name ?? "Event",
    start,
    end,
    allDay,
    recurring: false,
    // Only a confirmed entry is a real commitment that blocks availability.
    busy: confirmed,
    eventStatus: ev.status,
    tbc,
    groupName: ev.group_name,
  };
}

/**
 * Resolve every source (recurring events, one-off events, scheduled rounds)
 * into concrete occurrences within the range, honouring the rule that a
 * standalone (non-recurring) event or a scheduled round takes precedence over
 * recurring occurrences it overlaps — for the same person.
 */
export function resolveOccurrences(
  events: CalendarEvent[],
  rounds: CalendarRound[],
  rangeStart: Date,
  rangeEnd: Date,
  groupEvents: CalendarGroupEvent[] = [],
  selfId?: string | null
): ResolvedOccurrence[] {
  const oneOff: ResolvedOccurrence[] = [];
  const recurring: ResolvedOccurrence[] = [];

  for (const ev of events) {
    if (ev.rrule) {
      recurring.push(...expandRecurring(ev, rangeStart, rangeEnd));
    } else {
      const start = new Date(ev.start_at);
      const end = new Date(ev.end_at);
      // Only include one-offs that intersect the visible range.
      if (intervalsOverlap(start, end, rangeStart, rangeEnd)) {
        oneOff.push(makeEventOccurrence(ev, start, end, false));
      }
    }
  }

  const roundOccs = rounds.map(makeRoundOccurrence);
  const eventOccs = selfId ? groupEvents.map((g) => makeGroupEventOccurrence(g, selfId)) : [];

  // Standalone occurrences (one-off events + rounds) that can override recurring.
  const standalone = [...oneOff, ...roundOccs];

  // Suppress recurring occurrences overlapped by a standalone of the same owner.
  const keptRecurring = recurring.filter((rec) => {
    return !standalone.some(
      (s) => s.profileId === rec.profileId && intervalsOverlap(s.start, s.end, rec.start, rec.end)
    );
  });

  return [...standalone, ...eventOccs, ...keptRecurring].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
}

/**
 * Aggregate availability per day across a set of displayed people.
 * - `unavailable` if ANY displayed person is busy (unavailability/round) that day.
 * - else `available` if ≥1 displayed person has an explicit availability event.
 * - else `neutral`.
 */
export function resolveDayStates(
  occurrences: ResolvedOccurrence[],
  profileIds: string[],
  days: Date[]
): Map<string, BucketState> {
  const ids = new Set(profileIds);
  const states = new Map<string, BucketState>();

  for (const day of days) {
    const dStart = startOfDay(day);
    const dEnd = endOfDay(day);
    let anyBusy = false;
    let anyAvailable = false;

    for (const occ of occurrences) {
      if (!ids.has(occ.profileId)) continue;
      if (!intervalsOverlap(occ.start, occ.end, dStart, dEnd)) continue;
      if (occ.busy) anyBusy = true;
      else if (occ.kind === "available") anyAvailable = true;
    }

    states.set(dayKey(day), anyBusy ? "unavailable" : anyAvailable ? "available" : "neutral");
  }

  return states;
}

/**
 * Per-player status on a given day for the month heat-map dots.
 * Precedence: scheduled(round) > unavailable > available > none.
 */
export function resolveDayPlayerStatuses(
  occurrences: ResolvedOccurrence[],
  profileIds: string[],
  day: Date
): Map<string, PlayerDayStatus> {
  const dStart = startOfDay(day);
  const dEnd = endOfDay(day);
  const flags = new Map<string, { round: boolean; unavail: boolean; avail: boolean }>();
  for (const id of profileIds) flags.set(id, { round: false, unavail: false, avail: false });

  for (const occ of occurrences) {
    const f = flags.get(occ.profileId);
    if (!f) continue;
    if (!intervalsOverlap(occ.start, occ.end, dStart, dEnd)) continue;
    if (occ.kind === "round") f.round = true;
    else if (occ.kind === "event") {
      if (occ.eventStatus === "confirmed") f.round = true; // confirmed entry = scheduled
    } else if (occ.kind === "unavailable") f.unavail = true;
    else if (occ.kind === "available") f.avail = true;
  }

  const out = new Map<string, PlayerDayStatus>();
  for (const [id, f] of flags) {
    out.set(id, f.round ? "scheduled" : f.unavail ? "unavailable" : f.avail ? "available" : "none");
  }
  return out;
}

/**
 * Net free-ness for a day's aggregate status, in [-1, 1] — drives the month
 * heat-map background (green when the group is free, red when blocked).
 */
export function dayHeat(statuses: Map<string, PlayerDayStatus>): number {
  const total = statuses.size;
  if (total === 0) return 0;
  let avail = 0;
  let unavail = 0;
  for (const s of statuses.values()) {
    if (s === "available") avail++;
    else if (s === "unavailable" || s === "scheduled") unavail++;
  }
  return (avail - unavail) / total;
}

/**
 * Filter occurrences for rendering by kind (not aggregate day state):
 * - `all`: everything.
 * - `dim_busy`: keep everything (busy is *dimmed* at render time, not removed).
 * - `available_only`: keep **only availability** (rounds + unavailability hidden).
 */
export function applyAvailabilityFilter(
  occurrences: ResolvedOccurrence[],
  filter: AvailabilityFilter
): ResolvedOccurrence[] {
  if (filter === "available_only") return occurrences.filter((o) => o.kind === "available");
  // all + dim_busy keep the full set; dim_busy only changes styling.
  return occurrences;
}

/** True when an occurrence should render greyed/faded under the `dim_busy` filter. */
export function isDimmed(occ: ResolvedOccurrence, filter: AvailabilityFilter): boolean {
  return filter === "dim_busy" && occ.busy;
}

/**
 * In the past, availability/unavailability is irrelevant — only played rounds
 * matter. Drops non-round occurrences that end before the start of today.
 */
export function hidePastAvailability(
  occurrences: ResolvedOccurrence[],
  now: Date = new Date()
): ResolvedOccurrence[] {
  const todayStart = startOfDay(now).getTime();
  return occurrences.filter(
    (o) => o.kind === "round" || o.end.getTime() >= todayStart
  );
}

/**
 * Bucket occurrences onto every local day they intersect (not just their start
 * day), so multi-day events appear on each covered day.
 */
export function groupOccurrencesByDay(
  occurrences: ResolvedOccurrence[],
  days: Date[]
): Map<string, ResolvedOccurrence[]> {
  const map = new Map<string, ResolvedOccurrence[]>();
  for (const day of days) map.set(dayKey(day), []);
  for (const occ of occurrences) {
    for (const day of days) {
      const dStart = startOfDay(day);
      const dEnd = endOfDay(day);
      if (intervalsOverlap(occ.start, occ.end, dStart, dEnd)) {
        map.get(dayKey(day))!.push(occ);
      }
    }
  }
  return map;
}

// --- Time-grid interval shading ---------------------------------------------

/** A [start, end) interval expressed in minutes from local midnight (0..1440). */
export type MinuteInterval = { start: number; end: number };

function clipToDayMinutes(occ: ResolvedOccurrence, day: Date): MinuteInterval | null {
  const dStart = startOfDay(day).getTime();
  const dEnd = endOfDay(day).getTime();
  const s = Math.max(occ.start.getTime(), dStart);
  const e = Math.min(occ.end.getTime(), dEnd);
  if (e <= s) return null;
  return { start: (s - dStart) / 60000, end: (e - dStart) / 60000 };
}

/** Merge overlapping/adjacent intervals into a sorted, non-overlapping set. */
export function mergeIntervals(intervals: MinuteInterval[]): MinuteInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: MinuteInterval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

/** Subtract set B from set A (both assumed merged & sorted). */
function subtractIntervals(a: MinuteInterval[], b: MinuteInterval[]): MinuteInterval[] {
  const out: MinuteInterval[] = [];
  for (const seg of a) {
    let cursor = seg.start;
    for (const cut of b) {
      if (cut.end <= cursor || cut.start >= seg.end) continue;
      if (cut.start > cursor) out.push({ start: cursor, end: Math.min(cut.start, seg.end) });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= seg.end) break;
    }
    if (cursor < seg.end) out.push({ start: cursor, end: seg.end });
  }
  return out.filter((s) => s.end > s.start);
}

/** Minute-intervals for a day's shading, split into busy / available / unusable. */
export type DayIntervals = {
  busy: MinuteInterval[];
  available: MinuteInterval[];
  /** Free gaps inside 6am–10pm shorter than 3h — too short for a round. */
  unusable: MinuteInterval[];
};

/** The 6am–10pm playable window as a single interval. */
function dayWindowInterval(): MinuteInterval {
  return { start: DAY_WINDOW_START_MIN, end: DAY_WINDOW_END_MIN };
}

/**
 * Merged busy/available/unusable minute-intervals for a single day across the
 * displayed people — used to shade the time grid. `busy` = any person busy;
 * `available` = a person marked available with nobody busy over that span (busy
 * wins). `unusable` = the leftover free time inside 6am–10pm that is neither
 * busy nor explicitly available and is shorter than the 3h round minimum.
 */
export function resolveDayIntervals(
  occurrences: ResolvedOccurrence[],
  profileIds: string[],
  day: Date
): DayIntervals {
  const ids = new Set(profileIds);
  const busyRaw: MinuteInterval[] = [];
  const availRaw: MinuteInterval[] = [];

  for (const occ of occurrences) {
    if (!ids.has(occ.profileId)) continue;
    const iv = clipToDayMinutes(occ, day);
    if (!iv) continue;
    if (occ.busy) busyRaw.push(iv);
    else if (occ.kind === "available") availRaw.push(iv);
  }

  const busy = mergeIntervals(busyRaw);
  const available = subtractIntervals(mergeIntervals(availRaw), busy);

  // Free time inside the window that is neither busy nor explicitly available.
  const free = subtractIntervals(subtractIntervals([dayWindowInterval()], busy), available);
  const unusable = free.filter((s) => s.end - s.start < MIN_USABLE_WINDOW_MIN);

  return { busy, available, unusable };
}

/**
 * True when the day has at least one contiguous non-busy span of ≥3h inside the
 * 6am–10pm window — i.e. there's room to actually play a round. Availability is
 * a subset of "non-busy", so this also covers explicitly-available days.
 */
export function hasUsableWindow(
  occurrences: ResolvedOccurrence[],
  profileIds: string[],
  day: Date
): boolean {
  const ids = new Set(profileIds);
  const busyRaw: MinuteInterval[] = [];
  for (const occ of occurrences) {
    if (!ids.has(occ.profileId) || !occ.busy) continue;
    const iv = clipToDayMinutes(occ, day);
    if (iv) busyRaw.push(iv);
  }
  const free = subtractIntervals([dayWindowInterval()], mergeIntervals(busyRaw));
  return free.some((s) => s.end - s.start >= MIN_USABLE_WINDOW_MIN);
}
