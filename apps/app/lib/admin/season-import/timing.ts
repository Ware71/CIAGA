// Backdated timing for imported rounds, so score events / round timestamps /
// submissions read like the round was really played. Same maths as the
// invitational backfill (scripts/invitational-backfill/backfill.mjs):
//   hole h scored at teeTime + 12min + 13min*(h-1), staggered +25s per player slot;
//   round finished_at = last player's hole-18 time + 4 min.

/** Normalise an HH:MM string ("9:05" → "09:05"); null when not a valid time. */
export function normalizeTeeTime(t: string | null | undefined): string | null {
  const m = (t ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** Combine a YYYY-MM-DD date and optional HH:MM tee time into a Date (UTC). */
export function teeDateTime(dateStr: string, teeTime: string | null): Date {
  const hhmm = teeTime && /^\d{1,2}:\d{2}$/.test(teeTime) ? teeTime : "09:00";
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCHours(h, m, 0, 0);
  return d;
}

export function holeTime(teeTime: Date, holeNumber: number, playerIdx: number): Date {
  return new Date(teeTime.getTime() + (12 + 13 * (holeNumber - 1)) * 60_000 + playerIdx * 25_000);
}

export function roundFinishTime(teeTime: Date, lastPlayerIdx: number): Date {
  return new Date(holeTime(teeTime, 18, lastPlayerIdx).getTime() + 4 * 60_000);
}
