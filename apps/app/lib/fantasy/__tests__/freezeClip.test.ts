import { describe, expect, it } from "vitest";
import { clipToShownHoles } from "@/lib/fantasy/odds";
import { holeKey } from "@/lib/fantasy/simulation/types";

/**
 * The ceremony freeze hides a player's last N holes. `clipToShownHoles` is what
 * stops the fantasy model seeing them, so its contract is load-bearing: keep the
 * first `shown` holes IN PLAY ORDER, and nothing else.
 */
describe("clipToShownHoles", () => {
  const round1 = (strokesByHole: Record<number, number>) =>
    Object.fromEntries(
      Object.entries(strokesByHole).map(([hole, strokes]) => [holeKey(1, Number(hole)), strokes])
    );

  it("keeps the first N holes and drops the rest", () => {
    const all = round1({ 1: 5, 2: 4, 3: 6, 4: 5, 5: 4 });
    expect(clipToShownHoles(all, 3)).toEqual(round1({ 1: 5, 2: 4, 3: 6 }));
  });

  it("keeps a picked-up hole's net double bogey inside the window, and still clips at N", () => {
    // The D1 regression. Harper picked up on hole 1 (net double bogey 8) and
    // played 2..18. When the pick-up was MISSING from the map, "first 12
    // entries" reached holes 2..13 — leaking hole 13, which the leaderboard was
    // hiding. With the pick-up present the window is holes 1..12 again.
    const withPickup = round1({
      1: 8, 2: 6, 3: 5, 4: 8, 5: 6, 6: 7, 7: 8, 8: 5, 9: 6, 10: 6, 11: 8, 12: 6, 13: 6, 14: 7,
    });
    const kept = clipToShownHoles(withPickup, 12);
    const holes = Object.keys(kept).map((k) => Number(k) % 100).sort((a, b) => a - b);
    expect(holes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(kept[holeKey(1, 1)]).toBe(8); // the pick-up occupies its slot
    expect(kept[holeKey(1, 13)]).toBeUndefined(); // hidden hole stays hidden
    // Gross of the visible window matches what a spectator adds up.
    expect(Object.values(kept).reduce((a, b) => a + b, 0)).toBe(79);
  });

  it("clips more than one picked-up hole without drifting past the threshold", () => {
    // Two NULL-stroke holes used to leak TWO hidden holes.
    const twoPickups = round1({
      1: 9, 2: 7, 3: 6, 4: 9, 5: 9, 6: 7, 7: 9, 8: 5, 9: 5, 10: 7, 11: 9, 12: 7, 13: 7, 14: 7,
    });
    const holes = Object.keys(clipToShownHoles(twoPickups, 12))
      .map((k) => Number(k) % 100)
      .sort((a, b) => a - b);
    expect(holes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("orders by holeKey across rounds, not by hole number", () => {
    // holes_shown counts across the whole event: round 1 fills up before round 2
    // contributes anything.
    const twoRounds = {
      [holeKey(1, 17)]: 4,
      [holeKey(1, 18)]: 5,
      [holeKey(2, 1)]: 4,
      [holeKey(2, 2)]: 6,
    };
    expect(clipToShownHoles(twoRounds, 3)).toEqual({
      [holeKey(1, 17)]: 4,
      [holeKey(1, 18)]: 5,
      [holeKey(2, 1)]: 4,
    });
  });

  it("is a no-op when shown covers everything, and empty at or below zero", () => {
    const all = round1({ 1: 5, 2: 4 });
    expect(clipToShownHoles(all, 18)).toEqual(all);
    expect(clipToShownHoles(all, 0)).toEqual({});
    expect(clipToShownHoles(all, -1)).toEqual({});
  });

  it("does not mutate the input", () => {
    const all = round1({ 1: 5, 2: 4, 3: 6 });
    const snapshot = { ...all };
    clipToShownHoles(all, 1);
    expect(all).toEqual(snapshot);
  });
});
