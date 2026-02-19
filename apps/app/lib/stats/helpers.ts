// Shared stat helper functions — extracted from stats pages to eliminate duplication.
// Re-exports round1 from timeModel.ts where it already exists.

export { round1 } from "./timeModel";

export function safeNum(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function parseYMD(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getTime();
}

export function monthsAgo(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.getTime();
}

export function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtSigned(n: number) {
  const s = Math.round(n * 10) / 10;
  if (s > 0) return `+${s}`;
  if (s === 0) return "E";
  return `${s}`;
}

export function mean(xs: number[]) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[]) {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  const v = mean(xs.map((x) => (x - m) * (x - m)))!;
  return Math.sqrt(v);
}

export function rms(a: number, b: number) {
  return Math.sqrt((a * a + b * b) / 2);
}

export function pct(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

export function normalizeTeeName(teeName: string | null) {
  const raw = (teeName ?? "").trim();
  if (!raw) return { base: "Tee", nine: "full" as const };

  if (/\(front 9\)/i.test(raw))
    return { base: raw.replace(/\s*\(front 9\)\s*/i, "").trim(), nine: "front" as const };
  if (/\(back 9\)/i.test(raw))
    return { base: raw.replace(/\s*\(back 9\)\s*/i, "").trim(), nine: "back" as const };
  return { base: raw, nine: "full" as const };
}

// White(front9) hole2 == White hole2
// White(back9) hole9 == White hole18
export function normalizeHoleNumberForNine(teeName: string | null, holeNumber: number | null) {
  const hn = holeNumber == null ? null : Math.round(holeNumber);
  if (!hn) return null;

  const { nine } = normalizeTeeName(teeName);

  if (nine === "front") return hn;
  if (nine === "back") {
    if (hn >= 1 && hn <= 9) return hn + 9;
    return hn;
  }
  return hn;
}

/** Normalize Supabase join payloads (object or array) to single item. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Split array into chunks of the given size. */
export function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
