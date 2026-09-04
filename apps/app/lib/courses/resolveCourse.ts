import type { CourseHit } from "./types";

/**
 * Turn a hit into a row in our `courses` table, returning its uuid.
 *
 * Courses arrive from OSM and Nominatim carrying nothing but an `osm_id`, and
 * most of the app — rounds, favourites, tee boxes — needs a real uuid. Resolve
 * is what bridges that: get-or-create the row, then match it against
 * GolfCourseAPI to pull in tees and per-hole data.
 *
 * It is a write, so only call it when the user has actually chosen the course
 * (selected or starred it), never while merely listing results.
 *
 * A hit that already has a `courseId` short-circuits.
 */
export async function resolveCourseId(hit: CourseHit): Promise<string> {
  if (hit.courseId) return hit.courseId;
  if (!hit.osmId) throw new Error("That course can't be opened — no OSM id.");

  const res = await fetch("/api/courses/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      osm_id: hit.osmId,
      name: hit.name,
      lat: hit.lat,
      lng: hit.lng,
      city: hit.city,
      country: hit.country,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? data?.reason ?? "Couldn't open that course");
  if (!data?.course_id) throw new Error("Couldn't open that course");

  return data.course_id as string;
}
