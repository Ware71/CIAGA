import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/fantasy/simulation/engine";
import type {
  SimHole,
  SimPlayer,
  SimPlayerProfile,
  SimulationResult,
} from "@/lib/fantasy/simulation/types";
import type {
  FinalPlayerScore,
  FinalScoringData,
  FantasyMarket,
} from "@/lib/fantasy/markets/types";
import { finishRange } from "@/lib/fantasy/markets/finishRange";
import { finishPosition } from "@/lib/fantasy/markets/finishPosition";
import { scoreBand, bandsAround } from "@/lib/fantasy/markets/scoreBand";
import { scoreExact } from "@/lib/fantasy/markets/scoreExact";
import { eagleCount } from "@/lib/fantasy/markets/eagles";
import { holeScore, holeSelectionKey } from "@/lib/fantasy/markets/holeScore";
import { fieldSpecial } from "@/lib/fantasy/markets/fieldSpecials";
import { outrightWinner } from "@/lib/fantasy/markets/outrightWinner";

function profile(overrides: Partial<SimPlayerProfile> & { profileId: string }): SimPlayerProfile {
  // The model prices off par-type averages, so derive them from avgGross —
  // otherwise every fixture player scores identically.
  const perHole = ((overrides.avgGross ?? 85) - 72) / 18;
  return {
    handicapIndex: 10,
    avgGross: 85,
    scoreStddev: 4,
    recentForm: 0,
    birdiesPerRound: 1,
    eaglesPerRound: 0.05,
    parsPerRound: 7,
    bogeysPerRound: 7,
    doublesPlusPerRound: 3,
    par3AvgVsPar: perHole,
    par4AvgVsPar: perHole,
    par5AvgVsPar: perHole,
    holeSplits: null,
    sampleSize: 12,
    confidence: "high",
    ...overrides,
  };
}

function makeHoles(rounds: number[]): SimHole[] {
  return rounds.flatMap((round) =>
    Array.from({ length: 18 }, (_, i) => ({
      holeNumber: i + 1,
      par: [4, 4, 3, 5][i % 4],
      yardage: 380,
      strokeIndex: i + 1,
      round,
    }))
  );
}

function simulate(
  playerSpecs: (Partial<SimPlayerProfile> & { profileId: string; ph?: number })[],
  rounds: number[] = [1],
  simulationCount = 3000
): SimulationResult {
  const players: SimPlayer[] = playerSpecs.map((p) => ({
    profileId: p.profileId,
    displayName: p.profileId,
    profile: profile(p),
    playingHandicap: p.ph ?? 10,
    completedHoles: {},
    roundComplete: false,
  }));
  return runSimulation({
    players,
    holes: makeHoles(rounds),
    rankingBasis: "net",
    simulationCount,
    seed: 17,
  });
}

function market(overrides: Partial<FantasyMarket>): FantasyMarket {
  return {
    id: "m1",
    event_id: "e1",
    group_id: "g1",
    market_type: "outright_winner",
    subject_profile_id: null,
    opponent_profile_id: null,
    params: {},
    status: "open",
    settled_at: null,
    ...overrides,
  };
}

function finalPlayer(overrides: Partial<FinalPlayerScore> & { profileId: string }): FinalPlayerScore {
  return {
    position: null,
    grossScore: null,
    netScore: null,
    birdieCount: null,
    eagleCount: null,
    roundScores: {},
    holeStrokes: null,
    withdrawn: false,
    ...overrides,
  };
}

function finalData(
  players: FinalPlayerScore[],
  extras: Partial<FinalScoringData> = {}
): FinalScoringData {
  return {
    players: Object.fromEntries(players.map((p) => [p.profileId, p])),
    fieldSize: players.length,
    holes: makeHoles([1]).map((h) => ({ holeNumber: h.holeNumber, par: h.par, round: 1 })),
    field: { ace: null, albatross: null, eagle: null },
    ...extras,
  };
}

describe("engine V2 outputs", () => {
  const sim = simulate([
    { profileId: "a", avgGross: 78 },
    { profileId: "b", avgGross: 84 },
    { profileId: "c", avgGross: 90 },
    { profileId: "d", avgGross: 96 },
  ]);

  it("position histogram sums to 1 and matches topN semantics", () => {
    for (const p of sim.players) {
      const sum = p.positionHistogram.reduce((s, x) => s + x, 0);
      expect(sum).toBeCloseTo(1, 6);
      const top3FromHist = p.positionHistogram.slice(0, 3).reduce((s, x) => s + x, 0);
      expect(top3FromHist).toBeCloseTo(p.topNProb[3] ?? 0, 6);
    }
  });

  it("lastProb orders by ability and stays within the tail mass", () => {
    const byId = (id: string) => sim.players[sim.playerIndex[id]];
    expect(byId("d").lastProb).toBeGreaterThan(byId("a").lastProb);
    // Ties split for lastProb, so it can't exceed the full P(worst position).
    const d = byId("d");
    expect(d.lastProb).toBeLessThanOrEqual(
      d.positionHistogram[d.positionHistogram.length - 1] +
        d.positionHistogram[d.positionHistogram.length - 2] +
        1e-9
    );
  });
});

describe("multi-round simulation", () => {
  const one = simulate([{ profileId: "a" }, { profileId: "b" }], [1]);
  const two = simulate([{ profileId: "a" }, { profileId: "b" }], [1, 2]);

  it("two rounds ≈ double the one-round gross mean", () => {
    const g1 = one.players[0].meanGross;
    const g2 = two.players[0].meanGross;
    expect(g2).toBeGreaterThan(g1 * 1.9);
    expect(g2).toBeLessThan(g1 * 2.1);
  });

  it("round totals sum to the event total; net applies PH per round", () => {
    const p = two.players[0];
    for (const iter of [0, 100, 999]) {
      expect(p.roundGrossTotals[1][iter] + p.roundGrossTotals[2][iter]).toBe(p.grossTotals[iter]);
      expect(p.netTotals[iter]).toBe(p.grossTotals[iter] - 10 * 2);
    }
  });

  it("round-scoped outright prices from that round's samples", () => {
    const m = market({ market_type: "outright_winner", params: { round: 2 } });
    const probs = outrightWinner.simulate(two, m);
    const total = [...probs.values()].reduce((s, p) => s + p, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe("finish markets", () => {
  const sim = simulate([
    { profileId: "a", avgGross: 78 },
    { profileId: "b", avgGross: 84 },
    { profileId: "c", avgGross: 90 },
    { profileId: "d", avgGross: 96 },
  ]);

  it("finish_position probabilities come from the histogram", () => {
    const m = market({ market_type: "finish_position", subject_profile_id: "a", params: { maxPos: 4 } });
    const probs = finishPosition.simulate(sim, m);
    const sum = [...probs.values()].reduce((s, p) => s + p, 0);
    expect(sum).toBeCloseTo(1, 5); // maxPos = field → full distribution
    expect(probs.get("1")!).toBeGreaterThan(probs.get("4")!);
  });

  it("finish_position settles exactly one winner", () => {
    const m = market({ market_type: "finish_position", subject_profile_id: "a", params: { maxPos: 4 } });
    const outcomes = finishPosition.settle(
      finalData([finalPlayer({ profileId: "a", position: 2 })]),
      m
    );
    expect(outcomes.get("2")).toBe("won");
    expect(outcomes.get("1")).toBe("lost");
    expect(outcomes.get("4")).toBe("lost");
  });

  it("wooden spoon settles on the worst ranked position, ties all won", () => {
    const m = market({ market_type: "finish_range", params: { kind: "last" } });
    const outcomes = finishRange.settle(
      finalData([
        finalPlayer({ profileId: "a", position: 1 }),
        finalPlayer({ profileId: "b", position: 3 }),
        finalPlayer({ profileId: "c", position: 3 }),
        finalPlayer({ profileId: "d", position: null, withdrawn: true }),
      ]),
      m
    );
    expect(outcomes.get("a")).toBe("lost");
    expect(outcomes.get("b")).toBe("won");
    expect(outcomes.get("c")).toBe("won");
    expect(outcomes.get("d")).toBe("void");
  });

  it("range market sums positions", () => {
    const m = market({ market_type: "finish_range", params: { from: 1, to: 2 } });
    const probs = finishRange.simulate(sim, m);
    const a = sim.players[sim.playerIndex["a"]];
    expect(probs.get("a")).toBeCloseTo(a.positionHistogram[0] + a.positionHistogram[1], 9);
  });
});

describe("score bands and exacts", () => {
  const sim = simulate([{ profileId: "a" }, { profileId: "b" }]);

  it("bands partition the distribution (probabilities sum to 1)", () => {
    const m = market({
      market_type: "score_band",
      subject_profile_id: "a",
      params: { basis: "gross", bands: bandsAround(sim.players[0].meanGross) },
    });
    const probs = scoreBand.simulate(sim, m);
    const sum = [...probs.values()].reduce((s, p) => s + p, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("band settlement pays exactly the covering band", () => {
    const bands = bandsAround(85); // le_82 | 83_86 | 87_90 | ge_91
    const m = market({
      market_type: "score_band",
      subject_profile_id: "a",
      params: { basis: "gross", bands },
    });
    const outcomes = scoreBand.settle(
      finalData([finalPlayer({ profileId: "a", grossScore: 88 })]),
      m
    );
    expect([...outcomes.values()].filter((o) => o === "won")).toHaveLength(1);
    expect(outcomes.get("87_90")).toBe("won");
    expect(outcomes.get("le_82")).toBe("lost");
  });

  it("exact score wins only on equality", () => {
    const m = market({
      market_type: "score_exact",
      subject_profile_id: "a",
      params: { basis: "gross", scores: [83, 84, 85] },
    });
    const outcomes = scoreExact.settle(
      finalData([finalPlayer({ profileId: "a", grossScore: 84 })]),
      m
    );
    expect(outcomes.get("84")).toBe("won");
    expect(outcomes.get("83")).toBe("lost");
    expect(outcomes.get("85")).toBe("lost");
  });
});

describe("eagles", () => {
  it("eagle probability follows the observed eagle rate", () => {
    const sim = simulate([
      { profileId: "hot", eaglesPerRound: 0.5 },
      { profileId: "never", eaglesPerRound: 0 },
    ]);
    const pHot = eagleCount
      .simulate(sim, market({ market_type: "eagle_count", subject_profile_id: "hot", params: { count: 1 } }))
      .get("yes")!;
    const pNever = eagleCount
      .simulate(sim, market({ market_type: "eagle_count", subject_profile_id: "never", params: { count: 1 } }))
      .get("yes")!;
    expect(pHot).toBeGreaterThan(pNever * 2);
    expect(pNever).toBeLessThan(0.2);
  });

  it("settles won when achieved, void without hole data", () => {
    const m = market({ market_type: "eagle_count", subject_profile_id: "a", params: { count: 1 } });
    expect(
      eagleCount.settle(finalData([finalPlayer({ profileId: "a", eagleCount: 1 })]), m).get("yes")
    ).toBe("won");
    expect(
      eagleCount.settle(finalData([finalPlayer({ profileId: "a", eagleCount: null })]), m).get("yes")
    ).toBe("void");
    expect(
      eagleCount.settle(finalData([finalPlayer({ profileId: "a", eagleCount: 0 })]), m).get("yes")
    ).toBe("lost");
  });
});

describe("hole markets", () => {
  it("settles from recorded hole strokes; unrecorded holes void", () => {
    const m = market({
      market_type: "hole_score",
      subject_profile_id: "a",
      params: { outcome: "birdie_or_better" },
    });
    // Hole 1 is par 4: birdie = 3. Keyed holeKey(1, hole) = 100 + hole.
    const outcomes = holeScore.settle(
      finalData([
        finalPlayer({ profileId: "a", holeStrokes: { 101: 3, 102: 4 } }),
      ]),
      m
    );
    expect(outcomes.get(holeSelectionKey(1, 1))).toBe("won");
    expect(outcomes.get(holeSelectionKey(1, 2))).toBe("lost");
    expect(outcomes.get(holeSelectionKey(1, 3))).toBe("void");
  });

  it("prices every hole and respects bins", () => {
    const sim = simulate([{ profileId: "a" }, { profileId: "b" }]);
    const m = market({
      market_type: "hole_score",
      subject_profile_id: "a",
      params: { outcome: "birdie_or_better" },
    });
    const probs = holeScore.simulate(sim, m);
    expect(probs.size).toBe(18);
    for (const p of probs.values()) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(0.6);
    }
  });
});

describe("field specials", () => {
  const sim = simulate([{ profileId: "a" }, { profileId: "b" }, { profileId: "c" }]);

  it("HIO prices off the base rate, not the normal tail", () => {
    const p = fieldSpecial
      .simulate(sim, market({ market_type: "field_special", params: { kind: "hio" } }))
      .get("yes")!;
    // 4-5 par 3s × 3 players ⇒ well under 1%.
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(0.01);
  });

  it("settles from the field flags, void without hole data", () => {
    const m = market({ market_type: "field_special", params: { kind: "hio" } });
    expect(
      fieldSpecial
        .settle(finalData([], { field: { ace: true, albatross: false, eagle: true } }), m)
        .get("yes")
    ).toBe("won");
    expect(
      fieldSpecial
        .settle(finalData([], { field: { ace: false, albatross: false, eagle: false } }), m)
        .get("yes")
    ).toBe("lost");
    expect(
      fieldSpecial
        .settle(finalData([], { field: { ace: null, albatross: null, eagle: null } }), m)
        .get("yes")
    ).toBe("void");
  });
});
