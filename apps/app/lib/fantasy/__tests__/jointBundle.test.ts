import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/fantasy/simulation/engine";
import type {
  SimHole,
  SimPlayer,
  SimPlayerProfile,
  SimulationInputs,
} from "@/lib/fantasy/simulation/types";
import {
  bundleCapabilities,
  decodeBundleRow,
  encodeBundleColumns,
} from "@/lib/fantasy/simulation/jointBundle";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5];

function makeHoles(round = 1): SimHole[] {
  return PARS.map((par, i) => ({
    holeNumber: i + 1,
    par,
    yardage: par === 3 ? 165 : par === 4 ? 390 : 520,
    strokeIndex: i + 1,
    round,
  }));
}

function makeProfile(profileId: string): SimPlayerProfile {
  return {
    profileId,
    handicapIndex: 12,
    avgGross: 42,
    scoreStddev: 3,
    recentForm: 0,
    birdiesPerRound: 1,
    eaglesPerRound: 0.05,
    parsPerRound: 4,
    bogeysPerRound: 3,
    doublesPlusPerRound: 2,
    par3AvgVsPar: 0.7,
    par4AvgVsPar: 0.75,
    par5AvgVsPar: 0.7,
    holeSplits: null,
    sampleSize: 12,
    confidence: "high",
  };
}

function makePlayer(profileId: string): SimPlayer {
  return {
    profileId,
    displayName: profileId,
    profile: makeProfile(profileId),
    playingHandicap: 12,
    completedHoles: {},
    roundComplete: false,
  };
}

function inputs(holes: SimHole[], overrides: Partial<SimulationInputs> = {}): SimulationInputs {
  return {
    players: ["a", "b", "c"].map(makePlayer),
    holes,
    rankingBasis: "net",
    simulationCount: 500,
    seed: 42,
    ...overrides,
  };
}

describe("jointBundle encode → decode", () => {
  it("round-trips a single-round sim exactly (no round_totals)", () => {
    const sim = runSimulation(inputs(makeHoles()));
    const cols = encodeBundleColumns(sim)!;
    expect(cols).not.toBeNull();
    expect(cols.round_totals).toBeNull();

    const bundle = decodeBundleRow({
      player_ids: sim.players.map((p) => p.profileId),
      sim_count: sim.simulationCount,
      event_version: 7,
      ...cols,
    });
    expect(bundle.eventVersion).toBe(7);
    expect(bundle.simCount).toBe(sim.simulationCount);

    const s = sim.simulationCount;
    sim.players.forEach((p, pi) => {
      for (let i = 0; i < s; i++) {
        expect(bundle.positions[pi * s + i]).toBe(sim.positions![pi * s + i]);
        expect(bundle.birdies![pi * s + i]).toBe(p.birdieCounts[i]);
        expect(bundle.eagles![pi * s + i]).toBe(p.eagleCounts[i]);
        expect(bundle.grossTotals![pi * s + i]).toBe(p.grossTotals[i]);
        expect(bundle.netTotals![pi * s + i]).toBe(p.netTotals[i]);
      }
    });

    const caps = bundleCapabilities(bundle);
    expect(caps.totals).toBe(true);
    expect(caps.birdies).toBe(true);
    expect(caps.eagles).toBe(true);
    expect(caps.rounds.size).toBe(0);
  });

  it("multi-round sim retains per-round arrays", () => {
    const holes = [...makeHoles(1), ...makeHoles(2)];
    const sim = runSimulation(inputs(holes));
    const cols = encodeBundleColumns(sim)!;
    expect(cols.round_totals).not.toBeNull();
    expect(Object.keys(cols.round_totals!).sort()).toEqual(["1", "2"]);

    const bundle = decodeBundleRow({
      player_ids: sim.players.map((p) => p.profileId),
      sim_count: sim.simulationCount,
      ...cols,
    });
    const s = sim.simulationCount;
    sim.players.forEach((p, pi) => {
      for (const r of [1, 2]) {
        for (let i = 0; i < s; i++) {
          expect(bundle.rounds![r].gross[pi * s + i]).toBe(p.roundGrossTotals[r][i]);
          expect(bundle.rounds![r].net[pi * s + i]).toBe(p.roundNetTotals[r][i]);
          expect(bundle.rounds![r].birdies[pi * s + i]).toBe(p.roundBirdieCounts[r][i]);
        }
      }
    });

    const caps = bundleCapabilities(bundle);
    expect([...caps.rounds].sort()).toEqual([1, 2]);
  });

  it("NULL extra columns (pre-extension rows) decode to positions-only capabilities", () => {
    const sim = runSimulation(inputs(makeHoles()));
    const cols = encodeBundleColumns(sim)!;
    const bundle = decodeBundleRow({
      player_ids: sim.players.map((p) => p.profileId),
      sim_count: sim.simulationCount,
      matrix_b64: cols.matrix_b64,
      birdies_b64: null,
      eagles_b64: null,
      gross_totals_b64: null,
      net_totals_b64: null,
      round_totals: null,
    });
    expect(bundle.birdies).toBeUndefined();
    expect(bundle.grossTotals).toBeUndefined();
    expect(bundle.rounds).toBeUndefined();

    const caps = bundleCapabilities(bundle);
    expect(caps.totals).toBe(false);
    expect(caps.birdies).toBe(false);
    expect(caps.eagles).toBe(false);
    expect(caps.rounds.size).toBe(0);
    // Null bundle (event never priced) → nothing expressible.
    const none = bundleCapabilities(null);
    expect(none.totals).toBe(false);
  });
});
