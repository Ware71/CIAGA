import { describe, expect, it } from "vitest";
import { splitCumulativeHoles } from "@/lib/majors/cumulativeHoles";

/**
 * `holes_completed` is cumulative across the event. Turning it back into
 * "R2 thru 7" used to be `Math.floor(holes / 18)`, which mislabels every round
 * after a 9-hole leg.
 */
describe("splitCumulativeHoles", () => {
  const two18s = [18, 18];

  it("reports the round in progress", () => {
    const r = splitCumulativeHoles(25, two18s, 2);
    expect(r.completedRounds).toBe(1);
    expect(r.holesInRound).toBe(7); // R2 thru 7
  });

  it("reports a round boundary as fully complete, not as 0 into the next", () => {
    const r = splitCumulativeHoles(18, two18s, 2);
    expect(r.completedRounds).toBe(1);
    expect(r.holesInRound).toBe(0);
  });

  it("handles the whole event finished", () => {
    const r = splitCumulativeHoles(36, two18s, 2);
    expect(r.completedRounds).toBe(2);
    expect(r.holesInRound).toBe(0);
  });

  it("accounts for a 9-hole leg", () => {
    // R1 = 9 holes, R2 = 18. 16 holes played means R2 thru 7, not R1 thru 16.
    const r = splitCumulativeHoles(16, [9, 18], 2);
    expect(r.completedRounds).toBe(1);
    expect(r.holesInRound).toBe(7);
    expect(r.holesPerRound).toBe(18);
  });

  it("reports the current round's length, not a fixed 18", () => {
    // R1 = 18, R2 = 9. Four holes into R2.
    const r = splitCumulativeHoles(22, [18, 9], 2);
    expect(r.completedRounds).toBe(1);
    expect(r.holesInRound).toBe(4);
    expect(r.holesPerRound).toBe(9);
  });

  it("falls back to uniform 18s when the payload carries no round holes", () => {
    expect(splitCumulativeHoles(25, undefined, 2)).toEqual({
      completedRounds: 1,
      holesInRound: 7,
      holesPerRound: 18,
    });
    expect(splitCumulativeHoles(25, [], 2).completedRounds).toBe(1);
  });

  it("does not run off the end when a card exceeds the planned rounds", () => {
    const r = splitCumulativeHoles(40, two18s, 2);
    expect(r.completedRounds).toBe(2);
    expect(r.holesInRound).toBe(4);
    expect(Number.isFinite(r.holesPerRound)).toBe(true);
  });

  it("handles nothing played", () => {
    const r = splitCumulativeHoles(0, two18s, 2);
    expect(r.completedRounds).toBe(0);
    expect(r.holesInRound).toBe(0);
  });
});
