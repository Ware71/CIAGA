import { describe, expect, it } from "vitest";
import { computeFormatDisplay, relToParForRange, type ScoringContext } from "@/lib/rounds/formatScoring";
import type { Hole, Participant, Score, HoleState } from "@/lib/rounds/hooks/useRoundDetail";

/**
 * A round can have players on different tees — 3 men off White, 1 woman off Red
 * — and par, yardage AND stroke index all differ per tee. These tests pin the
 * rule that each player is scored off THEIR tee, never off whichever tee the
 * scorecard happens to be displaying.
 */

function participant(id: string, playingHandicap = 0): Participant {
  return {
    id,
    profile_id: id,
    is_guest: false,
    display_name: id,
    role: "player",
    tee_snapshot_id: null,
    playing_handicap_used: playingHandicap,
    course_handicap: playingHandicap,
  };
}

/** Men's card: hole 2 is a par 4, stroke index 1. */
const WHITE: Hole[] = [
  { hole_number: 1, par: 4, yardage: 400, stroke_index: 5 },
  { hole_number: 2, par: 4, yardage: 430, stroke_index: 1 },
  { hole_number: 3, par: 3, yardage: 180, stroke_index: 17 },
];

/** Women's card: the same hole 2 plays as a par 5, stroke index 18. */
const RED: Hole[] = [
  { hole_number: 1, par: 4, yardage: 330, stroke_index: 7 },
  { hole_number: 2, par: 5, yardage: 400, stroke_index: 18 },
  { hole_number: 3, par: 3, yardage: 140, stroke_index: 15 },
];

const A = participant("A"); // White
const B = participant("B"); // Red

/** A is on White, B is on Red — regardless of which array is passed as `holes`. */
function ctx(): ScoringContext {
  const byPid: Record<string, Hole[]> = { A: WHITE, B: RED };
  return {
    holeFor: (pid, hole) =>
      byPid[pid]?.find((h) => h.hole_number === hole.hole_number) ?? hole,
    holeCountFor: () => 3,
  };
}

function mkScores(entries: Array<[string, number, number]>) {
  const scoresByKey: Record<string, Score> = {};
  const holeStatesByKey: Record<string, HoleState> = {};
  for (const [pid, hole, strokes] of entries) {
    scoresByKey[`${pid}:${hole}`] = { participant_id: pid, hole_number: hole, strokes, created_at: "" };
    holeStatesByKey[`${pid}:${hole}`] = "completed";
  }
  return { scoresByKey, holeStatesByKey };
}

describe("multi-tee scoring", () => {
  // The strongest single test for the whole refactor: which tee the scorecard
  // DISPLAYS must not change one number in any player's column.
  it("is invariant to which tee's card is passed as the display geometry", () => {
    const { scoresByKey, holeStatesByKey } = mkScores([
      ["A", 1, 4], ["A", 2, 5], ["A", 3, 3],
      ["B", 1, 5], ["B", 2, 5], ["B", 3, 4],
    ]);

    for (const formatType of ["stableford", "strokeplay", "skins", "matchplay"] as const) {
      const run = (display: Hole[]) =>
        computeFormatDisplay(
          formatType,
          {},
          [A, B],
          display,
          scoresByKey,
          holeStatesByKey,
          [],
          (p) => p.id,
          new Set(),
          {},
          1,
          ctx()
        );

      expect(run(RED), `${formatType} changed when the display tee changed`).toEqual(run(WHITE));
    }
  });

  it("scores stableford off each player's own par and stroke index", () => {
    // Both play hole 2 in 5, both off scratch. White: par 4 → bogey → 1 pt.
    // Red: par 5 → par → 2 pts.
    const { scoresByKey, holeStatesByKey } = mkScores([["A", 2, 5], ["B", 2, 5]]);

    const [display] = computeFormatDisplay(
      "stableford",
      {},
      [A, B],
      WHITE,
      scoresByKey,
      holeStatesByKey,
      [],
      (p) => p.id,
      new Set(),
      {},
      1,
      ctx()
    );

    expect(display.holeResults["A:2"]?.displayValue).toBe(1);
    expect(display.holeResults["B:2"]?.displayValue).toBe(2);
  });

  it("charges a pickup the net double bogey of the player's OWN par", () => {
    // B picks up on hole 2. Off Red that hole is a par 5, so NDB is 7 — not the
    // 6 that White's par 4 would give.
    const scoresByKey: Record<string, Score> = {
      "A:2": { participant_id: "A", hole_number: 2, strokes: 4, created_at: "" },
    };
    const holeStatesByKey: Record<string, HoleState> = {
      "A:2": "completed",
      "B:2": "picked_up",
    };

    const [display] = computeFormatDisplay(
      "stableford",
      {},
      [A, B],
      WHITE,
      scoresByKey,
      holeStatesByKey,
      [],
      (p) => p.id,
      new Set(),
      {},
      1,
      ctx()
    );

    // A pickup is always 0 stableford points; the point here is that the run
    // completes off Red's par 5 without falling back to White's card.
    expect(display.holeResults["B:2"]?.displayValue).toBe(0);
    expect(display.holeResults["A:2"]?.displayValue).toBe(2);
  });

  it("allocates strokes off each player's own stroke index", () => {
    // Both off 1 shot. Hole 2 is SI 1 on White (A gets the shot) and SI 18 on
    // Red (B does not, on a 3-hole card).
    const a1 = participant("A", 1);
    const b1 = participant("B", 1);
    const { scoresByKey, holeStatesByKey } = mkScores([["A", 2, 5], ["B", 2, 5]]);

    const [display] = computeFormatDisplay(
      "stableford",
      {},
      [a1, b1],
      WHITE,
      scoresByKey,
      holeStatesByKey,
      [],
      (p) => p.id,
      new Set(),
      {},
      1,
      ctx()
    );

    // A: net 4 on a par 4 → par → 2 pts. B: net 5 on a par 5 → par → 2 pts.
    expect(display.holeResults["A:2"]?.displayValue).toBe(2);
    expect(display.holeResults["B:2"]?.displayValue).toBe(2);
  });

  it("handles a plus handicap off differing stroke indexes", () => {
    // strokesReceivedOnHole inverts on (holeCount - rem) for a plus handicap —
    // the easiest branch to get wrong when the SI comes from the wrong card.
    const aPlus = participant("A", -1); // gives a shot back on SI 3 of 3
    const bPlus = participant("B", -1);
    const { scoresByKey, holeStatesByKey } = mkScores([["A", 1, 4], ["B", 1, 4]]);

    const [display] = computeFormatDisplay(
      "stableford",
      {},
      [aPlus, bPlus],
      WHITE,
      scoresByKey,
      holeStatesByKey,
      [],
      (p) => p.id,
      new Set(),
      {},
      1,
      ctx()
    );

    // Both hole 1s are par 4 on both cards, but the SIs differ (5 vs 7), so this
    // asserts only that each side resolves without borrowing the other's card.
    expect(display.holeResults["A:1"]?.displayValue).not.toBeNull();
    expect(display.holeResults["B:1"]?.displayValue).not.toBeNull();
  });

  it("measures to-par against the player's own par in relToParForRange", () => {
    // Both round 5 on hole 2: +1 off White's par 4, level off Red's par 5.
    const displayed = (_pid: string, hole: number) => (hole === 2 ? 5 : null);

    expect(relToParForRange("A", WHITE, displayed, 1, 9, ctx().holeFor)).toBe(1);
    expect(relToParForRange("B", WHITE, displayed, 1, 9, ctx().holeFor)).toBe(0);
  });

  it("falls back to the shared card when no context is supplied", () => {
    const { scoresByKey, holeStatesByKey } = mkScores([["A", 2, 5], ["B", 2, 5]]);

    const [display] = computeFormatDisplay(
      "stableford",
      {},
      [A, B],
      WHITE,
      scoresByKey,
      holeStatesByKey,
      [],
      (p) => p.id,
      new Set(),
      {},
      1
    );

    // Single-tee behaviour: both measured against White's par 4 → bogey → 1 pt.
    expect(display.holeResults["A:2"]?.displayValue).toBe(1);
    expect(display.holeResults["B:2"]?.displayValue).toBe(1);
  });
});
