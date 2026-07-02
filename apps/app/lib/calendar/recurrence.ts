// lib/calendar/recurrence.ts
// Pure logic: expand recurring events, apply standalone-overrides-recurring
// precedence, fold scheduled rounds in as "busy", and compute the aggregate
// availability used by the show-all / hide-unavailable / available-only filters.

import { RRule } from "rrule";
import type {
  AvailabilityFilter,
  BucketState,
  CalendarEvent,
  CalendarRound,
  ResolvedOccurrence,
} from "./types";
import { dayKey, startOfDay, endOfDay } from "./dateUtils";

/** A round with no explicit duration is treated as this many hours of "busy". */
const ROUND_DURATION_MS = 4 * 60 * 60 * 1000;

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
  const start = new Date(round.scheduled_at);
  const end = new Date(start.getTime() + ROUND_DURATION_MS);
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
    // A player who has organised/joined a scheduled round is busy for that slot.
    busy: true,
    roundStatus: round.status,
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
  rangeEnd: Date
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

  // Standalone occurrences (one-off events + rounds) that can override recurring.
  const standalone = [...oneOff, ...roundOccs];

  // Suppress recurring occurrences overlapped by a standalone of the same owner.
  const keptRecurring = recurring.filter((rec) => {
    return !standalone.some(
      (s) => s.profileId === rec.profileId && intervalsOverlap(s.start, s.end, rec.start, rec.end)
    );
  });

  return [...standalone, ...keptRecurring].sort(
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
 * Filter occurrences for rendering given the aggregate day states.
 * - `all`: everything.
 * - `hide_unavailable`: drop every occurrence on a day flagged `unavailable`.
 * - `available_only`: keep occurrences only on days flagged `available`.
 */
export function applyAvailabilityFilter(
  occurrences: ResolvedOccurrence[],
  dayStates: Map<string, BucketState>,
  filter: AvailabilityFilter
): ResolvedOccurrence[] {
  if (filter === "all") return occurrences;

  return occurrences.filter((occ) => {
    const state = dayStates.get(dayKey(occ.start)) ?? "neutral";
    if (filter === "hide_unavailable") return state !== "unavailable";
    // available_only
    return state === "available";
  });
}

/** Whether a given day should be shown at all under the current filter. */
export function isDayVisible(
  day: Date,
  dayStates: Map<string, BucketState>,
  filter: AvailabilityFilter
): boolean {
  if (filter === "all") return true;
  const state = dayStates.get(dayKey(day)) ?? "neutral";
  if (filter === "hide_unavailable") return state !== "unavailable";
  return state === "available";
}
