/**
 * `events` carries a single `event_date`. A multi-day event's real span lives on
 * `event_rounds.scheduled_date`, so anywhere that shows "when is this event"
 * needs to derive the range rather than print the start date alone.
 */

export type DatedRound = { scheduled_date: string | null; status?: string | null };

/** ISO yyyy-mm-dd start/end for an event. `end` equals `start` for a one-dayer. */
export function eventDateRange(
  eventDate: string | null | undefined,
  rounds: DatedRound[] | null | undefined,
): { start: string | null; end: string | null } {
  const dates = (rounds ?? [])
    .filter((r) => r.status !== "cancelled")
    .map((r) => r.scheduled_date)
    .filter((d): d is string => !!d)
    .sort();

  if (dates.length === 0) {
    return { start: eventDate ?? null, end: eventDate ?? null };
  }

  // The event date still counts — round 1 may be undated while the event is not.
  const start = eventDate && eventDate < dates[0] ? eventDate : dates[0];
  return { start, end: dates[dates.length - 1] };
}

/** True when the event spans more than one day. */
export function isMultiDay(
  eventDate: string | null | undefined,
  rounds: DatedRound[] | null | undefined,
): boolean {
  const { start, end } = eventDateRange(eventDate, rounds);
  return !!start && !!end && start !== end;
}

/**
 * Compact human label: "12 Sep", "12–13 Sep", "30 Sep – 1 Oct".
 * Returns null when there is no date at all.
 */
export function formatEventDateRange(
  eventDate: string | null | undefined,
  rounds: DatedRound[] | null | undefined,
  locale = "en-GB",
): string | null {
  const { start, end } = eventDateRange(eventDate, rounds);
  if (!start) return null;

  const startDate = new Date(start);
  if (!end || start === end) {
    return startDate.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }

  const endDate = new Date(end);
  const sameMonth =
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getFullYear() === endDate.getFullYear();

  // Within one month the month name only needs saying once.
  const startLabel = sameMonth
    ? String(startDate.getDate())
    : startDate.toLocaleDateString(locale, { day: "numeric", month: "short" });
  const endLabel = endDate.toLocaleDateString(locale, { day: "numeric", month: "short" });

  return sameMonth ? `${startLabel}–${endLabel}` : `${startLabel} – ${endLabel}`;
}
