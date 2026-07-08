import { describe, expect, it } from "vitest";
import {
  buildHoleDistributions,
  discretizedDistribution,
  holeMu,
  holeSigma,
  strokesReceived,
} from "@/lib/fantasy/simulation/holeModel";
import type { SimHole, SimPlayerProfile } from "@/lib/fantasy/simulation/types";

function profile(overrides: Partial<SimPlayerProfile> = {}): SimPlayerProfile {
  return {
    profileId: "p",
    handicapIndex: 12,
    avgGross: 85,
    scoreStddev: 4,
    recentForm: 0,
    birdiesPerRound: 1,
    eaglesPerRound: 0.05,
    parsPerRound: 7,
    bogeysPerRound: 7,
    doublesPlusPerRound: 3,
    par3AvgVsPar: 0.7,
    par4AvgVsPar: 0.75,
    par5AvgVsPar: 0.7,
    holeSplits: null,
    sampleSize: 12,
    confidence: "high",
    ...overrides,
  };
}

function hole(overrides: Partial<SimHole> = {}): SimHole {
  return { holeNumber: 1, par: 4, yardage: 390, strokeIndex: 9, ...overrides };
}

describe("holeMu", () => {
  it("harder (low SI) holes play harder than easy (high SI) holes", () => {
    const p = profile();
    expect(holeMu(p, hole({ strokeIndex: 1 }))).toBeGreaterThan(holeMu(p, hole({ strokeIndex: 18 })));
  });

  it("uses length-band splits when sampled, falls back when thin", () => {
    const p = profile({
      holeSplits: {
        p4_long: { avgVsPar: 1.4, birdieRate: 0.01, bogeyPlusRate: 0.8, sample: 10 },
        p4_short: { avgVsPar: 0.2, birdieRate: 0.2, bogeyPlusRate: 0.2, sample: 2 }, // thin
      },
    });
    const long = holeMu(p, hole({ yardage: 440, strokeIndex: 9 }));
    const short = holeMu(p, hole({ yardage: 340, strokeIndex: 9 }));
    // Long bucket (sampled) pulls above the flat par-4 average…
    expect(long).toBeGreaterThan(0.75);
    // …thin short bucket is ignored → falls back to the flat average.
    expect(short).toBeCloseTo(holeMu(profile(), hole({ yardage: 340, strokeIndex: 9 })), 6);
  });

  it("recent form nudges the mean at 40% weight — never replaces it", () => {
    const improving = profile({ recentForm: -3.6 }); // 3.6 strokes better lately
    // drift = 0.4 × −3.6 / 18 = −0.08 per hole (was the full −0.2 pre-V2)
    expect(holeMu(improving, hole())).toBeCloseTo(holeMu(profile(), hole()) - 0.08, 6);
  });

  it("clamps extreme form swings to ±4 strokes before weighting", () => {
    const hot = profile({ recentForm: -12 });
    const clamped = profile({ recentForm: -4 });
    expect(holeMu(hot, hole())).toBeCloseTo(holeMu(clamped, hole()), 9);
  });
});

describe("handicap anchor (prior for thin profiles)", () => {
  const noHistory: Partial<SimPlayerProfile> = {
    avgGross: null,
    scoreStddev: null,
    recentForm: null,
    par3AvgVsPar: null,
    par4AvgVsPar: null,
    par5AvgVsPar: null,
    holeSplits: null,
    sampleSize: 0,
    confidence: "low",
  };

  it("with no history, expected gross tracks the handicap (HI + 3 over par)", () => {
    const holes: SimHole[] = Array.from({ length: 18 }, (_, i) =>
      hole({ holeNumber: i + 1, strokeIndex: i + 1 })
    );
    const total = (hi: number) =>
      holes.reduce((s, h) => s + holeMu(profile({ ...noHistory, handicapIndex: hi }), h), 0);
    // SI tilts cancel over 18 holes → total-vs-par ≈ HI + 3.
    expect(total(20)).toBeCloseTo(23, 1);
    expect(total(5)).toBeCloseTo(8, 1);
    // Ordering: high handicappers must NOT price like 88-shooters anymore.
    expect(total(25)).toBeGreaterThan(total(5) + 15);
  });

  it("a full sample silences the anchor entirely", () => {
    const lowHi = profile({ handicapIndex: 2, sampleSize: 12 });
    const highHi = profile({ handicapIndex: 28, sampleSize: 12 });
    expect(holeMu(lowHi, hole())).toBeCloseTo(holeMu(highHi, hole()), 9);
  });

  it("anchor influence decays monotonically as the sample grows", () => {
    // HI 25 anchor sits far above this player's observed scoring, so more
    // history → lower mu, monotonically.
    const mus = [0, 2, 5, 8, 10].map((n) =>
      holeMu(profile({ handicapIndex: 25, sampleSize: n }), hole())
    );
    for (let i = 1; i < mus.length; i++) expect(mus[i]).toBeLessThan(mus[i - 1]);
  });

  it("no history and no HI keeps the legacy flat fallback", () => {
    const p = profile({ ...noHistory, handicapIndex: null });
    // 0.9 base + SI tilt at SI 9 ≈ 0.9066
    expect(holeMu(p, hole())).toBeCloseTo(0.9 + ((9.5 - 9) / 9.5) * 0.12, 6);
  });

  it("sigma defaults follow handicap when no observed stddev exists", () => {
    const lowHi = profile({ ...noHistory, handicapIndex: 3 });
    const highHi = profile({ ...noHistory, handicapIndex: 28 });
    expect(holeSigma(highHi)).toBeGreaterThan(holeSigma(lowHi));
    // Observed stddev always wins over the default.
    const observed = profile({ ...noHistory, handicapIndex: 28, scoreStddev: 4 });
    expect(holeSigma(observed)).toBeLessThan(holeSigma(highHi));
  });
});

describe("discretizedDistribution", () => {
  it("sums to 1 and shifts mass with mu", () => {
    const easy = discretizedDistribution(0.2, 1);
    const hard = discretizedDistribution(1.4, 1);
    expect(easy.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 9);
    expect(hard.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 9);
    // Birdie-or-better mass shrinks as the hole plays harder.
    expect(easy[0] + easy[1]).toBeGreaterThan(hard[0] + hard[1]);
    // Double-plus mass grows.
    expect(hard[4] + hard[5] + hard[6]).toBeGreaterThan(easy[4] + easy[5] + easy[6]);
  });
});

describe("buildHoleDistributions birdie calibration", () => {
  const holes: SimHole[] = Array.from({ length: 18 }, (_, i) =>
    hole({ holeNumber: i + 1, strokeIndex: i + 1 })
  );

  function expectedBirdies(p: SimPlayerProfile): number {
    return buildHoleDistributions(p, holes).reduce((s, d) => s + d[0] + d[1], 0);
  }

  it("matches the player's observed birdie rate", () => {
    const few = expectedBirdies(profile({ birdiesPerRound: 0.5 }));
    const many = expectedBirdies(profile({ birdiesPerRound: 3 }));
    expect(many).toBeGreaterThan(few);
    // Calibration clips at 2× the raw model, so exact equality isn't
    // guaranteed — but the ordering and rough scale must hold.
    expect(few).toBeLessThan(1.5);
    expect(many).toBeGreaterThan(1.5);
  });
});

describe("strokesReceived", () => {
  it("allocates by stroke index and sums to the playing handicap", () => {
    for (const ph of [0, 5, 9, 18, 23, 36, -2]) {
      let total = 0;
      for (let si = 1; si <= 18; si++) total += strokesReceived(ph, si);
      expect(total).toBe(ph);
    }
  });

  it("gives strokes on hardest holes first, plus players give back easiest first", () => {
    expect(strokesReceived(9, 1)).toBe(1);
    expect(strokesReceived(9, 9)).toBe(1);
    expect(strokesReceived(9, 10)).toBe(0);
    expect(strokesReceived(23, 5)).toBe(2);
    expect(strokesReceived(23, 6)).toBe(1);
    expect(strokesReceived(-2, 18)).toBe(-1);
    expect(strokesReceived(-2, 17)).toBe(-1);
    expect(strokesReceived(-2, 16)).toBe(0);
  });
});
