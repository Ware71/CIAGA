// Fantasy Picks — attendance / eligibility model.
//
// Before entry opens, every active group member is eligible for the field.
// Once entry opens, members who HAVEN'T signed up carry an attendance
// probability that starts from their historical participation rate and decays
// to zero at a cutoff (2 weeks before the event), at which point they drop out.
// Confirmed entrants always attend. Pure functions — odds.ts does the fetching.

export const ATTENDANCE_CUTOFF_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Below this many group events since joining, use the prior instead of a rate. */
const MIN_EVENTS_FOR_RATE = 3;
const DEFAULT_RATE = 0.5;
/** When no entry window is set, assume it opened this long before the cutoff. */
const DEFAULT_WINDOW_DAYS = 21;

/** Historical participation = events played ÷ group events held since joining. */
export function participationRate(eventsPlayed: number, eventsHeldSinceJoin: number): number {
  if (eventsHeldSinceJoin < MIN_EVENTS_FOR_RATE) return DEFAULT_RATE;
  return Math.max(0, Math.min(1, eventsPlayed / eventsHeldSinceJoin));
}

/** Linear decay: 1 at entry-window open (or far out), 0 at the T-14d cutoff. */
export function attendanceDecay(
  now: number,
  eventDate: number,
  windowStart: number | null
): number {
  const cutoff = eventDate - ATTENDANCE_CUTOFF_DAYS * DAY_MS;
  const start = windowStart ?? cutoff - DEFAULT_WINDOW_DAYS * DAY_MS;
  if (now <= start) return 1;
  if (now >= cutoff) return 0;
  if (cutoff <= start) return 0;
  return (cutoff - now) / (cutoff - start);
}

export type AttendancePhase = "pre_open" | "open" | "closed";

export function attendancePhase(
  now: number,
  eventDate: number,
  windowStart: number | null
): AttendancePhase {
  const cutoff = eventDate - ATTENDANCE_CUTOFF_DAYS * DAY_MS;
  if (now >= cutoff) return "closed";
  if (windowStart != null && now < windowStart) return "pre_open";
  return "open";
}

/**
 * Attendance probability for a member:
 *  - confirmed entrant → 1
 *  - pre-open (before the entry window opens) → 1 (all members eligible, no
 *    uncertainty yet — the user's "everyone's in until entry opens")
 *  - open → participation rate × time-decay toward the T-14d cutoff
 *  - closed (≤ 14d out, still not entered) → 0 (dropped from the field)
 */
export function computeAttendanceProbability(
  member: { entered: boolean; participation: number },
  now: number,
  eventDate: number,
  windowStart: number | null
): number {
  if (member.entered) return 1;
  const phase = attendancePhase(now, eventDate, windowStart);
  if (phase === "closed") return 0;
  if (phase === "pre_open") return 1;
  return member.participation * attendanceDecay(now, eventDate, windowStart);
}
