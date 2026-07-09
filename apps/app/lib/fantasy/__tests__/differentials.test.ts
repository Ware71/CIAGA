import { describe, expect, it } from "vitest";
import {
  recencyWeightedDifferentialStats,
  DIFFERENTIAL_HALFLIFE_ROUNDS,
} from "@/lib/fantasy/simulation/differentials";

describe("recencyWeightedDifferentialStats", () => {
  it("returns null for an empty history", () => {
    expect(recencyWeightedDifferentialStats([])).toBeNull();
  });

  it("a single differential is its own mean, no stddev yet", () => {
    const s = recencyWeightedDifferentialStats([12])!;
    expect(s.mean).toBeCloseTo(12, 9);
    expect(s.stddev).toBeNull();
    expect(s.effectiveN).toBeCloseTo(1, 9);
    expect(s.sampleSize).toBe(1);
  });

  it("weights recent rounds more heavily than old ones (newest-first)", () => {
    // Newest three at 5, oldest three at 25 → mean pulled below the flat 15.
    const s = recencyWeightedDifferentialStats([5, 5, 5, 25, 25, 25])!;
    expect(s.mean).toBeLessThan(15);
    expect(s.mean).toBeGreaterThan(5);
  });

  it("uses the FULL history with no 20-round cap", () => {
    const diffs = Array.from({ length: 200 }, (_, i) => 10 + (i % 3));
    const s = recencyWeightedDifferentialStats(diffs)!;
    expect(s.sampleSize).toBe(200);
    // Effective sample is bounded by the weighting even with 200 rounds.
    expect(s.effectiveN).toBeGreaterThan(1);
    expect(s.effectiveN).toBeLessThan(200);
  });

  it("computes a positive weighted stddev for varied differentials", () => {
    const s = recencyWeightedDifferentialStats([8, 12, 10, 14, 6])!;
    expect(s.stddev).not.toBeNull();
    expect(s.stddev!).toBeGreaterThan(0);
  });

  it("effective N converges to the half-life scale for a long flat history", () => {
    const diffs = Array.from({ length: 400 }, () => 10);
    const s = recencyWeightedDifferentialStats(diffs, DIFFERENTIAL_HALFLIFE_ROUNDS)!;
    // Geometric weights 0.5^(r/20): (Σw)²/Σw² → ≈ 57.7 as the history grows.
    expect(s.effectiveN).toBeGreaterThan(45);
    expect(s.effectiveN).toBeLessThan(70);
  });
});
