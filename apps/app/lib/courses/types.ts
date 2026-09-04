// lib/courses/types.ts
// One shape for a course, whatever it came from.

/**
 * Where a hit came from. A single course can carry several — a course you have
 * favourited, played twice and are standing next to is one row with three.
 */
export type CourseSource = "favourite" | "played" | "nearby" | "worldwide";

/**
 * A course as the browser deals with it, normalised across four very different
 * origins: our own `courses` table, the played-history RPC, an Overpass nearby
 * lookup, and a Nominatim name search.
 *
 * Identity is awkward and worth stating plainly. `osmId` is the only key every
 * source shares — Overpass and Nominatim have nothing else — but a course only
 * gets a `courseId` once it has been resolved into our DB, which happens lazily
 * on first select. So dedupe on `osmId` where both sides have one, and fall
 * back to `courseId`.
 */
export type CourseHit = {
  /** Our uuid. Null until the course has been resolved into `courses`. */
  courseId: string | null;
  /** OSM id, e.g. "way/123456". The cross-source identity. */
  osmId: string | null;
  name: string;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  /** Metres from the viewer. Null when we have no position. */
  distanceM: number | null;
  /** Finished rounds the viewer has played here. */
  roundsPlayed: number | null;
  lastPlayedAt: string | null;
  isFavourite: boolean;
  sources: CourseSource[];
};

export type LatLng = { lat: number; lng: number };
