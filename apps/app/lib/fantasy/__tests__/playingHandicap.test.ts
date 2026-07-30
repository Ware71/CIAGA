import { describe, expect, it } from "vitest";
import { resolvePlayingHandicapDetails, type EntryRow, type EventRow } from "@/lib/fantasy/odds";

/**
 * Playing handicap = COURSE handicap × allowance, matching round_participants
 * and therefore the leaderboard.
 *
 * The numbers here are the ones measured on staging during the CiaGA
 * Championship 2026 verification, where fantasy priced ~7-8 strokes too
 * generous because it multiplied the allowance straight onto the handicap
 * INDEX, skipping the slope/rating conversion.
 */

// Widney Manor, yellow tees.
const WIDNEY = { slope: 106, rating: 64.9, parTotal: 71, holesInRound: 18 };

function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "e1",
    name: "Test",
    group_id: "g1",
    course_id: "c1",
    event_date: "2026-08-02",
    majors_status: "upcoming",
    scoring_model: "net",
    scoring_basis: null,
    handicap_rules: { mode: "allowance_pct", allowance_pct: 95 },
    num_rounds: 1,
    entry_window_start: null,
    entry_window_end: null,
    group_season_id: null,
    competition_id: null,
    competition_event_template_id: null,
    event_year: 2026,
    ...overrides,
  } as EventRow;
}

function entry(profile_id: string, assigned_handicap_index: number | null): EntryRow {
  return {
    profile_id,
    entry_status: "entered",
    assigned_handicap_index,
    assigned_course_handicap: null,
    assigned_playing_handicap: null,
  };
}

describe("resolvePlayingHandicapDetails", () => {
  it("converts a handicap index through slope/rating before applying the allowance", () => {
    // CH = round(22.1 × 106/113 + (64.9 − 71)) = round(20.73 − 6.1) = 15
    // PH = round(15 × 0.95) = 14  — exactly what the round recorded.
    const out = resolvePlayingHandicapDetails(event(), [entry("ware", 22.1)], new Map(), WIDNEY);
    expect(out.get("ware")?.value).toBe(14);
  });

  it("matches the leaderboard across the whole measured field", () => {
    // handicap index → course handicap the round actually used.
    const field: [string, number, number][] = [
      ["ware", 22.1, 15],
      ["ciaran", 45.2, 36],
      ["harper", 48.3, 39],
    ];
    const out = resolvePlayingHandicapDetails(
      event(),
      field.map(([id, hi]) => entry(id, hi)),
      new Map(),
      WIDNEY
    );
    for (const [id, , courseHandicap] of field) {
      expect(out.get(id)?.value).toBe(Math.round(courseHandicap * 0.95));
    }
  });

  it("is nowhere near the old index-based answer", () => {
    // The regression this guards: 22.1 × 0.95 ≈ 21 rather than 14.
    const out = resolvePlayingHandicapDetails(event(), [entry("ware", 22.1)], new Map(), WIDNEY);
    expect(out.get("ware")!.value).toBeLessThan(Math.round(22.1 * 0.95) - 4);
  });

  it("halves the index on a 9-hole card, as the round SQL does", () => {
    const nine = { slope: 106, rating: 32.45, parTotal: 35, holesInRound: 9 };
    // CH = round((22.1/2) × 106/113 + (32.45 − 35)) = round(10.36 − 2.55) = 8
    const out = resolvePlayingHandicapDetails(event(), [entry("ware", 22.1)], new Map(), nine);
    expect(out.get("ware")?.value).toBe(Math.round(8 * 0.95));
  });

  it("falls back to treating the value as a course handicap with no tee data", () => {
    const out = resolvePlayingHandicapDetails(event(), [entry("ware", 20)], new Map(), null);
    expect(out.get("ware")?.value).toBe(Math.round(20 * 0.95));
  });

  it("prefers an explicitly assigned playing handicap over any conversion", () => {
    const e = { ...entry("ware", 22.1), assigned_playing_handicap: 12 };
    const out = resolvePlayingHandicapDetails(event(), [e], new Map(), WIDNEY);
    expect(out.get("ware")?.value).toBe(12);
    expect(out.get("ware")?.source).toBe("assigned_playing_handicap");
  });

  // The player's real handicap governs, not the one frozen at entry. Ware
  // entered off 24.6 and now plays off 22.1; the leaderboard settles on 22.1,
  // so the board must price on 22.1 too.
  it("uses the player's CURRENT index, not the entry snapshot", () => {
    const live = new Map<string, number | null>([["ware", 22.1]]);
    const out = resolvePlayingHandicapDetails(event(), [entry("ware", 24.6)], live, WIDNEY);
    expect(out.get("ware")?.source).toBe("profile_handicap_index_x_pct");
    expect(out.get("ware")?.value).toBe(14); // CH 15 x 95%
  });

  it("falls back to the entry snapshot only when there is no live index", () => {
    const out = resolvePlayingHandicapDetails(event(), [entry("ware", 24.6)], new Map(), WIDNEY);
    expect(out.get("ware")?.source).toBe("assigned_handicap_index_x_pct");
  });

  it("matches the leaderboard for the whole real field on live indexes", () => {
    // handicap index -> playing handicap the leaderboard settled on in pass 1.
    const field: [string, number, number][] = [
      ["ware", 22.1, 14],
      ["jack", 7.9, 1],
      ["ciaran", 45.2, 34],
      ["harper", 48.3, 37],
      ["linehan", 31.8, 23],
      ["liaga", 54.0, 43],
    ];
    const live = new Map<string, number | null>(field.map(([id, hi]) => [id, hi]));
    const out = resolvePlayingHandicapDetails(
      event(),
      // Entry snapshots deliberately wrong, to prove they are ignored.
      field.map(([id]) => entry(id, 99)),
      live,
      WIDNEY
    );
    for (const [id, , expected] of field) {
      expect(out.get(id)?.value, id).toBe(expected);
    }
  });

  it("returns zero for every player when the event has no handicap rules", () => {
    const out = resolvePlayingHandicapDetails(
      event({ handicap_rules: { mode: "none" } }),
      [entry("ware", 22.1)],
      new Map(),
      WIDNEY
    );
    expect(out.get("ware")?.value).toBe(0);
  });
});
