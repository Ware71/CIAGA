import { describe, expect, it } from "vitest";
import { runSimulation, TOP_N_TARGETS } from "@/lib/fantasy/simulation/engine";
import type {
  SimHole,
  SimPlayer,
  SimPlayerProfile,
  SimulationInputs,
} from "@/lib/fantasy/simulation/types";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];

function makeHoles(): SimHole[] {
  return PARS.map((par, i) => ({
    holeNumber: i + 1,
    par,
    yardage: par === 3 ? 165 : par === 4 ? 390 : 520,
    strokeIndex: i + 1,
  }));
}

function makeProfile(overrides: Partial<SimPlayerProfile> = {}): SimPlayerProfile {
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

function makePlayer(
  profileId: string,
  overrides: Partial<SimPlayer> = {},
  profileOverrides: Partial<SimPlayerProfile> = {}
): SimPlayer {
  return {
    profileId,
    displayName: profileId,
    profile: makeProfile({ profileId, ...profileOverrides }),
    playingHandicap: 12,
    completedHoles: {},
    roundComplete: false,
    ...overrides,
  };
}

function baseInputs(players: SimPlayer[], overrides: Partial<SimulationInputs> = {}): SimulationInputs {
  return {
    players,
    holes: makeHoles(),
    rankingBasis: "net",
    simulationCount: 4000,
    seed: 42,
    ...overrides,
  };
}

describe("runSimulation", () => {
  it("winner probabilities sum to 1 (ties split evenly)", () => {
    const players = ["a", "b", "c", "d"].map((id) => makePlayer(id));
    const result = runSimulation(baseInputs(players));
    const total = result.players.reduce((s, p) => s + p.winProb, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("top-3 ⊆ top-5 ⊆ top-10 per player", () => {
    const players = Array.from({ length: 12 }, (_, i) =>
      makePlayer(`p${i}`, {}, { avgGross: 80 + i, par4AvgVsPar: 0.4 + i * 0.05 })
    );
    const result = runSimulation(baseInputs(players));
    for (const p of result.players) {
      expect(p.topNProb[3]).toBeLessThanOrEqual(p.topNProb[5] + 1e-9);
      expect(p.topNProb[5]).toBeLessThanOrEqual(p.topNProb[10] + 1e-9);
      for (const n of TOP_N_TARGETS) {
        expect(p.topNProb[n]).toBeGreaterThanOrEqual(0);
        expect(p.topNProb[n]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("the stronger player wins more often", () => {
    const strong = makePlayer("strong", {}, {
      avgGross: 76, par3AvgVsPar: 0.2, par4AvgVsPar: 0.25, par5AvgVsPar: 0.2, birdiesPerRound: 3,
    });
    const weak = makePlayer("weak", {}, {
      avgGross: 95, par3AvgVsPar: 1.3, par4AvgVsPar: 1.3, par5AvgVsPar: 1.3, birdiesPerRound: 0.2,
    });
    // Same playing handicap so the gap survives on the net basis too.
    const result = runSimulation(baseInputs([strong, weak]));
    const s = result.players[result.playerIndex["strong"]];
    const w = result.players[result.playerIndex["weak"]];
    expect(s.winProb).toBeGreaterThan(0.8);
    expect(s.winProb + w.winProb).toBeCloseTo(1, 6);
  });

  it("is deterministic for the same seed and differs across seeds", () => {
    const players = ["a", "b", "c"].map((id) => makePlayer(id));
    const r1 = runSimulation(baseInputs(players));
    const r2 = runSimulation(baseInputs(players));
    const r3 = runSimulation(baseInputs(players, { seed: 7 }));
    expect(r1.players[0].winProb).toBe(r2.players[0].winProb);
    expect(r1.players[0].meanGross).toBe(r2.players[0].meanGross);
    expect(r1.players[0].winProb).not.toBe(r3.players[0].winProb);
  });

  it("fixes completed holes: finished round has zero variance", () => {
    const holes = makeHoles();
    const completed: Record<number, number> = {};
    // completedHoles are keyed by holeKey(round, hole) — round 1 here.
    for (const h of holes) completed[100 + h.holeNumber] = h.par + 1;
    const done = makePlayer("done", { completedHoles: completed, roundComplete: true });
    const playing = makePlayer("playing");
    const result = runSimulation(baseInputs([done, playing]));
    const d = result.players[result.playerIndex["done"]];
    const expected = holes.reduce((s, h) => s + h.par + 1, 0);
    for (let i = 0; i < 50; i++) {
      expect(d.grossTotals[i]).toBe(expected);
      expect(d.netTotals[i]).toBe(expected - 12);
    }
  });

  it("net responds to allowance changes while gross is unchanged", () => {
    // 100% vs 90% allowance on a 20-handicap → PH 20 vs 18.
    const holes = makeHoles();
    const mk = (ph: number) => [
      makePlayer("hi", { playingHandicap: ph }, { avgGross: 92, par4AvgVsPar: 1.1, par3AvgVsPar: 1.0, par5AvgVsPar: 1.1 }),
      makePlayer("lo", { playingHandicap: 0 }, { avgGross: 74, par4AvgVsPar: 0.1, par3AvgVsPar: 0.1, par5AvgVsPar: 0.1, handicapIndex: 0 }),
    ];
    const full = runSimulation(baseInputs(mk(20), { holes }));
    const reduced = runSimulation(baseInputs(mk(18), { holes }));

    const hiFull = full.players[full.playerIndex["hi"]];
    const hiReduced = reduced.players[reduced.playerIndex["hi"]];
    // Same seed → identical gross draws; net shifts by exactly the PH delta.
    expect(hiFull.meanGross).toBe(hiReduced.meanGross);
    expect(hiFull.meanNet).toBeCloseTo(hiReduced.meanNet - 2, 6);
    // Fewer strokes → the high handicapper wins less often on net.
    expect(hiReduced.winProb).toBeLessThan(hiFull.winProb);
  });

  it("retains a positions matrix aligned with the marginals", () => {
    const players = ["a", "b", "c", "d", "e"].map((id, i) =>
      makePlayer(id, {}, { avgGross: 80 + i * 2 })
    );
    const result = runSimulation(baseInputs(players));
    const positions = result.positions!;
    expect(positions).toBeDefined();
    expect(positions.length).toBe(players.length * result.simulationCount);
    for (let pi = 0; pi < players.length; pi++) {
      let wins = 0;
      let top3 = 0;
      for (let iter = 0; iter < result.simulationCount; iter++) {
        const pos = positions[pi * result.simulationCount + iter];
        if (pos === 1) wins += 1;
        if (pos >= 1 && pos <= 3) top3 += 1;
      }
      const p = result.players[pi];
      // top-N counts the same `position` as the matrix → exact agreement.
      expect(top3 / result.simulationCount).toBeCloseTo(p.topNProb[3], 6);
      // Ties split winProb but the matrix marks every tied leader position 1.
      expect(wins / result.simulationCount).toBeGreaterThanOrEqual(p.winProb - 1e-9);
    }
  });

  it("a provisional player scales their own odds by attendance, absent iters are 0", () => {
    // A strong provisional player present only half the time.
    const players = [
      makePlayer("a"),
      makePlayer("b"),
      makePlayer(
        "prov",
        { attendanceProb: 0.5 },
        { avgGross: 74, par3AvgVsPar: 0.1, par4AvgVsPar: 0.1, par5AvgVsPar: 0.1 }
      ),
    ];
    const result = runSimulation(baseInputs(players));
    const idx = result.playerIndex["prov"];
    const provWin = result.players[idx].winProb;
    // Strong when present, but present only ~50% → wins a real but capped share.
    expect(provWin).toBeGreaterThan(0.05);
    expect(provWin).toBeLessThan(0.5);
    // Positions matrix is 0 in the ~50% of iterations where they don't show.
    const positions = result.positions!;
    let absent = 0;
    for (let i = 0; i < result.simulationCount; i++) {
      if (positions[idx * result.simulationCount + i] === 0) absent += 1;
    }
    expect(absent / result.simulationCount).toBeCloseTo(0.5, 1);
  });

  it("birdie histogram is a probability distribution over 0..18", () => {
    const player = makePlayer("a", {}, { birdiesPerRound: 2.5 });
    const result = runSimulation(baseInputs([player, makePlayer("b")]));
    const hist = result.players[result.playerIndex["a"]].birdieHistogram;
    const total = hist.reduce((s, c) => s + c, 0);
    expect(total).toBe(result.simulationCount);
    // A 2.5 birdies/round player should regularly simulate 1+ birdies.
    const oneOrMore = hist.slice(1).reduce((s, c) => s + c, 0) / result.simulationCount;
    expect(oneOrMore).toBeGreaterThan(0.6);
  });
});
