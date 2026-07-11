import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/fantasy/simulation/engine";
import {
  BIRDIE_PRIOR_STRENGTH,
  birdiePriorMean,
  buildHoleDistributionsDetailed,
  holeMu,
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
      // The audit's failure signature: simulated ≈ 0.5 × pre-calibration mass.
      const { meta } = buildHoleDistributionsDetailed(f.profile, holes, Math.round(f.profile.handicapIndex!));
      expect(Math.abs(simBirdies - 0.5 * meta.birdie.preMass)).toBeGreaterThan(0.05);
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
