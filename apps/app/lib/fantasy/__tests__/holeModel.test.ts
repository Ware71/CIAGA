import { describe, expect, it } from "vitest";
import {
  BIRDIE_PRIOR_STRENGTH,
  EAGLE_PRIOR_STRENGTH,
  birdiePriorMean,
  buildHoleDistributions,
  buildHoleDistributionsDetailed,
  discretizedDistribution,
  eaglePriorMean,
  holeMu,
  holeSigma,
  OUTCOME_OFFSET,
  PAR_PRIOR_STRENGTH,
  parPriorMean,
  shrunkRate,
  strokesReceived,
} from "@/lib/fantasy/simulation/holeModel";
import type { SimHole, SimPlayerProfile } from "@/lib/fantasy/simulation/types";
import { shapeFor } from "@/lib/fantasy/__tests__/shapeFixture";

function profile(overrides: Partial<SimPlayerProfile> = {}): SimPlayerProfile {
  return {
    profileId: "p",
    handicapIndex: 12,
    avgGross: 85,
    scoreStddev: 4,
    recentForm: 0,
    birdiesPerRound: 1,
    eaglesPerRound: 0.05,
    // Derived from the level (see shapeFixture.ts): the four rates must
    // partition 18 holes AND reconcile with avgGross, or the par calibration
    // and the mean-preservation loop end up pulling against each other.
    ...shapeFor(overrides.avgGross ?? 85, overrides.birdiesPerRound ?? 1),
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

describe("buildHoleDistributions birdie/eagle calibration", () => {
  const holes: SimHole[] = Array.from({ length: 18 }, (_, i) =>
    hole({ holeNumber: i + 1, strokeIndex: i + 1 })
  );

  const birdieMass = (dists: number[][]) => dists.reduce((s, d) => s + d[0] + d[1], 0);
  const eagleMass = (dists: number[][]) => dists.reduce((s, d) => s + d[0], 0);
  const distMean = (d: number[]) => d.reduce((s, p, k) => s + (k - OUTCOME_OFFSET) * p, 0);

  it("Σ P(birdie-or-better) equals the shrunk target EXACTLY", () => {
    for (const rate of [0.15, 0.5, 3]) {
      const p = profile({ birdiesPerRound: rate });
      const { dists, meta } = buildHoleDistributionsDetailed(p, holes);
      const target = shrunkRate(rate, p.sampleSize, birdiePriorMean(p.handicapIndex!), BIRDIE_PRIOR_STRENGTH);
      expect(meta.birdie.targetRate).toBeCloseTo(target, 12);
      expect(birdieMass(dists)).toBeCloseTo(target, 9);
      expect(meta.birdie.capped).toBe(false);
    }
  });

  it("REGRESSION: a zero-birdie player converges to the shrunk target, not 0.5× the raw model", () => {
    // The old [0.5, 2] clip floor gave every zero-birdie player HALF the
    // (wildly overstated) normal-tail birdie mass — e.g. observed 0.00 →
    // simulated ~0.4/round.
    const p = profile({ birdiesPerRound: 0, sampleSize: 17, handicapIndex: 28, avgGross: 105 });
    const { dists, meta } = buildHoleDistributionsDetailed(p, holes);
    const target = shrunkRate(0, 17, birdiePriorMean(28), BIRDIE_PRIOR_STRENGTH);
    expect(birdieMass(dists)).toBeCloseTo(target, 9);
    // Pure-prior contribution only: (0·17 + λ0·8)/25 — a handful of birdies a
    // SEASON, nowhere near half the raw model mass.
    expect(birdieMass(dists)).toBeLessThan(0.1);
    expect(birdieMass(dists)).toBeLessThan(0.5 * meta.birdie.preMass);
  });

  it("every hole still sums to exactly 1 after both calibrations", () => {
    const p = profile({ birdiesPerRound: 0.2, eaglesPerRound: 0.02 });
    const { dists } = buildHoleDistributionsDetailed(p, holes);
    for (const d of dists) {
      expect(d.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
      for (const x of d) expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it("eagle calibration moves mass WITHIN birdie-or-better — birdie total untouched", () => {
    const base = profile({ birdiesPerRound: 1 });
    const noEagles = buildHoleDistributionsDetailed({ ...base, eaglesPerRound: 0 }, holes);
    const manyEagles = buildHoleDistributionsDetailed({ ...base, eaglesPerRound: 0.5 }, holes);
    expect(birdieMass(noEagles.dists)).toBeCloseTo(birdieMass(manyEagles.dists), 9);
    expect(eagleMass(manyEagles.dists)).toBeGreaterThan(eagleMass(noEagles.dists));
    const eagleTarget = shrunkRate(0.5, base.sampleSize, eaglePriorMean(base.handicapIndex!), EAGLE_PRIOR_STRENGTH);
    expect(eagleMass(manyEagles.dists)).toBeCloseTo(eagleTarget, 9);
  });

  it("mean preservation: post-calibration expected round score matches Σ holeMu", () => {
    const cases: SimPlayerProfile[] = [
      // High-handicap zero-birdie player — the live-bug shape.
      profile({ birdiesPerRound: 0, handicapIndex: 30, avgGross: 108, sampleSize: 20,
        par3AvgVsPar: 1.8, par4AvgVsPar: 2.0, par5AvgVsPar: 2.0 }),
      // Scratch-ish heavy downscale (raw model overstates birdies most here).
      profile({ birdiesPerRound: 1, handicapIndex: 0, avgGross: 73, sampleSize: 20,
        par3AvgVsPar: 0.05, par4AvgVsPar: 0.05, par5AvgVsPar: 0.05, scoreStddev: 3 }),
    ];
    for (const p of cases) {
      const { dists, meta } = buildHoleDistributionsDetailed(p, holes);
      const muSum = holes.reduce((s, h) => s + holeMu(p, h), 0);
      const eSum = dists.reduce((s, d) => s + distMean(d), 0);
      expect(Math.abs(eSum - muSum)).toBeLessThan(0.25);
      expect(meta.meanResidual).toBeLessThan(0.05);
    }
  });

  it("9-hole rounds calibrate to half the per-18 rate", () => {
    const nine = holes.slice(0, 9).map((h) => ({ ...h, holesInRound: 9 }));
    const p = profile({ birdiesPerRound: 1 });
    const { dists, meta } = buildHoleDistributionsDetailed(p, nine);
    expect(birdieMass(dists)).toBeCloseTo(meta.birdie.targetRate / 2, 9);
  });

  it("no observed rate → pure prior (never skips calibration)", () => {
    const p = profile({ birdiesPerRound: null, eaglesPerRound: null, sampleSize: 0, handicapIndex: 20 });
    const { dists, meta } = buildHoleDistributionsDetailed(p, holes);
    expect(meta.birdie.targetRate).toBeCloseTo(birdiePriorMean(20), 12);
    expect(birdieMass(dists)).toBeCloseTo(birdiePriorMean(20), 9);
  });

  it("prior handicap proxy falls back HI → differential − gap → PH", () => {
    const viaHi = buildHoleDistributionsDetailed(profile({ birdiesPerRound: null, handicapIndex: 16 }), holes);
    const viaDiff = buildHoleDistributionsDetailed(
      profile({ birdiesPerRound: null, handicapIndex: null, avgDifferential: 20, differentialStddev: 4, differentialEffectiveN: 10 }),
      holes
    );
    // avgDifferential 20 − POPULATION_GAP 4 = proxy 16, same prior as HI 16.
    expect(viaDiff.meta.birdie.priorMean).toBeCloseTo(viaHi.meta.birdie.priorMean, 12);
    const viaPh = buildHoleDistributionsDetailed(
      profile({ birdiesPerRound: null, handicapIndex: null }),
      holes,
      16
    );
    expect(viaPh.meta.birdie.priorMean).toBeCloseTo(viaHi.meta.birdie.priorMean, 12);
  });

  it("absurd targets stay valid: per-hole mass bounded, sums exact, target met", () => {
    // 12 observed birdies/round → target ≈ 9.2, against a player whose level
    // (par*AvgVsPar 0.7-0.75) says +13.5 a round. That is not a golfer, which is
    // the point: the contract under an impossible input is that the
    // distributions stay VALID, and that any shortfall is recorded rather than
    // silently absorbed.
    //
    // Since V6 the par bin competes for the same 18 holes, so the birdie factor
    // now pins at the 0.95-per-hole ceiling instead of the mean-preservation
    // loop finding its way out. `meta.birdie.capped` is what says so.
    const p = profile({ birdiesPerRound: 12, sampleSize: 20, handicapIndex: 0 });
    const { dists, meta } = buildHoleDistributionsDetailed(p, holes);
    if (meta.birdie.capped) {
      expect(birdieMass(dists)).toBeLessThan(meta.birdie.targetMass);
    } else {
      expect(birdieMass(dists)).toBeCloseTo(meta.birdie.targetMass, 6);
    }
    for (const d of dists) {
      expect(d[0] + d[1]).toBeLessThanOrEqual(0.95 + 1e-9);
      expect(d[2]).toBeLessThanOrEqual(0.95 * (1 - d[0] - d[1]) + 1e-9);
      expect(d.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
      for (const x of d) expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it("a REACHABLE high birdie target is still met exactly, not left at the cap", () => {
    // The original intent of the case above, with a level that matches the
    // shape: a player who really does make ~4 birdies a round shoots under par,
    // and the loop must land the target rather than pinning at the ceiling.
    const p = profile({
      birdiesPerRound: 4, sampleSize: 20, handicapIndex: 0,
      avgGross: 70, par3AvgVsPar: -0.1, par4AvgVsPar: -0.1, par5AvgVsPar: -0.1,
    });
    const { dists, meta } = buildHoleDistributionsDetailed(p, holes);
    expect(meta.birdie.capped).toBe(false);
    expect(birdieMass(dists)).toBeCloseTo(meta.birdie.targetMass, 6);
  });

  it("more observed birdies → more simulated birdies", () => {
    const few = birdieMass(buildHoleDistributions(profile({ birdiesPerRound: 0.5 }), holes));
    const many = birdieMass(buildHoleDistributions(profile({ birdiesPerRound: 3 }), holes));
    expect(many).toBeGreaterThan(few);
  });
});

/**
 * V6. `hole_score` prices bogey-or-worse as `1 − P(birdie+) − P(par)`, so the
 * whole hole book rides on these two masses being right. Before V6 only the
 * birdie side was calibrated and the par bin was the normal's leftovers, which
 * discarded ~60% of a real player's par mass.
 */
describe("buildHoleDistributions par calibration", () => {
  const holes: SimHole[] = Array.from({ length: 18 }, (_, i) =>
    hole({ holeNumber: i + 1, strokeIndex: i + 1 })
  );

  const parMass = (dists: number[][]) => dists.reduce((s, d) => s + d[2], 0);
  const birdieMass = (dists: number[][]) => dists.reduce((s, d) => s + d[0] + d[1], 0);
  const eagleMass = (dists: number[][]) => dists.reduce((s, d) => s + d[0], 0);

  it("hits the shrunk par target exactly, across the handicap range", () => {
    for (const [pars, hi] of [[10, 4], [7, 12], [3, 20], [0.5, 40]] as const) {
      const p = profile({ parsPerRound: pars, handicapIndex: hi, sampleSize: 20 });
      const { dists, meta } = buildHoleDistributionsDetailed(p, holes);
      const target = shrunkRate(pars, 20, parPriorMean(hi), PAR_PRIOR_STRENGTH);
      expect(meta.par.targetRate).toBeCloseTo(target, 12);
      expect(parMass(dists)).toBeCloseTo(target, 9);
      expect(meta.par.capped).toBe(false);
    }
  });

  it("bogey-or-worse is exactly the residual the hole book prices", () => {
    const p = profile({ parsPerRound: 3.23, birdiesPerRound: 0.45, handicapIndex: 20, sampleSize: 20 });
    const { dists } = buildHoleDistributionsDetailed(p, holes);
    const bogeyPlus = dists.reduce((s, d) => s + d.slice(3).reduce((a, x) => a + x, 0), 0);
    expect(bogeyPlus).toBeCloseTo(holes.length - birdieMass(dists) - parMass(dists), 9);
  });

  it("the par pass leaves birdie and eagle mass untouched — the ordering guarantee", () => {
    // Same player, wildly different par targets. The birdie block runs first and
    // the eagle move only shifts weight between k=0 and k=1, so neither may
    // budge by so much as a rounding error.
    const lots = buildHoleDistributionsDetailed(profile({ parsPerRound: 12, sampleSize: 20 }), holes);
    const few = buildHoleDistributionsDetailed(profile({ parsPerRound: 0.5, sampleSize: 20 }), holes);
    expect(parMass(lots.dists)).toBeGreaterThan(parMass(few.dists));
    expect(birdieMass(lots.dists)).toBeCloseTo(birdieMass(few.dists), 9);
    expect(eagleMass(lots.dists)).toBeCloseTo(eagleMass(few.dists), 9);
  });

  it("9-hole rounds calibrate to half the per-18 par rate", () => {
    const nine = holes.slice(0, 9).map((h) => ({ ...h, holesInRound: 9 }));
    const { dists, meta } = buildHoleDistributionsDetailed(profile({ parsPerRound: 7 }), nine);
    expect(parMass(dists)).toBeCloseTo(meta.par.targetRate / 2, 9);
  });

  it("no observed par rate → pure prior (never skips calibration)", () => {
    const p = profile({ parsPerRound: null, sampleSize: 0, handicapIndex: 20 });
    const { dists, meta } = buildHoleDistributionsDetailed(p, holes);
    expect(meta.par.targetRate).toBeCloseTo(parPriorMean(20), 12);
    expect(parMass(dists)).toBeCloseTo(parPriorMean(20), 9);
  });

  it("absurd par AND birdie targets together stay valid: bins bounded, sums exact", () => {
    // 12 birdies/round alongside 14 pars/round asks for more than 18 holes.
    // The per-hole cap has to hold or the k>=3 rescale drives bins negative.
    const p = profile({ birdiesPerRound: 12, parsPerRound: 14, sampleSize: 20, handicapIndex: 0 });
    const { dists } = buildHoleDistributionsDetailed(p, holes);
    for (const d of dists) {
      expect(d.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
      for (const x of d) expect(x).toBeGreaterThanOrEqual(0);
      expect(d[2]).toBeLessThanOrEqual(0.95 * (1 - d[0] - d[1]) + 1e-9);
    }
  });

  it("more observed pars → more simulated pars", () => {
    const few = parMass(buildHoleDistributions(profile({ parsPerRound: 1, sampleSize: 20 }), holes));
    const many = parMass(buildHoleDistributions(profile({ parsPerRound: 10, sampleSize: 20 }), holes));
    expect(many).toBeGreaterThan(few);
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
