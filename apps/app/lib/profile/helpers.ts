// Profile-specific helper functions — extracted from ProfileScreen.tsx.

export function isFinishedStatus(s: string | null | undefined) {
  const v = (s ?? "").toLowerCase();
  return v === "finished" || v === "completed" || v === "ended";
}

export function parseDateMs(iso: string | null) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function shortDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export function monthKey(iso: string | null) {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
}

export function toNumberMaybe(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// WHS "used differentials" count table
export function usedDifferentialsCount(n: number) {
  if (n <= 0) return 0;
  if (n <= 2) return 0; // need 3+ to produce an index
  if (n <= 5) return 1; // 3–5 -> 1
  if (n <= 8) return 2; // 6–8 -> 2
  if (n <= 11) return 3; // 9–11 -> 3
  if (n <= 14) return 4; // 12–14 -> 4
  if (n <= 16) return 5; // 15–16 -> 5
  if (n <= 18) return 6; // 17–18 -> 6
  if (n === 19) return 7; // 19 -> 7
  return 8; // 20 -> 8
}
