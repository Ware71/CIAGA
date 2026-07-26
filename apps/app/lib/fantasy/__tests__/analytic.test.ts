import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/fantasy/simulation/engine";
import {
  analyticDistributions,
  pmfBandProbability,
  pmfUnderExactOver,
  pmfCountAtLeast,
  scoreSelectionProbability,
} from "@/lib/fantasy/markets/analytic";
import type { SimHole, SimPlayer, SimPlayerProfile } from "@/lib/fantasy/simulation/types";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];

function holes(): SimHole[] {
  return PARS.map((par, i) => ({
    holeNumber: i + 1,
    par,
    yardage: par === 3 ? 165 : par === 4 ? 390 : 520,
    strokeIndex: i + 1,
    round: 1,
    rating: 72,
    slope: 113,
    parTotal: 72,
    holesInRound: 18,
  }));
}

function profile(o: Partial<SimPlayerProfile> = {}): SimPlayerProfile {
  return {
    profileId: "p",
    handicapIndex: 12,
    avgGross: 85,
    scoreStddev: 4,
    avgDifferential: 13,
    differentialStddev: 5,
    differentialEffectiveN: 30,
    recentForm: 0,
    birdiesPerRound: 1.2,
    eaglesPerRound: 0.08,
    parsPerRound: 7,
    bogeysPerRound: 7,
    doublesPlusPerRound: 3,
    par3AvgVsPar: 0.7,
    par4AvgVsPar: 0.75,
    par5AvgVsPar: 0.7,
    holeSplits: null,
    sampleSize: 15,
    confidence: "high",
    ...o,
  };
}

function player(id: string): SimPlayer {
  return {
    profileId: id,
    displayName: id,
    profile: profile({ profileId: id }),
    playingHandicap: 12,
    completedHoles: {},
    roundComplete: false,
  };
}

const run = (seed: number) =>
  runSimulation({
    players: [player("a"), player("b")],
    holes: holes(),
    rankingBasis: "net",
    simulationCount: 40000,
    seed,
  });

describe("analytic single-player pricing", () => {
  it("gross pmf is a proper distribution; net is the gross shifted by PH×rounds", () => {
    const sim = run(1);
    const res = analyticDistributions(sim.players[sim.playerIndex["a"]].analytic!);
    expect(res.gross.probs.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 6);
    expect(res.net.min).toBe(res.gross.min - 12); // PH 12 over a single round
  });

  it("matches high-iteration Monte Carlo within MC error (band, total, birdies)", () => {
    const sim = run(1);
    const a = sim.players[sim.playerIndex["a"]];
    const res = analyticDistributions(a.analytic!);

    const mcFrac = (pred: (v: number) => boolean, arr: Int16Array | Int8Array) => {
      let n = 0;
      for (let i = 0; i < arr.length; i++) if (pred(arr[i])) n += 1;
      return n / sim.simulationCount;
    };

    const anaBand = pmfBandProbability(res.gross, 80, 83);
    expect(Math.abs(anaBand - mcFrac((v) => v >= 80 && v <= 83, a.grossTotals))).toBeLessThan(0.02);

    const anaUnder = pmfUnderExactOver(res.gross, 85).under;
    expect(Math.abs(anaUnder - mcFrac((v) => v < 85, a.grossTotals))).toBeLessThan(0.02);

    const anaBirdie = pmfCountAtLeast(res.birdies, 1);
    expect(Math.abs(anaBirdie - mcFrac((v) => v >= 1, a.birdieCounts))).toBeLessThan(0.02);
  });

  it("is seed-invariant — no Monte Carlo noise in the price", () => {
    const r1 = analyticDistributions(run(1).players[0].analytic!);
    const r2 = analyticDistributions(run(999).players[0].analytic!);
    expect(r1.gross.min).toBe(r2.gross.min);
    expect(r1.gross.probs.length).toBe(r2.gross.probs.length);
    for (let i = 0; i < r1.gross.probs.length; i++) {
      expect(r1.gross.probs[i]).toBeCloseTo(r2.gross.probs[i], 12);
    }
  });

  it("scoreSelectionProbability = cumulative of exact scores for band/total keys", () => {
    // scores 80..84 with these masses.
    const pmf = { min: 80, probs: [0.1, 0.2, 0.3, 0.25, 0.15] };
    // Band = sum of the exact scores it covers.
    expect(scoreSelectionProbability("score_band", "81_83", pmf)!).toBeCloseTo(0.2 + 0.3 + 0.25, 9);
    expect(scoreSelectionProbability("score_band", "le_81", pmf)!).toBeCloseTo(0.1 + 0.2, 9);
    expect(scoreSelectionProbability("score_band", "ge_83", pmf)!).toBeCloseTo(0.25 + 0.15, 9);
    // Totals: under/exactly/over a value.
    expect(scoreSelectionProbability("score_total", "u_82", pmf)!).toBeCloseTo(0.1 + 0.2, 9);
    expect(scoreSelectionProbability("score_total", "e_82", pmf)!).toBeCloseTo(0.3, 9);
    expect(scoreSelectionProbability("score_total", "o_82", pmf)!).toBeCloseTo(0.25 + 0.15, 9);
    // Not a drift market / bad key → null.
    expect(scoreSelectionProbability("birdies", "yes", pmf)).toBeNull();
    expect(scoreSelectionProbability("score_band", "nonsense", pmf)).toBeNull();
    // Consistency with the underlying helpers.
    expect(scoreSelectionProbability("score_band", "81_83", pmf)!).toBeCloseTo(
      pmfBandProbability(pmf, 81, 83),
      12
    );
    expect(scoreSelectionProbability("score_total", "o_82", pmf)!).toBeCloseTo(
      pmfUnderExactOver(pmf, 82).over,
      12
    );
  });

  it("accounts for already-played holes deterministically (fixed offset)", () => {
    // Bank an eagle on hole 4 (par 5, scored 3) and a bogey on hole 1.
    const p = player("a");
    p.completedHoles = { 104: 3, 101: 5 };
    const sim = runSimulation({
      players: [p, player("b")],
      holes: holes(),
      rankingBasis: "net",
      simulationCount: 20000,
      seed: 3,
    });
    const res = analyticDistributions(sim.players[sim.playerIndex["a"]].analytic!);
    // The banked eagle guarantees the eagle-or-better count is ≥ 1 with prob 1.
    expect(pmfCountAtLeast(res.eagles, 1)).toBeCloseTo(1, 9);
  });
});
