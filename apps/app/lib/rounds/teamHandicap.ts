import type { RoundFormatType } from "@/components/rounds/FormatSelector";

/**
 * WHS team handicaps for the single-ball formats.
 *
 * Only three formats get one. Scramble, greensomes and foursomes play a single
 * ball per team, so the team has a handicap of its own, weighted across its
 * members. The other four team formats (pairs stableford, team strokeplay, team
 * stableford, best ball) have everyone play their own ball off their own
 * allowance — the "team" only affects how scores combine, never the handicap.
 *
 * The weights come from the WHS published allowances table. This was inline in
 * app/api/rounds/start/route.ts and had no other caller; it's here so the
 * handicap calculator shows the same number the round will lock in, rather than
 * a second implementation drifting from it.
 */

export const SINGLE_BALL_FORMATS: RoundFormatType[] = ["scramble", "greensomes", "foursomes"];

export function isSingleBallFormat(format: RoundFormatType): boolean {
  return SINGLE_BALL_FORMATS.includes(format);
}

/** Human-readable weighting, for showing your working next to the number. */
export function teamHandicapDescription(format: RoundFormatType, teamSize: number): string {
  if (format === "scramble") {
    if (teamSize <= 2) return "35% lowest + 15% highest";
    if (teamSize === 3) return "30% lowest + 20% second + 10% highest";
    return "25% lowest + 20% second + 15% third + 10% highest";
  }
  if (format === "greensomes") return "60% lowest + 40% highest";
  if (format === "foursomes") return "50% of the combined handicaps";
  return "";
}

/**
 * The team's playing handicap from its members' COURSE handicaps.
 *
 * Members are sorted ascending — every weighting is expressed against "lowest
 * first", so the order is part of the formula rather than a presentation
 * choice. Returns null when the format has no team handicap or nobody on the
 * team has a handicap yet.
 *
 * Mirrors the computation in app/api/rounds/start/route.ts exactly, including
 * its treatment of a one-member team: a lone player in a greensomes or
 * foursomes pair is doubled up with themselves rather than dropped.
 */
export function calcTeamHandicap(
  format: RoundFormatType,
  courseHandicaps: (number | null | undefined)[]
): number | null {
  if (!isSingleBallFormat(format)) return null;

  const sorted = courseHandicaps
    .filter((h): h is number => typeof h === "number" && Number.isFinite(h))
    .sort((a, b) => a - b);

  if (sorted.length === 0) return null;

  if (format === "scramble") {
    if (sorted.length === 1) return Math.round(sorted[0] * 0.35);
    if (sorted.length === 2) return Math.round(sorted[0] * 0.35 + sorted[1] * 0.15);
    if (sorted.length === 3) {
      return Math.round(sorted[0] * 0.3 + sorted[1] * 0.2 + sorted[2] * 0.1);
    }
    return Math.round(
      sorted[0] * 0.25 + sorted[1] * 0.2 + sorted[2] * 0.15 + sorted[3] * 0.1
    );
  }

  if (format === "greensomes") {
    return Math.round(sorted[0] * 0.6 + (sorted[1] ?? sorted[0]) * 0.4);
  }

  // foursomes
  return Math.round((sorted[0] + (sorted[1] ?? sorted[0])) * 0.5);
}
