// lib/calendar/dateUtils.ts
// Calendar grid / range helpers, extending lib/stats/timeModel.ts.

import { addDays, iso } from "@/lib/stats/timeModel";

export { addDays, iso };

/** Local YYYY-MM-DD key for a date (unlike `iso`, which uses UTC). */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Midnight (local) at the start of the given day. */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Midnight (local) at the start of the following day. */
export function endOfDay(d: Date): Date {
  return addDays(startOfDay(d), 1);
}

/**
 * Start of the week containing `d`. `weekStartsOn` 0 = Sunday, 1 = Monday
 * (default Monday, matching UK usage).
 */
export function startOfWeek(d: Date, weekStartsOn: 0 | 1 = 1): Date {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStartsOn + 7) % 7;
  return addDays(x, -diff);
}

/** The 7 days of the week containing `d`. */
export function getWeekDays(d: Date, weekStartsOn: 0 | 1 = 1): Date[] {
  const start = startOfWeek(d, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Saturday + Sunday of every week overlapping the month containing `d`. */
export function getWeekendDays(monthAnchor: Date): Date[] {
  const days = getMonthMatrix(monthAnchor).flat();
  return days.filter((day) => {
    const g = day.getDay();
    return g === 0 || g === 6; // Sun or Sat
  });
}

/**
 * A 6-row x 7-col matrix of dates covering the month containing `anchor`,
 * padded with leading/trailing days so every row is a full week (Mon start).
 */
export function getMonthMatrix(anchor: Date, weekStartsOn: 0 | 1 = 1): Date[][] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth, weekStartsOn);
  const rows: Date[][] = [];
  for (let r = 0; r < 6; r++) {
    const row: Date[] = [];
    for (let c = 0; c < 7; c++) {
      row.push(addDays(gridStart, r * 7 + c));
    }
    rows.push(row);
  }
  return rows;
}

/** Whether two dates fall on the same local calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

/** e.g. "2:30 PM" in the browser's locale. */
export function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** e.g. "Sat 12 Jul". */
export function formatDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** e.g. "July 2026". */
export function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * The visible date range for a view, as [start, end) — used to bound
 * recurrence expansion and round queries.
 */
export function rangeForView(
  anchor: Date,
  view: "week" | "month" | "weekends" | "agenda"
): { start: Date; end: Date } {
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 7) };
  }
  if (view === "agenda") {
    // Agenda shows the next ~6 weeks from the start of the anchor's week.
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 42) };
  }
  // month & weekends both span the padded month grid.
  const matrix = getMonthMatrix(anchor);
  const start = startOfDay(matrix[0][0]);
  const end = endOfDay(matrix[5][6]);
  return { start, end };
}
