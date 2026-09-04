import { describe, expect, it } from "vitest";
import {
  dedupe,
  formatDistance,
  identityKey,
  matchTier,
  mergeHits,
  normalize,
  rankHits,
  sourceTier,
} from "../rank";
import type { CourseHit, CourseSource } from "../types";

function hit(partial: Partial<CourseHit> & { name: string }): CourseHit {
  return {
    courseId: null,
    osmId: null,
    city: null,
    country: null,
    lat: null,
    lng: null,
    distanceM: null,
    roundsPlayed: null,
    lastPlayedAt: null,
    isFavourite: false,
    sources: [] as CourseSource[],
    ...partial,
  };
}

describe("normalize", () => {
  it("folds case, punctuation and spacing", () => {
    expect(normalize("St. Andrews — Old Course")).toBe("st andrews old course");
    expect(normalize("Rosapenna's Links")).toBe("rosapennas links");
  });
});

describe("matchTier", () => {
  it("ranks exact above prefix above word-start above contains", () => {
    expect(matchTier("Formby", "formby")).toBe(3);
    expect(matchTier("Formby Hall Golf Course", "formby")).toBe(2);
    expect(matchTier("Royal Formby", "formby")).toBe(1);
    expect(matchTier("Deformby Park", "formby")).toBe(0);
  });

  it("rejects a non-match rather than ranking it last", () => {
    expect(matchTier("Wentworth", "formby")).toBe(-1);
  });

  it("treats an empty query as neutral, not a rejection", () => {
    expect(matchTier("Wentworth", "")).toBe(0);
  });

  it("ignores punctuation differences", () => {
    expect(matchTier("St. Andrews", "st andrews")).toBe(3);
  });
});

describe("sourceTier", () => {
  it("takes the strongest provenance a hit carries", () => {
    expect(sourceTier(hit({ name: "A", sources: ["worldwide"] }))).toBe(0);
    expect(sourceTier(hit({ name: "A", sources: ["nearby"] }))).toBe(1);
    expect(sourceTier(hit({ name: "A", sources: ["nearby", "played"] }))).toBe(2);
    expect(sourceTier(hit({ name: "A", sources: ["worldwide", "favourite"] }))).toBe(3);
  });
});

describe("identityKey", () => {
  it("prefers the OSM id, the only key every source shares", () => {
    expect(identityKey(hit({ name: "A", osmId: "way/1", courseId: "uuid-1" }))).toBe("osm:way/1");
  });

  it("falls back to our uuid, then to name and position", () => {
    expect(identityKey(hit({ name: "A", courseId: "uuid-1" }))).toBe("db:uuid-1");
    expect(identityKey(hit({ name: "A", lat: 1, lng: 2 }))).toBe("n:a:1,2");
  });
});

describe("mergeHits / dedupe", () => {
  it("unions provenance and takes the best-informed field from each side", () => {
    const nearby = hit({
      name: "Formby Hall",
      osmId: "way/1",
      distanceM: 2100,
      sources: ["nearby"],
    });
    const played = hit({
      name: "Formby Hall Golf Resort",
      osmId: "way/1",
      courseId: "uuid-1",
      roundsPlayed: 12,
      lastPlayedAt: "2026-08-25T00:00:00Z",
      sources: ["played"],
    });

    const merged = mergeHits(nearby, played);
    expect(merged.sources.sort()).toEqual(["nearby", "played"]);
    expect(merged.distanceM).toBe(2100);
    expect(merged.roundsPlayed).toBe(12);
    expect(merged.courseId).toBe("uuid-1");
    // The DB-backed name wins — it has been through resolve()'s arbitration.
    expect(merged.name).toBe("Formby Hall Golf Resort");
  });

  it("keeps a favourite flag set on either side", () => {
    const a = hit({ name: "A", osmId: "way/1", isFavourite: true, sources: ["favourite"] });
    const b = hit({ name: "A", osmId: "way/1", sources: ["nearby"] });
    expect(mergeHits(b, a).isFavourite).toBe(true);
  });

  it("collapses the same course seen from three sources into one row", () => {
    const rows = dedupe([
      hit({ name: "Formby", osmId: "way/1", sources: ["nearby"], distanceM: 900 }),
      hit({ name: "Formby", osmId: "way/1", sources: ["favourite"], isFavourite: true }),
      hit({ name: "Formby", osmId: "way/1", sources: ["played"], roundsPlayed: 3 }),
      hit({ name: "Wentworth", osmId: "way/2", sources: ["nearby"] }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].sources.sort()).toEqual(["favourite", "nearby", "played"]);
    expect(rows[0].isFavourite).toBe(true);
    expect(rows[0].roundsPlayed).toBe(3);
  });
});

describe("rankHits", () => {
  it("puts a plain name match above a favourite that matches less well", () => {
    const ranked = rankHits(
      [
        hit({ name: "Royal Formby", sources: ["favourite"], isFavourite: true }),
        hit({ name: "Formby Hall", sources: ["worldwide"] }),
      ],
      "formby"
    );
    expect(ranked.map((h) => h.name)).toEqual(["Formby Hall", "Royal Formby"]);
  });

  it("breaks a match-quality tie on provenance", () => {
    const ranked = rankHits(
      [
        hit({ name: "Formby A", sources: ["worldwide"] }),
        hit({ name: "Formby B", sources: ["nearby"] }),
        hit({ name: "Formby C", sources: ["favourite"], isFavourite: true }),
        hit({ name: "Formby D", sources: ["played"], roundsPlayed: 2 }),
      ],
      "formby"
    );
    expect(ranked.map((h) => h.name)).toEqual([
      "Formby C",
      "Formby D",
      "Formby B",
      "Formby A",
    ]);
  });

  it("breaks a provenance tie on distance, nearest first", () => {
    const ranked = rankHits(
      [
        hit({ name: "Formby Far", sources: ["nearby"], distanceM: 9000 }),
        hit({ name: "Formby Near", sources: ["nearby"], distanceM: 800 }),
      ],
      "formby"
    );
    expect(ranked[0].name).toBe("Formby Near");
  });

  it("does not let an unknown distance outrank a known one", () => {
    const ranked = rankHits(
      [
        hit({ name: "Formby Unknown", sources: ["nearby"], distanceM: null }),
        hit({ name: "Formby Known", sources: ["nearby"], distanceM: 12000 }),
      ],
      "formby"
    );
    expect(ranked[0].name).toBe("Formby Known");
  });

  it("drops rows that do not match at all", () => {
    const ranked = rankHits(
      [hit({ name: "Wentworth", sources: ["nearby"] }), hit({ name: "Formby", sources: ["nearby"] })],
      "formby"
    );
    expect(ranked.map((h) => h.name)).toEqual(["Formby"]);
  });

  it("browses by provenance then distance when there is no query", () => {
    const ranked = rankHits(
      [
        hit({ name: "Zeta", sources: ["nearby"], distanceM: 500 }),
        hit({ name: "Alpha", sources: ["favourite"], isFavourite: true }),
        hit({ name: "Beta", sources: ["nearby"], distanceM: 200 }),
      ],
      ""
    );
    expect(ranked.map((h) => h.name)).toEqual(["Alpha", "Beta", "Zeta"]);
  });

  it("falls back to rounds played, then name", () => {
    const ranked = rankHits(
      [
        hit({ name: "B Course", sources: ["played"], roundsPlayed: 1 }),
        hit({ name: "A Course", sources: ["played"], roundsPlayed: 9 }),
      ],
      ""
    );
    expect(ranked.map((h) => h.name)).toEqual(["A Course", "B Course"]);
  });
});

describe("formatDistance", () => {
  it("uses metres under a kilometre and one decimal above", () => {
    expect(formatDistance(450)).toBe("450 m");
    expect(formatDistance(2100)).toBe("2.1 km");
  });

  it("renders nothing for an unknown or nonsense distance", () => {
    expect(formatDistance(null)).toBe("");
    expect(formatDistance(0)).toBe("");
    expect(formatDistance(Number.NaN)).toBe("");
  });
});
