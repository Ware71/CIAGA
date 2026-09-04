import { describe, expect, it } from "vitest";
import { scoreDifferential } from "../scoreDifferential";
import { calcCourseHandicap } from "@/lib/rounds/setupHelpers";

describe("scoreDifferential", () => {
  it("computes the WHS differential to one decimal", () => {
    // (85 − 71.2) × 113 / 124 = 12.574… → 12.6
    expect(scoreDifferential({ ags: 85, courseRating: 71.2, slope: 124 })).toBe(12.6);
  });

  it("is exact when slope is 113 — the formula collapses to (AGS − CR)", () => {
    expect(scoreDifferential({ ags: 99, courseRating: 71.2, slope: 113 })).toBe(27.8);
    expect(scoreDifferential({ ags: 72, courseRating: 72, slope: 113 })).toBe(0);
  });

  it("returns a negative differential for a round under the rating", () => {
    expect(scoreDifferential({ ags: 68, courseRating: 72.4, slope: 113 })).toBe(-4.4);
  });

  /**
   * The reason this file exists. Math.round(x * 10) / 10 rounds a negative half
   * toward +∞ and would give -3.4 here; Postgres rounds away from zero.
   */
  it("rounds a negative half away from zero, as Postgres does", () => {
    // (68 − 71.45) × 113 / 113 = -3.45 → -3.5, not -3.4
    expect(scoreDifferential({ ags: 68, courseRating: 71.45, slope: 113 })).toBe(-3.5);
    expect(Math.round(-3.45 * 10) / 10).toBe(-3.4); // what the naive version gives
  });

  it("rounds a positive half away from zero too", () => {
    expect(scoreDifferential({ ags: 75, courseRating: 71.55, slope: 113 })).toBe(3.5);
  });

  it("does not drift on values that are inexact in floating point", () => {
    // 99 - 71.2 is 27.799999999999997 as a float; the answer must still be 27.8.
    expect(scoreDifferential({ ags: 99, courseRating: 71.2, slope: 113 })).toBe(27.8);
    expect(scoreDifferential({ ags: 90, courseRating: 70.3, slope: 113 })).toBe(19.7);
  });

  /**
   * Sampled from handicap_round_results on staging with the tee snapshot that
   * produced them, so this asserts against figures Postgres actually wrote
   * rather than against my own reading of the formula.
   */
  it.each([
    { ags: 101, courseRating: 72.2, slope: 134, stored: 24.3 },
    { ags: 88, courseRating: 70.4, slope: 131, stored: 15.2 },
    { ags: 90, courseRating: 72.2, slope: 134, stored: 15.0 },
    { ags: 77, courseRating: 68.6, slope: 128, stored: 7.4 },
    { ags: 81, courseRating: 70.4, slope: 131, stored: 9.1 },
    { ags: 102, courseRating: 71.3, slope: 130, stored: 26.7 },
    { ags: 88, courseRating: 69.6, slope: 122, stored: 17.0 },
    { ags: 86, courseRating: 69.7, slope: 126, stored: 14.6 },
    { ags: 118, courseRating: 71.6, slope: 140, stored: 37.5 },
    { ags: 86, courseRating: 72.2, slope: 134, stored: 11.6 },
    { ags: 85, courseRating: 66.2, slope: 114, stored: 18.6 },
  ])("matches the stored differential for AGS $ags / CR $courseRating / slope $slope", (c) => {
    expect(scoreDifferential(c)).toBe(c.stored);
  });

  it("refuses nonsense rather than returning a wrong number", () => {
    expect(scoreDifferential({ ags: 85, courseRating: 71.2, slope: 0 })).toBeNull();
    expect(scoreDifferential({ ags: 85, courseRating: 71.2, slope: -113 })).toBeNull();
    expect(scoreDifferential({ ags: Number.NaN, courseRating: 71.2, slope: 113 })).toBeNull();
  });
});

describe("calcCourseHandicap", () => {
  it("applies the WHS formula and rounds to a whole stroke", () => {
    // 12.4 × (124/113) + (71.2 − 72) = 13.606… − 0.8 = 12.8 → 13
    expect(calcCourseHandicap(12.4, 124, 71.2, 72)).toBe(13);
  });

  it("defaults to 18 holes when no hole count is given", () => {
    expect(calcCourseHandicap(20, 113, 72, 72)).toBe(calcCourseHandicap(20, 113, 72, 72, 18));
  });

  /**
   * Over 9 holes only the index halves. The rating and par passed in are already
   * 9-hole figures, so halving (rating − par) as well would double-count it.
   */
  it("halves the index over 9 holes, and nothing else", () => {
    // 18-hole: 20 × 1 + (36 − 36) = 20
    expect(calcCourseHandicap(20, 113, 36, 36, 18)).toBe(20);
    // 9-hole: 10 × 1 + (36 − 36) = 10
    expect(calcCourseHandicap(20, 113, 36, 36, 9)).toBe(10);
  });

  it("leaves the rating term at full weight over 9 holes", () => {
    // index halves to 10; (35.5 − 36) = -0.5 is applied once, not halved.
    // 10 + (-0.5) = 9.5 → 10 (Math.round takes .5 up)
    expect(calcCourseHandicap(20, 113, 35.5, 36, 9)).toBe(10);
    // A larger rating gap makes the non-halving visible: 10 + (-2) = 8
    expect(calcCourseHandicap(20, 113, 34, 36, 9)).toBe(8);
  });

  it("handles a plus handicap", () => {
    expect(calcCourseHandicap(-2.1, 113, 72, 72)).toBe(-2);
  });
});
