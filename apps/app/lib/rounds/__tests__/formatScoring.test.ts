import { describe, expect, it } from "vitest";
import { computeFormatDisplay } from "@/lib/rounds/formatScoring";
import type { Hole, Participant, Score, HoleState } from "@/lib/rounds/hooks/useRoundDetail";

function participant(id: string): Participant {
  return {
    id,
    profile_id: id,
    is_guest: false,
    display_name: id,
    role: "player",
    tee_snapshot_id: null,
    playing_handicap_used: 0,
  };
}

function holes(count: number): Hole[] {
  return Array.from({ length: count }, (_, i) => ({
    hole_number: i + 1,
    par: 4,
    yardage: 400,
    stroke_index: i + 1,
  }));
}

function runMatchplay(
  scores: Array<[string, number, number]>, // [participantId, hole_number, strokes]
  states: Array<[string, number, HoleState]>,
  startingHole = 1,
  holeCount = 9
) {
  const scoresByKey: Record<string, Score> = {};
  for (const [pid, hole, strokes] of scores) {
    scoresByKey[`${pid}:${hole}`] = { participant_id: pid, hole_number: hole, strokes, created_at: "" };
  }
  const holeStatesByKey: Record<string, HoleState> = {};
  for (const [pid, hole, status] of states) {
    holeStatesByKey[`${pid}:${hole}`] = status;
  }

  const result = computeFormatDisplay(
    "matchplay",
    {},
    [participant("A"), participant("B")],
    holes(holeCount),
    scoresByKey,
    holeStatesByKey,
    [],
    (p) => p.id,
    new Set(),
    {},
    startingHole
  );
  return result[0];
}

describe("computeMatchPlayPair — play order", () => {
  // A wins holes 5,6,7,8 outright; every other hole is halved.
  const scores: Array<[string, number, number]> = [
    ["A", 5, 3], ["B", 5, 5],
    ["A", 6, 3], ["B", 6, 5],
    ["A", 7, 3], ["B", 7, 5],
    ["A", 8, 3], ["B", 8, 5],
    ["A", 9, 4], ["B", 9, 4],
    ["A", 1, 4], ["B", 1, 4],
    ["A", 2, 4], ["B", 2, 4],
    ["A", 3, 4], ["B", 3, 4],
    ["A", 4, 4], ["B", 4, 4],
  ];
  const states: Array<[string, number, HoleState]> = [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((h): Array<[string, number, HoleState]> => [
      ["A", h, "completed"],
      ["B", h, "completed"],
    ]),
  ];

  it("declares the match decided at the correct chronological hole when the round didn't start on hole 1", () => {
    // True play order: 5,6,7,8,9,1,2,3,4. A is 4up after the 4-hole run (holes
    // 5-8), then holes 9 and 1 are halved — decided once the 3-hole cushion
    // can't be overturned (4up with 3 to play → "4&3").
    const result = runMatchplay(scores, states, 5, 9);
    const totalA = result.summaries.find((s) => s.participantId === "A")!.total;
    const totalB = result.summaries.find((s) => s.participantId === "B")!.total;
    expect(totalA).toBe("W 4&3");
    expect(totalB).toBe("L 4&3");
  });

  it("gives a different (wrong) result if computed in raw ascending order", () => {
    // Same data, but starting hole defaults to 1 — the bug this fix addresses.
    // The match is (wrongly) called decided 1 hole earlier, with a smaller margin.
    const result = runMatchplay(scores, states, 1, 9);
    const totalA = result.summaries.find((s) => s.participantId === "A")!.total;
    expect(totalA).toBe("W 3&2");
  });
});

describe("computeMatchPlayPair — pickups forfeit the hole", () => {
  it("a single pickup always loses the hole, even if the opponent's score is worse", () => {
    // B picks up. A's actual gross (10) is worse than B's WHS net-double-bogey
    // penalty (par 4 + 2 = 6) would be — under the old scoring-based approach B
    // would have won this hole. A pickup must forfeit regardless.
    const scores: Array<[string, number, number]> = [["A", 1, 10]];
    const states: Array<[string, number, HoleState]> = [
      ["A", 1, "completed"],
      ["B", 1, "picked_up"],
    ];
    const result = runMatchplay(scores, states, 1, 9);
    expect(result.holeResults["A:1"].displayValue).toBe("1UP");
    expect(result.holeResults["A:1"].cssHint).toBe("won");
    expect(result.holeResults["B:1"].cssHint).toBe("lost");
  });

  it("both players picking up on the same hole halves it", () => {
    const states: Array<[string, number, HoleState]> = [
      ["A", 1, "picked_up"],
      ["B", 1, "picked_up"],
    ];
    const result = runMatchplay([], states, 1, 9);
    expect(result.holeResults["A:1"].displayValue).toBe("AS");
    expect(result.holeResults["A:1"].cssHint).toBe("halved");
    expect(result.holeResults["B:1"].cssHint).toBe("halved");
  });
});
