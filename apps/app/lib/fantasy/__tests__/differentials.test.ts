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

  it("detrends spread: a pure improvement trajectory is not counted as volatility", () => {
    // Newest = 10, each older round +1 → a perfect line (older rounds worse).
    const diffs = Array.from({ length: 20 }, (_, i) => 10 + i);
    const s = recencyWeightedDifferentialStats(diffs)!;
    // Around the fitted line the residuals are ~0, so the noise stddev is tiny…
    expect(s.stddev!).toBeLessThan(0.1);
    // …even though the raw spread of the values (10..29) is large.
    expect(s.trendPerRound!).toBeCloseTo(1, 3); // +1 differential per round older
  });

  it("reports genuine noise, not the trend, for an improving-but-noisy player", () => {
    // Underlying trend +0.5/round older, with a fixed ±1 sawtooth of noise.
    const diffs = Array.from({ length: 24 }, (_, i) => 8 + 0.5 * i + (i % 2 === 0 ? 1 : -1));
    const s = recencyWeightedDifferentialStats(diffs)!;
    // Residual noise is ~1 stroke; without detrending the spread would be huge
    // (the values span 8 → ~20). Assert it captures the noise, not the trend.
    expect(s.stddev!).toBeGreaterThan(0.3);
    expect(s.stddev!).toBeLessThan(2.5);
    expect(s.trendPerRound!).toBeCloseTo(0.5, 1);
  });

  it("does not fit a trend below the minimum sample count (no zero-residual collapse)", () => {
    // 3 collinear points would fit a line exactly → 0 residual if detrended.
    const s = recencyWeightedDifferentialStats([10, 12, 14])!;
    expect(s.trendPerRound).toBeNull();
    expect(s.stddev!).toBeGreaterThan(0); // mean-based fallback keeps real spread
  });

  it("trend is null but stddev present for a flat multi-round history", () => {
    const s = recencyWeightedDifferentialStats([10, 10, 10, 10, 10, 10])!;
    // Flat line: slope ~0, residuals ~0 → tiny stddev, trend ~0 (not null here).
    expect(s.trendPerRound!).toBeCloseTo(0, 6);
    expect(s.stddev!).toBeLessThan(0.001);
  });
});

describe("levelNow and trendStdErr", () => {
  it("puts the level at the newest round, not at the weighted centroid", () => {
    // A perfectly linear improvement: newest = 10, each older round +0.5.
    const values = Array.from({ length: 30 }, (_, r) => 10 + 0.5 * r);
    const s = recencyWeightedDifferentialStats(values)!;

    expect(s.trendPerRound).toBeCloseTo(0.5, 8); // positive ⇒ improving
    expect(s.levelNow).toBeCloseTo(10, 6); // the newest round's value
    // `mean` sits at the weighted centroid, well above the current level — this
    // gap is exactly the bias a forward projection would inherit from it.
    expect(s.mean).toBeGreaterThan(s.levelNow + 3);
  });

  it("collapses to the mean when no trend is fitted", () => {
    const s = recencyWeightedDifferentialStats([12, 14, 16])!;
    expect(s.trendPerRound).toBeNull();
    expect(s.rMean).toBeNull();
    expect(s.levelNow).toBe(s.mean);
  });

  it("shrinks the trend standard error as the sample grows", () => {
    const line = (n: number) => Array.from({ length: n }, (_, r) => 10 + 0.2 * r + (r % 3) - 1);
    const small = recencyWeightedDifferentialStats(line(8))!;
    const large = recencyWeightedDifferentialStats(line(60))!;
    expect(small.trendStdErr).not.toBeNull();
    expect(large.trendStdErr!).toBeLessThan(small.trendStdErr!);
  });

  it("reports a standard error large enough to swamp a noise-only trend", () => {
    // Pure noise, no real trend: |slope| should not clear 1.5 standard errors.
    const noise = [3, -2, 1, 4, -3, 0, 2, -1, 3, -2, 1, 0, -1, 2, -3, 1];
    const s = recencyWeightedDifferentialStats(noise.map((v) => 15 + v))!;
    expect(Math.abs(s.trendPerRound!)).toBeLessThan(1.5 * s.trendStdErr!);
  });
});
