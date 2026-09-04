// lib/courses/rank.ts
import type { CourseHit, CourseSource } from "./types";

/**
 * Merging and ordering for the blended course list.
 *
 * The search bar has to serve four sources at once — the courses you starred,
 * the ones you have played, what is around you, and everything else on earth —
 * as a single flat list with no section headings. So the ordering has to carry
 * the information the headings would have: a favourite should surface above a
 * stranger, and a course you have played ten times above one you played once,
 * without any of that outranking a plainly better name match.
 *
 * Hence: match quality first, then provenance, then distance. Kept pure and
 * free of React so it can be unit-tested.
 */

/** Lowercase, strip punctuation, collapse whitespace. Mirrors the search route. */
export function normalize(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * How well a name answers the query. Higher is better; -1 means "not a match"
 * and the row should be dropped rather than ranked last.
 *
 *   3  exact           "formby golf club" for "formby golf club"
 *   2  starts with     "Formby Hall" for "formby"
 *   1  a word starts   "Royal Formby" for "formby"
 *   0  appears at all  "Deformby" for "formby" — rare, but not wrong
 */
export function matchTier(name: string, query: string): number {
  const n = normalize(name);
  const q = normalize(query);
  if (!q) return 0;
  if (n === q) return 3;
  if (n.startsWith(q)) return 2;
  if (n.split(" ").some((w) => w.startsWith(q))) return 1;
  if (n.includes(q)) return 0;
  return -1;
}

const SOURCE_RANK: Record<CourseSource, number> = {
  favourite: 3,
  played: 2,
  nearby: 1,
  worldwide: 0,
};

/** The strongest provenance a hit carries. */
export function sourceTier(hit: CourseHit): number {
  return hit.sources.reduce((best, s) => Math.max(best, SOURCE_RANK[s] ?? 0), 0);
}

/**
 * The identity two hits are the same course under.
 *
 * `osmId` first because it is the only key Overpass and Nominatim expose, so it
 * is the one that can unify a worldwide result with a course already in our DB.
 * A row with neither key is its own island, keyed on name and position.
 */
export function identityKey(hit: CourseHit): string {
  if (hit.osmId) return `osm:${hit.osmId}`;
  if (hit.courseId) return `db:${hit.courseId}`;
  return `n:${normalize(hit.name)}:${hit.lat ?? "?"},${hit.lng ?? "?"}`;
}

/**
 * Fold two views of the same course into one row.
 *
 * Neither side is authoritative on its own: the nearby sweep knows the distance,
 * the played RPC knows the round count, the favourites list knows the star, and
 * only the DB-backed ones know the uuid. Take the best-informed value for each
 * field and union the provenance.
 */
export function mergeHits(a: CourseHit, b: CourseHit): CourseHit {
  const sources = Array.from(new Set([...a.sources, ...b.sources]));
  return {
    courseId: a.courseId ?? b.courseId,
    osmId: a.osmId ?? b.osmId,
    // Prefer whichever name came with a uuid — that one has been through
    // resolve(), which arbitrates between the OSM and GolfCourseAPI names.
    name: (a.courseId ? a.name : b.courseId ? b.name : a.name) || b.name,
    city: a.city ?? b.city,
    country: a.country ?? b.country,
    lat: a.lat ?? b.lat,
    lng: a.lng ?? b.lng,
    distanceM: a.distanceM ?? b.distanceM,
    roundsPlayed: a.roundsPlayed ?? b.roundsPlayed,
    lastPlayedAt: a.lastPlayedAt ?? b.lastPlayedAt,
    isFavourite: a.isFavourite || b.isFavourite,
    sources,
  };
}

/** Collapse duplicates across sources, preserving first-seen order. */
export function dedupe(hits: CourseHit[]): CourseHit[] {
  const byKey = new Map<string, CourseHit>();
  for (const hit of hits) {
    const key = identityKey(hit);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeHits(existing, hit) : hit);
  }
  return Array.from(byKey.values());
}

/**
 * Rank a merged list against a query.
 *
 * With no query this is a browse: provenance, then distance, then name. With
 * one it is a search, and match quality leads — a favourite is worth a lot, but
 * never enough to put it above the course you actually typed the name of.
 */
export function rankHits(hits: CourseHit[], query: string): CourseHit[] {
  const q = normalize(query);
  const searching = q.length > 0;

  const scored = hits
    .map((hit) => ({ hit, tier: searching ? matchTier(hit.name, query) : 0 }))
    .filter((x) => x.tier >= 0);

  scored.sort((a, b) => {
    if (searching && b.tier !== a.tier) return b.tier - a.tier;

    const sa = sourceTier(a.hit);
    const sb = sourceTier(b.hit);
    if (sb !== sa) return sb - sa;

    // Distance only breaks ties between hits that both have one; a worldwide
    // result with no position shouldn't jump a nearby course by scoring 0.
    const da = a.hit.distanceM;
    const db = b.hit.distanceM;
    if (typeof da === "number" && typeof db === "number" && da !== db) return da - db;
    if (typeof da === "number" && typeof db !== "number") return -1;
    if (typeof db === "number" && typeof da !== "number") return 1;

    const ra = a.hit.roundsPlayed ?? 0;
    const rb = b.hit.roundsPlayed ?? 0;
    if (rb !== ra) return rb - ra;

    return a.hit.name.localeCompare(b.hit.name);
  });

  return scored.map((x) => x.hit);
}

/** "2.1 km" / "450 m" / "" when unknown. */
export function formatDistance(meters: number | null): string {
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
