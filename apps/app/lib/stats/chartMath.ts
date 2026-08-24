// lib/stats/chartMath.ts
//
// Date and geometry helpers for the stats charts.
//
// This file used to be `timeModel.ts` and carried a curve fitter:
// HI(t) = a·e^(−b·t) + c, fitted to the handicap history and read off as a
// projection. That model is gone — a Handicap Index is the mean of the lowest k
// of the last 20 score differentials, so it steps on posting dates and moves per
// ROUND rather than per day, and no smooth function of calendar time can
// represent it. See lib/stats/projection/simulate.ts for what replaced it, and
// docs/projections.md for why.
//
// What remains is the genuinely reusable part: calendar arithmetic that does not
// lie about timezones, rounding that matches Postgres, and axis helpers.

export type HiPoint = { date: string; hi: number };
export type SeriesT = { t: number; v: number };

// -----------------------------
// Dates
// -----------------------------

/** Elapsed days between two instants. Fractional across a DST boundary. */
export function daysBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/**
 * UTC YYYY-MM-DD.
 *
 * @deprecated Prefer {@link isoLocal}. This formats in UTC, so for a user behind
 * UTC it can return tomorrow's date and for one ahead of it (BST included, at
 * 00:30) yesterday's — which silently shifts "today" on a date-keyed chart.
 */
export function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Local-calendar YYYY-MM-DD — the one to use for anything a user reads as a date. */
export function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parse YYYY-MM-DD as LOCAL midnight. `new Date("2026-08-23")` parses as UTC
 * midnight, so mixing it with `new Date()` puts a whole-day error into any
 * `daysBetween` that spans the two.
 */
export function parseISODateLocal(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return new Date(s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Local midnight of the given instant. */
export function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Whole calendar days between two dates.
 *
 * `daysBetween` measures elapsed time, so a span crossing a DST boundary comes
 * back an hour short — 2024-01-01 → 2024-04-30 is 119.958 days, not 120. Every
 * date on these pages originates as a Postgres `date`, so calendar days are what
 * is meant and rounding away the DST hour is exact rather than approximate.
 */
export function calendarDaysBetween(a: Date, b: Date): number {
  return Math.round(daysBetween(startOfLocalDay(a), startOfLocalDay(b)));
}

export function fmtDM(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

// -----------------------------
// Numbers
// -----------------------------

/**
 * Round to one decimal place, halves AWAY FROM ZERO — matching Postgres
 * `round(numeric, 1)`, which produced every handicap value on screen.
 * `Math.round` rounds halves toward +∞ and disagrees on every negative tie, so a
 * plus handicapper's −1.25 would render as −1.2 here and −1.3 everywhere else.
 */
export function round1(n: number) {
  if (!Number.isFinite(n)) return n;
  return (Math.sign(n) * Math.round(Math.abs(n) * 10)) / 10 || 0;
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// -----------------------------
// Axes
// -----------------------------

/** A round-numbered tick interval covering `span` in roughly `targetTicks` steps. */
export function niceStep(span: number, targetTicks = 6) {
  const raw = span / Math.max(1, targetTicks);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}
