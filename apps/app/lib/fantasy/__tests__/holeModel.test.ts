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

describe("net-consistent anchor (thin/no-history profiles)", () => {
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
  const holes: SimHole[] = Array.from({ length: 18 }, (_, i) =>
    hole({ holeNumber: i + 1, strokeIndex: i + 1 })
  );
  // Σ holeMu over 18 holes = expected gross strokes over par; net-over-par = − PH.
  const grossOverPar = (ph: number, overrides: Partial<SimPlayerProfile> = {}) =>
    holes.reduce((s, h) => s + holeMu(profile({ ...noHistory, ...overrides }), h, ph), 0);

  it("a no-history player nets ~par + POPULATION_GAP regardless of handicap", () => {
    // SI tilts cancel over 18 holes → gross-over-par ≈ PH + gap → net ≈ gap (~4).
    expect(grossOverPar(0) - 0).toBeCloseTo(4, 0);
    expect(grossOverPar(18) - 18).toBeCloseTo(4, 0);
    expect(grossOverPar(54) - 54).toBeCloseTo(4, 0);
  });

  it("a big handicap is NOT a net favourite — same expected net as a low one", () => {
    const highNet = grossOverPar(54) - 54;
    const lowNet = grossOverPar(6) - 6;
    expect(Math.abs(highNet - lowNet)).toBeLessThan(0.5);
    // …and never modeled below par on net.
    expect(highNet).toBeGreaterThanOrEqual(0);
  });

  it("a full gross sample overrides the anchor (history drives the level, PH doesn't)", () => {
    const withHistory = profile({ avgGross: 92, par4AvgVsPar: 1.1, par3AvgVsPar: 1.0, par5AvgVsPar: 1.1, sampleSize: 12 });
    expect(holeMu(withHistory, hole(), 0)).toBeCloseTo(holeMu(withHistory, hole(), 54), 9);
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

describe("differential-driven holeMu / holeSigma", () => {
  const diffProfile = (overrides: Partial<SimPlayerProfile> = {}): SimPlayerProfile =>
    profile({
      avgDifferential: 10,
      differentialStddev: 3,
      differentialEffectiveN: 20,
      handicapIndex: 10,
      avgGross: 82,
      ...overrides,
    });
  const teeHole = (overrides: Partial<SimHole> = {}): SimHole =>
    hole({ rating: 72, slope: 113, parTotal: 72, holesInRound: 18, ...overrides });

  it("prices a harder-slope course higher for the same differential", () => {
    const p = diffProfile();
    expect(holeMu(p, teeHole({ slope: 145 }))).toBeGreaterThan(holeMu(p, teeHole({ slope: 113 })));
  });

  it("level tracks the differential — a lower differential prices lower", () => {
    const good = diffProfile({ avgDifferential: 2 });
    const poor = diffProfile({ avgDifferential: 18 });
    expect(holeMu(poor, teeHole())).toBeGreaterThan(holeMu(good, teeHole()));
  });

  it("works the differential back to gross on the event tee", () => {
    // Neutral shape (par-type avgs = overall) so the round total is just the
    // worked-back level: differential 0 on a rating-72/slope-113 tee ≈ par.
    const scratch = diffProfile({
      avgDifferential: 0,
      handicapIndex: 0,
      differentialEffectiveN: 30,
      avgGross: 72,
      par3AvgVsPar: 0,
      par4AvgVsPar: 0,
      par5AvgVsPar: 0,
      recentForm: 0,
    });
    const holes: SimHole[] = Array.from({ length: 18 }, (_, i) =>
      teeHole({ holeNumber: i + 1, strokeIndex: i + 1 })
    );
    const total = 72 + holes.reduce((s, h) => s + holeMu(scratch, h), 0);
    expect(total).toBeCloseTo(72, 1);
    // A +4 course rating raises the worked-back gross by ~4 at slope 113.
    const harderHoles = holes.map((h) => ({ ...h, rating: 76 }));
    const harderTotal = 72 + harderHoles.reduce((s, h) => s + holeMu(scratch, h), 0);
    expect(harderTotal - total).toBeCloseTo(4, 0);
  });

  it("falls back to the gross path when the tee has no rating/slope", () => {
    const withDiff = diffProfile();
    const noDiff = profile({ avgGross: 82, handicapIndex: 10 });
    // hole() carries no rating/slope → differential path is skipped, so a profile
    // with differential fields must price identically to one without.
    expect(holeMu(withDiff, hole())).toBeCloseTo(holeMu(noDiff, hole()), 9);
  });

  it("sigma scales with slope on the differential path", () => {
    const p = diffProfile();
    expect(holeSigma(p, teeHole({ slope: 145 }))).toBeGreaterThan(holeSigma(p, teeHole({ slope: 113 })));
  });

  it("sigma with no hole (legacy) still uses the observed round stddev", () => {
    const p = diffProfile({ scoreStddev: 4 });
    // No hole passed → legacy sigma path, unaffected by the differential fields.
    expect(holeSigma(p)).toBeCloseTo(holeSigma(profile({ scoreStddev: 4 })), 9);
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
