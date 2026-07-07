// lib/calendar/dateUtils.ts
// Calendar grid / range helpers, extending lib/stats/timeModel.ts.

import { addDays, iso } from "@/lib/stats/timeModel";
import type { ZoomLevel } from "./types";

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

/** e.g. "W/C Mon 6 Jul" for the start of the week containing `d`. */
export function formatWeekCommencing(d: Date): string {
  const start = startOfWeek(d);
  return `W/C ${start.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}`;
}

/** e.g. "Sat 5 Jul – Sun 13 Jul" for an inclusive day span. */
export function formatRangeLabel(start: Date, endExclusive: Date): string {
  const last = addDays(endExclusive, -1);
  const fmt = (x: Date) =>
    x.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${fmt(start)} – ${fmt(last)}`;
}

/** Short weekday + date for a time-grid column header, e.g. "Mon 6". */
export function formatColumnHeader(d: Date): { weekday: string; day: number } {
  return { weekday: d.toLocaleDateString(undefined, { weekday: "short" }), day: d.getDate() };
}

/** Format an hour (0-23) as a compact axis label, e.g. "6 AM", "12 PM". */
export function formatHourLabel(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

/** First names of players for a round card, e.g. "Ware, Jack +2". */
export function playersLabel(names: string[] | null | undefined): string {
  if (!names || names.length === 0) return "";
  const firsts = names.map((n) => n.split(" ")[0]);
  if (firsts.length <= 2) return firsts.join(", ");
  return `${firsts.slice(0, 2).join(", ")} +${firsts.length - 2}`;
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

/** The 3-day window centred on `anchor` (yesterday-relative → anchor is middle). */
export function getThreeDayDays(anchor: Date): Date[] {
  const start = addDays(startOfDay(anchor), -1);
  return [start, addDays(start, 1), addDays(start, 2)];
}

/**
 * Weeks (each a Mon-start 7-day array) that contain at least one day of the
 * month containing `anchor` — trims the padded 6th row when it's all spill-over,
 * so Month is usually 5 columns, occasionally 6.
 */
export function monthWeeks(anchor: Date, weekStartsOn: 0 | 1 = 1): Date[][] {
  return getMonthMatrix(anchor, weekStartsOn).filter((week) =>
    week.some((d) => isSameMonth(d, anchor))
  );
}

/** Number of week-columns for a grid zoom level (0 = Month → use monthWeeks). */
export function weeksForZoom(zoom: ZoomLevel): number {
  switch (zoom) {
    case 1:
      return 4;
    case 2:
      return 3;
    case 3:
      return 2;
    case 4:
      return 1;
    default:
      return 0;
  }
}

/**
 * The weeks (each a Mon-start 7-day array) rendered for a grid zoom level 0..4.
 * These are the *columns* of the transposed main grid (7 weekday rows on Y).
 */
export function weekColumns(anchor: Date, zoom: ZoomLevel): Date[][] {
  if (zoom <= 0) return monthWeeks(anchor);
  const n = weeksForZoom(zoom);
  const start = startOfWeek(anchor);
  return Array.from({ length: n }, (_, i) => getWeekDays(addDays(start, i * 7)));
}

/**
 * The visible [start, end) range for a zoom level:
 * 0..4 = the week columns' span, 5 = 3-day (centred), 6 = single day.
 */
export function rangeForZoom(anchor: Date, zoom: ZoomLevel): { start: Date; end: Date } {
  if (zoom === 6) {
    const start = startOfDay(anchor);
    return { start, end: addDays(start, 1) };
  }
  if (zoom === 5) {
    const start = addDays(startOfDay(anchor), -1);
    return { start, end: addDays(start, 3) };
  }
  const weeks = weekColumns(anchor, zoom);
  const start = startOfDay(weeks[0][0]);
  const end = endOfDay(weeks[weeks.length - 1][6]);
  return { start, end };
}

/** The days rendered for a zoom level (before any weekends-only filtering). */
export function daysForZoom(anchor: Date, zoom: ZoomLevel): Date[] {
  if (zoom === 6) return [startOfDay(anchor)];
  if (zoom === 5) return getThreeDayDays(anchor);
  return weekColumns(anchor, zoom).flat();
}

/** Advance the anchor by one "page" appropriate to the zoom level. */
export function shiftAnchorForZoom(anchor: Date, zoom: ZoomLevel, dir: -1 | 1): Date {
  if (zoom === 0) return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  if (zoom >= 1 && zoom <= 4) return addDays(anchor, dir * 7 * weeksForZoom(zoom));
  if (zoom === 5) return addDays(anchor, dir * 3);
  return addDays(anchor, dir); // day
}
