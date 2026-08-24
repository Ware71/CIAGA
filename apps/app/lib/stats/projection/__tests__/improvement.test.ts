import { describe, expect, it } from "vitest";
import {
  levelChangePerRound,
  projectLevel,
  sampleFloor,
  FLOOR_PRIOR_CENTRE,
  FLOOR_PRIOR_MIN,
  FLOOR_PRIOR_SD,
  CEILING_FRACTION_MAX,
  IMPROVEMENT_RATE,
} from "../improvement";

describe("levelChangePerRound", () => {
  it("improves in proportion to headroom", () => {
    const far = levelChangePerRound(30, 8);
    const near = levelChangePerRound(12, 8);
    expect(far).toBeLessThan(near); // both negative; far is more negative
    expect(far / near).toBeCloseTo((30 - 8) / (12 - 8), 6);
  });

  it("stops at the floor rather than crossing it", () => {
    expect(levelChangePerRound(8, 8)).toBe(0);
    expect(levelChangePerRound(5, 8)).toBe(0);
  });

  it("matches the fitted rate", () => {
    expect(levelChangePerRound(18, 8)).toBeCloseTo(-IMPROVEMENT_RATE * 10, 10);
  });

  it("is exactly linear in headroom, with nothing else in it", () => {
    // The experience factor exp(-n/N0) was removed: rounds-played correlates
    // -0.67 with level, so it was mostly re-explaining headroom; the
    // headroom-only residuals correlate with it at just 0.067; and within the
    // player with the most history the improvement rate per stroke of headroom
    // got FASTER, not slower, after 100+ rounds. See
    // scripts/test-experience-term.mjs.
    //
    // Exact linearity in headroom is what is left, and it is the property that
    // guarantees no mileage term can creep back in unnoticed.
    for (const headroom of [1, 2, 5, 10, 20, 40]) {
      expect(levelChangePerRound(8 + headroom, 8)).toBeCloseTo(
        -IMPROVEMENT_RATE * headroom,
        10
      );
    }
  });
});

describe("projectLevel", () => {
  it("approaches the floor without passing it", () => {
    const settled = projectLevel(25, 5000, 8);
    expect(settled).toBeGreaterThanOrEqual(8);
    expect(settled).toBeLessThan(25);
  });

  it("reproduces the measured direction: worse players improve more", () => {
    // The whole-career regression said every stroke worse a player starts, they
    // improve 0.67 more (r = -0.67).
    const worse = 30 - projectLevel(30, 200, 8);
    const better = 15 - projectLevel(15, 200, 8);
    expect(worse).toBeGreaterThan(better);
  });

  it("gives an experienced player at the same level the same trajectory", () => {
    // Two players at level 15 with the same ceiling get the same projection,
    // whatever their mileage. This is the property the previous model violated.
    expect(projectLevel(15, 130, 8)).toBe(projectLevel(15, 130, 8));
  });

  it("moves a mid-handicapper meaningfully over a few hundred rounds", () => {
    // 5 years at ~26 rounds a year.
    const after = projectLevel(15, 130, FLOOR_PRIOR_CENTRE);
    expect(after).toBeLessThan(13);
    expect(after).toBeGreaterThan(FLOOR_PRIOR_CENTRE);
  });
});

describe("sampleFloor", () => {
  // fractionDraw of +inf closes the whole gap, -inf closes none.
  const FULL = 8;
  const NONE = -8;

  it("closes the whole gap to the target when the fraction draw is high", () => {
    expect(sampleFloor(40, 0, FULL)).toBeCloseTo(
      40 - CEILING_FRACTION_MAX * (40 - FLOOR_PRIOR_CENTRE),
      4
    );
  });

  it("leaves the player where they are when the fraction draw is low", () => {
    // THE POINT OF THE TWO-DRAW PRIOR: some paths must say "you are already
    // about as good as you are going to get". The previous absolute prior gave
    // a level-23.5 player a five-in-a-million chance of that, and consequently
    // reported a 100% probability that a 20-handicap would reach 18.
    expect(sampleFloor(23.5, 0, NONE)).toBeCloseTo(23.5, 4);
  });

  it("puts meaningful probability on very little improvement, at any level", () => {
    // Sweep the fraction draw and count how often a player keeps most of their
    // current level. This must not be vanishing for a high handicapper.
    for (const level of [12, 18, 23.5, 35]) {
      let nearCeiling = 0;
      const N = 400;
      for (let i = 0; i < N; i++) {
        const z = -4 + (8 * i) / (N - 1);
        const floor = sampleFloor(level, 0, z);
        if (floor > level - 0.2 * (level - FLOOR_PRIOR_CENTRE)) nearCeiling++;
      }
      expect(nearCeiling / N, `level ${level}`).toBeGreaterThan(0.1);
    }
  });

  it("scales with the player rather than sitting at one absolute level", () => {
    // Same fraction draw, two players: each closes the same SHARE of their own
    // gap, not the same number of strokes.
    const a = sampleFloor(30, 0, 0);
    const b = sampleFloor(15, 0, 0);
    const shareA = (30 - a) / (30 - FLOOR_PRIOR_CENTRE);
    const shareB = (15 - b) / (15 - FLOOR_PRIOR_CENTRE);
    expect(shareA).toBeCloseTo(shareB, 6);
  });

  it("never sits above the player's current level", () => {
    for (const t of [-3, -1, 0, 1, 3]) {
      for (const f of [-3, 0, 3]) {
        expect(sampleFloor(6, t, f)).toBeLessThanOrEqual(6 + 1e-9);
      }
    }
  });

  it("is bounded below", () => {
    expect(sampleFloor(40, -100, FULL)).toBe(FLOOR_PRIOR_MIN);
  });

  it("admits floors low enough for scratch to be reachable", () => {
    // A differential level near 2.8 corresponds to a scratch index. If no
    // plausible draw could get there, the page could never answer "when will I
    // go scratch" with anything but zero — defeating the point of the feature.
    const scratchLevel = 2.8;
    // A mid-handicapper with a low target and a high fraction gets there.
    expect(sampleFloor(18, -1.5, FULL)).toBeLessThan(scratchLevel);
    // And so does a player already close, without needing an extreme draw.
    expect(sampleFloor(10.5, -1.5, 2)).toBeLessThan(scratchLevel + 2);
  });
});
