import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/fantasy/simulation/engine";
import {
  BIRDIE_PRIOR_STRENGTH,
  birdiePriorMean,
  buildHoleDistributionsDetailed,
  holeMu,
  PAR_PRIOR_STRENGTH,
  parPriorMean,
  shrunkRate,
} from "@/lib/fantasy/simulation/holeModel";
import type { SimHole, SimPlayer, SimPlayerProfile } from "@/lib/fantasy/simulation/types";

/**
 * End-to-end calibration regression on a REAL field (staging profiles from
 * the 2026-07 audit). Under the old [0.5, 2]-clipped calibration every one of
 * these players simulated at exactly 0.5 × the raw normal-tail birdie mass —
 * e.g. p6 (0.15 observed birdies/round) simulated ~0.63, and the zero-birdie
 * players ~0.35–0.42. The fix must land each player on their shrunk target.
 */

type Fixture = { id: string; obsBirdies: number; profile: SimPlayerProfile };

const field: Fixture[] = [
  // handicap_index, differentials, shape — verbatim from fantasy_player_profiles.
  fixture("p1", { handicapIndex: 45.2, avgDifferential: 51.93, differentialStddev: 7.23, differentialEffectiveN: 22.71, avgGross: 138, scoreStddev: 10.2, recentForm: 1, birdiesPerRound: 0, par3AvgVsPar: 2.833, par4AvgVsPar: 3.757, par5AvgVsPar: 4.289, sampleSize: 8, confidence: "medium" }),
  fixture("p2", { handicapIndex: 7.8, avgDifferential: 12.14, differentialStddev: 3.83, differentialEffectiveN: 57.69, avgGross: 85.7, scoreStddev: 4.24, recentForm: 0.5, birdiesPerRound: 0.8, par3AvgVsPar: 0.782, par4AvgVsPar: 0.83, par5AvgVsPar: 0.532, sampleSize: 20, confidence: "medium" }),
  fixture("p3", { handicapIndex: 48.3, avgDifferential: 57.4, differentialStddev: 10.05, differentialEffectiveN: 16.53, avgGross: 131.44, scoreStddev: 6.82, recentForm: 1.84, birdiesPerRound: 0.06, par3AvgVsPar: 2.85, par4AvgVsPar: 3.465, par5AvgVsPar: 3.469, sampleSize: 17, confidence: "medium" }),
  fixture("p4", { handicapIndex: 54, avgDifferential: 76.83, differentialStddev: 8.5, differentialEffectiveN: 3.99, avgGross: 160, scoreStddev: 15.68, recentForm: null, birdiesPerRound: 0, par3AvgVsPar: 3.5, par4AvgVsPar: 5.385, par5AvgVsPar: 5.5, sampleSize: 4, confidence: "low" }),
  fixture("p5", { handicapIndex: 31.8, avgDifferential: 37.23, differentialStddev: 5.48, differentialEffectiveN: 35.88, avgGross: 114.09, scoreStddev: 6.76, recentForm: -6.22, birdiesPerRound: 0.1, par3AvgVsPar: 1.783, par4AvgVsPar: 2.512, par5AvgVsPar: 2.582, sampleSize: 20, confidence: "medium" }),
  fixture("p6", { handicapIndex: 23.2, avgDifferential: 27.86, differentialStddev: 4.94, differentialEffectiveN: 57.49, avgGross: 105.09, scoreStddev: 6.62, recentForm: 1.31, birdiesPerRound: 0.15, par3AvgVsPar: 1.463, par4AvgVsPar: 2.024, par5AvgVsPar: 1.661, sampleSize: 20, confidence: "medium" }),
];

function fixture(id: string, p: Partial<SimPlayerProfile>): Fixture {
  return {
    id,
    obsBirdies: p.birdiesPerRound ?? 0,
    profile: {
      profileId: id,
      eaglesPerRound: 0,
      parsPerRound: null,
      bogeysPerRound: null,
      doublesPlusPerRound: null,
      holeSplits: null,
      handicapIndex: null,
      avgGross: null,
      scoreStddev: null,
      recentForm: null,
      birdiesPerRound: null,
      par3AvgVsPar: null,
      par4AvgVsPar: null,
      par5AvgVsPar: null,
      sampleSize: 0,
      confidence: "low",
      ...p,
    },
  };
}

const holes: SimHole[] = Array.from({ length: 18 }, (_, i) => ({
  holeNumber: i + 1,
  par: [4, 4, 3, 5][i % 4],
  yardage: [380, 410, 165, 520][i % 4],
  strokeIndex: i + 1,
  round: 1,
  rating: 72,
  slope: 113,
  parTotal: 72,
  holesInRound: 18,
}));

const players: SimPlayer[] = field.map((f) => ({
  profileId: f.id,
  displayName: f.id,
  profile: f.profile,
  playingHandicap: Math.round(f.profile.handicapIndex ?? 0),
  completedHoles: {},
  roundComplete: false,
}));

const sim = runSimulation({ players, holes, rankingBasis: "net", simulationCount: 10_000, seed: 42 });

describe("live-field calibration regression", () => {
  it("every player's simulated birdie rate lands on the shrunk target, not 0.5× the raw model", () => {
    for (const f of field) {
      const target = shrunkRate(
        f.obsBirdies,
        f.profile.sampleSize,
        birdiePriorMean(f.profile.handicapIndex!),
        BIRDIE_PRIOR_STRENGTH
      );
      const res = sim.players[sim.playerIndex[f.id]];
      const simBirdies =
        res.birdieHistogram.reduce((s, count, i) => s + i * count, 0) / sim.simulationCount;
      // MC noise at 10k sims is well under 0.05.
      expect(Math.abs(simBirdies - target)).toBeLessThan(0.05);
      // The audit's failure signature was simulated ≈ 0.5 × pre-calibration
      // mass. Only a meaningful anti-signature where 0.5×preMass differs from
      // the target — the narrower per-hole σ (variance re-solve) shrinks preMass
      // enough that for some players 0.5×preMass ≈ target, and landing on target
      // (asserted above) already excludes the bug there.
      const { meta } = buildHoleDistributionsDetailed(f.profile, holes, Math.round(f.profile.handicapIndex!));
      const halfPre = 0.5 * meta.birdie.preMass;
      if (Math.abs(target - halfPre) > 0.05) {
        expect(Math.abs(simBirdies - halfPre)).toBeGreaterThan(0.05);
      }
    }
  });

  it("zero/low-birdie players no longer simulate a birdie every ~2.5 rounds", () => {
    for (const id of ["p1", "p3", "p4", "p5", "p6"]) {
      const res = sim.players[sim.playerIndex[id]];
      const simBirdies =
        res.birdieHistogram.reduce((s, count, i) => s + i * count, 0) / sim.simulationCount;
      expect(simBirdies).toBeLessThan(0.25); // old model: 0.35–0.63
    }
  });

  it("mean preservation holds through calibration: sim mean gross ≈ Σ holeMu + par", () => {
    for (const f of field) {
      const res = sim.players[sim.playerIndex[f.id]];
      const ph = Math.round(f.profile.handicapIndex!);
      const muSum = holes.reduce((s, h) => s + holeMu(f.profile, h, ph), 0);
      expect(Math.abs(res.meanGross - (72 + muSum))).toBeLessThan(0.4);
    }
  });

  it("P(1st incl ties) ≥ winProb for everyone", () => {
    for (const p of sim.players) {
      expect(p.positionHistogram[0]).toBeGreaterThanOrEqual(p.winProb - 1e-9);
    }
  });
});

/**
 * V6 REGRESSION — the one that would have caught the flat bogey book.
 *
 * These are the six PRODUCTION profiles (fantasy_player_profiles, Aug 2026)
 * with their real birdie/par/bogey/double+ rates. Before the par bin was
 * calibrated, only the birdie side landed: Ware's modelled P(par) was 0.072
 * against an observed 0.179, so P(bogey-or-worse) came out at 0.906 instead of
 * 0.796 and `hole_score` quoted a flat 1.01-1.14 on all 36 holes of The
 * International 2026 — indistinguishable, on a board, from "the same odds".
 */
describe("V6 par calibration on the real field", () => {
  type Real = {
    name: string; hi: number; gross: number; sd: number; n: number;
    birdies: number; pars: number; bogeys: number; doubles: number; ph: number;
  };
  const REAL: Real[] = [
    { name: "Jack Wilson", hi: 6.4, gross: 83.03, sd: 3.2, n: 20, birdies: 1.23, pars: 7.66, bogeys: 6.69, doubles: 2.42, ph: 7 },
    { name: "Ware", hi: 20, gross: 100.66, sd: 4.55, n: 20, birdies: 0.45, pars: 3.23, bogeys: 5.18, doubles: 9.14, ph: 22 },
    { name: "Linehan", hi: 31.8, gross: 115.28, sd: 5.5, n: 20, birdies: 0.16, pars: 1.16, bogeys: 3.81, doubles: 12.88, ph: 35 },
    { name: "Ciaran", hi: 43.9, gross: 134, sd: 6.5, n: 9, birdies: 0.11, pars: 0.78, bogeys: 2.56, doubles: 14.56, ph: 48 },
    { name: "Harper", hi: 47.5, gross: 130.28, sd: 6.5, n: 19, birdies: 0.05, pars: 0.37, bogeys: 1.93, doubles: 15.65, ph: 52 },
    { name: "Liaga", hi: 54, gross: 151, sd: 7, n: 6, birdies: 0, pars: 0, bogeys: 0.5, doubles: 17.5, ph: 59 },
  ];

  // A real tee: slope 130 / rating 71.5, so the differential path is live.
  const teeHoles: SimHole[] = holes.map((h) => ({
    ...h, rating: 71.5, slope: 130, parTotal: 72, holesInRound: 18,
  }));

  const profileOf = (r: Real): SimPlayerProfile => {
    const perHole = (r.gross - 72) / 18;
    return {
      profileId: r.name, handicapIndex: r.hi, avgGross: r.gross, scoreStddev: null,
      recentForm: 0, birdiesPerRound: r.birdies, eaglesPerRound: 0.02,
      parsPerRound: r.pars, bogeysPerRound: r.bogeys, doublesPlusPerRound: r.doubles,
      par3AvgVsPar: perHole, par4AvgVsPar: perHole, par5AvgVsPar: perHole,
      holeSplits: null, sampleSize: r.n, confidence: "medium",
      avgDifferential: (r.gross - 71.5) * (113 / 130),
      differentialStddev: r.sd, differentialEffectiveN: r.n,
    };
  };

  const massOf = (r: Real) => {
    const { dists } = buildHoleDistributionsDetailed(profileOf(r), teeHoles, r.ph);
    const n = teeHoles.length;
    return {
      birdie: dists.reduce((s, d) => s + d[0] + d[1], 0) / n,
      par: dists.reduce((s, d) => s + d[2], 0) / n,
      bogeyPlus: dists.reduce((s, d) => s + d.slice(3).reduce((a, x) => a + x, 0), 0) / n,
    };
  };

  // What the model actually promises is the SHRUNK rate, not the raw observed
  // one — Liaga's 0 pars over 6 rounds correctly shrink to ~0.13/round rather
  // than "never". Assert against the target, then separately show the target
  // stays close to the record for anyone with a real sample.
  const parTarget = (r: Real) =>
    shrunkRate(r.pars, r.n, parPriorMean(r.hi), PAR_PRIOR_STRENGTH) / 18;
  const birdieTarget = (r: Real) =>
    shrunkRate(r.birdies, r.n, birdiePriorMean(r.hi), BIRDIE_PRIOR_STRENGTH) / 18;

  it("every player's par mass hits the shrunk target exactly", () => {
    for (const r of REAL) {
      expect(massOf(r).par).toBeCloseTo(parTarget(r), 9);
    }
  });

  it("the shrunk par target stays within half a par per round of the record", () => {
    // Per ROUND, which is the unit the profile stores and the unit that means
    // something. Liaga's 0 pars over 6 rounds shrink to ~0.13/round — the prior
    // refusing to say "never" — and everyone with a fuller sample sits far
    // closer than that.
    for (const r of REAL) {
      expect(Math.abs(parTarget(r) * 18 - r.pars)).toBeLessThan(0.5);
    }
  });

  it("bogey-or-worse follows as the residual — Ware lands at ~0.80, not ~0.91", () => {
    for (const r of REAL) {
      expect(massOf(r).bogeyPlus).toBeCloseTo(1 - birdieTarget(r) - parTarget(r), 9);
    }
    // The reported symptom, pinned explicitly: the old model priced Ware's
    // bogey book at ~0.906/hole (a flat 1.01-1.14 on every hole).
    const ware = massOf(REAL.find((r) => r.name === "Ware")!);
    expect(ware.bogeyPlus).toBeGreaterThan(0.78);
    expect(ware.bogeyPlus).toBeLessThan(0.83);
  });

  it("the birdie side still lands — the par pass never disturbs it", () => {
    for (const r of REAL) {
      expect(massOf(r).birdie).toBeCloseTo(birdieTarget(r), 9);
    }
  });

  it("the three masses partition every hole", () => {
    for (const r of REAL) {
      const m = massOf(r);
      expect(m.birdie + m.par + m.bogeyPlus).toBeCloseTo(1, 9);
    }
  });

  it("round-total SD still rises with volatility across the real field", () => {
    const players: SimPlayer[] = REAL.map((r) => ({
      profileId: r.name, displayName: r.name, playingHandicap: r.ph,
      completedHoles: {}, roundComplete: false, profile: profileOf(r),
    }));
    const res = runSimulation({
      players, holes: teeHoles, rankingBasis: "net", simulationCount: 8000, seed: 7,
    });
    const sd = (xs: Int16Array) => {
      const a = Array.from(xs);
      const m = a.reduce((s, x) => s + x, 0) / a.length;
      return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
    };
    // Steadiest (Jack Wilson, σ_D 3.2) must stay clearly tighter than the most
    // volatile (Liaga, σ_D 7) — the ordering the score markets trade on.
    const tightest = sd(res.players[res.playerIndex["Jack Wilson"]].grossTotals);
    const widest = sd(res.players[res.playerIndex["Liaga"]].grossTotals);
    expect(tightest).toBeLessThan(widest);
    expect(tightest).toBeGreaterThan(3);
  });
});
