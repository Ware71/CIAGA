import { describe, it, expect } from "vitest";
import {
  tallyHolesPlayed,
  type HoleMeta,
  type PickedUpRow,
  type ScoreRow,
} from "@/lib/feed/helpers/holesPlayed";

const PID = "p1";

/** An 18-hole par-72 course, stroke index 1..18. */
function holes(count = 18): Map<number, HoleMeta> {
  const map = new Map<number, HoleMeta>();
  for (let i = 1; i <= count; i++) map.set(i, { par: 4, stroke_index: i });
  return map;
}

/** Numeric score rows for holes 1..n. */
function scored(from: number, to: number, strokes = 4): ScoreRow[] {
  const rows: ScoreRow[] = [];
  for (let i = from; i <= to; i++) rows.push({ participant_id: PID, hole_number: i, strokes });
  return rows;
}

/** What markPickedUp / clearScoreEvent actually write: a NULL-strokes row. */
function nullScored(holeNumbers: number[]): ScoreRow[] {
  return holeNumbers.map((h) => ({ participant_id: PID, hole_number: h, strokes: null }));
}

function pickedUp(holeNumbers: number[]): PickedUpRow[] {
  return holeNumbers.map((h) => ({ participant_id: PID, hole_number: h }));
}

describe("tallyHolesPlayed", () => {
  it("counts a plain 18-hole round as 18", () => {
    const { holesPlayedByParticipantId, grossByParticipantId } = tallyHolesPlayed({
      scores: scored(1, 18),
      pickedUp: [],
      holeByNumber: holes(),
    });

    expect(holesPlayedByParticipantId.get(PID)?.size).toBe(18);
    expect(grossByParticipantId.get(PID)).toBe(72);
  });

  it("counts a picked-up hole ONCE, not twice — the 'Thru 21' regression", () => {
    // 15 scored holes + 3 pick-ups. Each pick-up leaves a NULL-strokes row in
    // round_current_scores AND a 'picked_up' hole state, so both passes see it.
    const { holesPlayedByParticipantId } = tallyHolesPlayed({
      scores: [...scored(1, 15), ...nullScored([16, 17, 18])],
      pickedUp: pickedUp([16, 17, 18]),
      holeByNumber: holes(),
      courseHandicapByParticipantId: new Map([[PID, 0]]),
    });

    expect(holesPlayedByParticipantId.get(PID)?.size).toBe(18);
  });

  it("still credits the pick-up NDB penalty to gross", () => {
    const { grossByParticipantId } = tallyHolesPlayed({
      scores: [...scored(1, 15), ...nullScored([16, 17, 18])],
      pickedUp: pickedUp([16, 17, 18]),
      holeByNumber: holes(),
      courseHandicapByParticipantId: new Map([[PID, 0]]),
    });

    // 15 x 4 = 60, plus three net double bogeys (par 4 + 2, no strokes received).
    expect(grossByParticipantId.get(PID)).toBe(60 + 3 * 6);
  });

  it("does not count a hole whose score was cleared", () => {
    // clearScoreEvent writes the same NULL-strokes row but leaves the hole
    // 'not_started', so it never appears in the picked-up set.
    const { holesPlayedByParticipantId, grossByParticipantId } = tallyHolesPlayed({
      scores: [...scored(1, 17), ...nullScored([18])],
      pickedUp: [],
      holeByNumber: holes(),
    });

    expect(holesPlayedByParticipantId.get(PID)?.size).toBe(17);
    expect(grossByParticipantId.get(PID)).toBe(68);
  });

  it("counts a hole once when a pick-up state coexists with a numeric score", () => {
    // markPickedUp commits the state first; if clearing the score then fails, the
    // hole carries both. It is still one hole, and the real score wins.
    const { holesPlayedByParticipantId, grossByParticipantId } = tallyHolesPlayed({
      scores: scored(1, 18),
      pickedUp: pickedUp([18]),
      holeByNumber: holes(),
      courseHandicapByParticipantId: new Map([[PID, 0]]),
    });

    expect(holesPlayedByParticipantId.get(PID)?.size).toBe(18);
    expect(grossByParticipantId.get(PID)).toBe(72);
  });

  it("keeps participants independent", () => {
    const { holesPlayedByParticipantId } = tallyHolesPlayed({
      scores: [
        ...scored(1, 18),
        { participant_id: "p2", hole_number: 1, strokes: 5 },
        { participant_id: "p2", hole_number: 2, strokes: null },
      ],
      pickedUp: [{ participant_id: "p2", hole_number: 2 }],
      holeByNumber: holes(),
      courseHandicapByParticipantId: new Map([["p2", 0]]),
    });

    expect(holesPlayedByParticipantId.get(PID)?.size).toBe(18);
    expect(holesPlayedByParticipantId.get("p2")?.size).toBe(2);
  });

  it("handles a 9-hole round without inflating to 18", () => {
    const { holesPlayedByParticipantId } = tallyHolesPlayed({
      scores: [...scored(1, 8), ...nullScored([9])],
      pickedUp: pickedUp([9]),
      holeByNumber: holes(9),
      courseHandicapByParticipantId: new Map([[PID, 0]]),
    });

    expect(holesPlayedByParticipantId.get(PID)?.size).toBe(9);
  });

  it("ignores a pick-up on a hole with no snapshot meta", () => {
    const { holesPlayedByParticipantId } = tallyHolesPlayed({
      scores: scored(1, 18),
      pickedUp: pickedUp([19]),
      holeByNumber: holes(),
    });

    expect(holesPlayedByParticipantId.get(PID)?.size).toBe(18);
  });

  it("reports nothing for a participant with no scores", () => {
    const { holesPlayedByParticipantId } = tallyHolesPlayed({
      scores: [],
      pickedUp: [],
      holeByNumber: holes(),
    });

    expect(holesPlayedByParticipantId.get(PID)?.size ?? null).toBeNull();
  });
});
