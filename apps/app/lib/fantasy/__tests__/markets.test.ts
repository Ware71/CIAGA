import { describe, expect, it } from "vitest";
import { MARKET_REGISTRY } from "@/lib/fantasy/markets/registry";
import type {
  FantasyMarket,
  FinalScoringData,
  GenerateCtx,
  LiveMarketCtx,
} from "@/lib/fantasy/markets/types";
import { runSimulation } from "@/lib/fantasy/simulation/engine";
import {
  probabilityToDecimalOdds,
  type SimHole,
  type SimPlayer,
  type SimPlayerProfile,
} from "@/lib/fantasy/simulation/types";

function makeMarket(overrides: Partial<FantasyMarket>): FantasyMarket {
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

function finalData(players: FinalScoringData["players"]): FinalScoringData {
  return {
    players,
    fieldSize: Object.keys(players).length,
    holes: [],
    field: { ace: null, albatross: null, eagle: null },
  };
}

function score(
  profileId: string,
  overrides: Partial<FinalScoringData["players"][string]> = {}
): FinalScoringData["players"][string] {
  return {
    profileId,
    position: 1,
    grossScore: 85,
    netScore: 72,
    birdieCount: 1,
    eagleCount: null,
    roundScores: {},
    holeStrokes: null,
    withdrawn: false,
    ...overrides,
  };
}

function liveCtx(overrides: Partial<LiveMarketCtx> = {}): LiveMarketCtx {
  return {
    eventCompleted: false,
    roundComplete: () => false,
    holesRemaining: () => 18,
    currentBirdies: () => 0,
    currentEagles: () => 0,
    holeScore: () => null,
    ...overrides,
  };
}

function makeGenerateCtx(n: number, rounds: number[] = [1]): GenerateCtx {
  const players = Array.from({ length: n }, (_, i) => ({ profileId: `p${i}`, playingHandicap: 10 + i }));
  const projections: GenerateCtx["projections"] = {};
  players.forEach((p, i) => {
    const base = { meanGross: 78 + i * 1.7, meanNet: 70 + i * 0.9 };
    projections[p.profileId] = {
      ...base,
      rounds: Object.fromEntries(rounds.map((r) => [r, base])),
    };
  });
  const holes = rounds.flatMap((round) =>
    Array.from({ length: 18 }, (_, i) => ({
      holeNumber: i + 1,
      par: [4, 4, 3, 5][i % 4],
      round,
    }))
  );
  return { players, projections, rounds, holes };
}

function simFor(profiles: Array<Partial<SimPlayerProfile> & { profileId: string; ph?: number }>) {
  const holes: SimHole[] = Array.from({ length: 18 }, (_, i) => ({
    holeNumber: i + 1,
    par: [4, 4, 3, 5][i % 4],
    yardage: 380,
    strokeIndex: i + 1,
  }));
  const players: SimPlayer[] = profiles.map((p) => ({
    profileId: p.profileId,
    displayName: p.profileId,
    profile: {
      profileId: p.profileId,
      handicapIndex: 10,
      avgGross: p.avgGross ?? 85,
      scoreStddev: 4,
      recentForm: 0,
      birdiesPerRound: p.birdiesPerRound ?? 1,
      eaglesPerRound: 0.05,
      parsPerRound: 7,
      bogeysPerRound: 7,
      doublesPlusPerRound: 3,
      par3AvgVsPar: p.par3AvgVsPar ?? 0.7,
      par4AvgVsPar: p.par4AvgVsPar ?? 0.7,
      par5AvgVsPar: p.par5AvgVsPar ?? 0.7,
      holeSplits: null,
      sampleSize: 12,
      confidence: "high",
    },
    playingHandicap: p.ph ?? 10,
    completedHoles: {},
    roundComplete: false,
  }));
  return runSimulation({ players, holes, rankingBasis: "net", simulationCount: 3000, seed: 11 });
}

describe("odds clamping", () => {
  it("caps decimal odds at 200 and floors near-certainties at 1.01", () => {
    expect(probabilityToDecimalOdds(0.0001)).toBe(200);
    expect(probabilityToDecimalOdds(0.9999)).toBe(1.01);
    expect(probabilityToDecimalOdds(0.5)).toBe(2);
  });
});

describe("market generation", () => {
  it("top-N markets respect field-size minimums", () => {
    const gen = (n: number) =>
      MARKET_REGISTRY.top_n.generateMarkets(makeGenerateCtx(n)).map((s) => s.params.n);
    expect(gen(4)).toEqual([]);
    expect(gen(5)).toEqual([3]);
    expect(gen(8)).toEqual([3, 5]);
    expect(gen(14)).toEqual([3, 5, 10]);
  });

  it("score totals offer a 9-value window (gross + net) centred on the handicap-implied score", () => {
    const specs = MARKET_REGISTRY.score_total.generateMarkets(makeGenerateCtx(3));
    expect(specs).toHaveLength(6); // 3 players × (gross + net)
    for (const s of specs) {
      const scores = s.params.scores as number[];
      expect(scores).toHaveLength(9);
      // Consecutive integers, centred on the middle value.
      for (let i = 1; i < scores.length; i++) expect(scores[i]).toBe(scores[i - 1] + 1);
    }
    // p0 (18 holes, par 72, playing handicap 10): gross centres on par+PH+4=86,
    // net on par+4=76 — independent of the model's own projection.
    const p0Gross = specs.find((s) => s.subject_profile_id === "p0" && s.params.basis === "gross")!;
    const p0Net = specs.find((s) => s.subject_profile_id === "p0" && s.params.basis === "net")!;
    expect((p0Gross.params.scores as number[])[4]).toBe(86);
    expect((p0Net.params.scores as number[])[4]).toBe(76);
  });

  it("score bands are centred on the handicap-implied score", () => {
    const specs = MARKET_REGISTRY.score_band.generateMarkets(makeGenerateCtx(2));
    const p1Gross = specs.find((s) => s.subject_profile_id === "p1" && s.params.basis === "gross")!;
    // p1 playing handicap 11 → gross centre 72+11+4=87 → the 87–90 middle band.
    const bands = p1Gross.params.bands as { key: string }[];
    expect(bands.map((b) => b.key)).toContain("85_88");
  });

  it("h2h generates every unique pairing (round-robin), for gross and net", () => {
    const specs = MARKET_REGISTRY.h2h.generateMarkets(makeGenerateCtx(6));
    // C(6,2) = 15 pairs per basis.
    expect(specs.filter((s) => s.params.basis === "gross")).toHaveLength(15);
    expect(specs.filter((s) => s.params.basis === "net")).toHaveLength(15);
    // No duplicate/reversed pairing.
    const pairKeys = specs.map((s) => [s.subject_profile_id, s.opponent_profile_id, s.params.basis].join("|"));
    expect(new Set(pairKeys).size).toBe(pairKeys.length);
    expect(specs.some((s) => s.subject_profile_id === "p0" && s.opponent_profile_id === "p5")).toBe(true);
  });

  it("birdie markets cover 1+..4+ per player", () => {
    const specs = MARKET_REGISTRY.birdies.generateMarkets(makeGenerateCtx(2));
    expect(specs).toHaveLength(8);
    expect(new Set(specs.map((s) => s.params.count))).toEqual(new Set([1, 2, 3, 4]));
  });

  it("eagle markets cover 1+..3+ per player", () => {
    const specs = MARKET_REGISTRY.eagle_count.generateMarkets(makeGenerateCtx(2));
    expect(specs).toHaveLength(6);
    expect(new Set(specs.map((s) => s.params.count))).toEqual(new Set([1, 2, 3]));
  });
});

describe("pricing", () => {
  it("score total under+exact+over sum to 1 and h2h a+b sum to 1", () => {
    const sim = simFor([{ profileId: "a" }, { profileId: "b", avgGross: 90, par4AvgVsPar: 1.0 }]);
    const total = MARKET_REGISTRY.score_total.simulate(
      sim,
      makeMarket({ market_type: "score_total", subject_profile_id: "a", params: { basis: "gross", scores: [85] } })
    );
    expect((total.get("u_85") ?? 0) + (total.get("e_85") ?? 0) + (total.get("o_85") ?? 0)).toBeCloseTo(1, 6);

    const h2h = MARKET_REGISTRY.h2h.simulate(
      sim,
      makeMarket({ market_type: "h2h", subject_profile_id: "a", opponent_profile_id: "b", params: { basis: "gross" } })
    );
    expect((h2h.get("a") ?? 0) + (h2h.get("draw") ?? 0) + (h2h.get("b") ?? 0)).toBeCloseTo(1, 6);
    // "a" projects ~5 shots better → clear favourite.
    expect(h2h.get("a")!).toBeGreaterThan(0.6);
  });

  it("h2h prices a real 1-X-2 (draw is a backable outcome, not excluded)", () => {
    // Hand-built joint samples: 5 iterations — 2 ties, a wins 2, b wins 1.
    const totals = {
      a: Int16Array.from([70, 70, 69, 71, 69]),
      b: Int16Array.from([70, 70, 71, 70, 70]),
    };
    const mini = {
      simulationCount: 5,
      rankingBasis: "gross" as const,
      holes: [],
      playerIndex: { a: 0, b: 1 },
      players: (["a", "b"] as const).map((id) => ({
        profileId: id,
        grossTotals: totals[id],
        netTotals: totals[id],
        roundGrossTotals: { 1: totals[id] },
        roundNetTotals: { 1: totals[id] },
        birdieHistogram: [5],
        winProb: 0,
        topNProb: {},
        positionHistogram: [0, 0],
        lastProb: 0,
        meanGross: 0,
        meanNet: 0,
        holeOutcomes: [],
      })),
    };
    const probs = MARKET_REGISTRY.h2h.simulate(
      mini,
      makeMarket({ market_type: "h2h", subject_profile_id: "a", opponent_profile_id: "b", params: { basis: "gross" } })
    );
    // 5 iterations: a wins 2, b wins 1, 2 ties → a 0.4, draw 0.4, b 0.2.
    expect(probs.get("a")).toBeCloseTo(0.4, 9);
    expect(probs.get("draw")).toBeCloseTo(0.4, 9);
    expect(probs.get("b")).toBeCloseTo(0.2, 9);
  });

  it("birdie ladder probabilities decrease with count", () => {
    const sim = simFor([{ profileId: "a", birdiesPerRound: 2 }, { profileId: "b" }]);
    const p = (count: number) =>
      MARKET_REGISTRY.birdies
        .simulate(sim, makeMarket({ market_type: "birdies", subject_profile_id: "a", params: { count } }))
        .get("yes")!;
    expect(p(1)).toBeGreaterThan(p(2));
    expect(p(2)).toBeGreaterThan(p(3));
    expect(p(3)).toBeGreaterThan(p(4));
  });
});

describe("settlement truth tables", () => {
  it("outright winner: position 1 wins, others lose, withdrawn voids", () => {
    const outcomes = MARKET_REGISTRY.outright_winner.settle(
      finalData({
        a: score("a", { position: 1 }),
        b: score("b", { position: 2 }),
        c: score("c", { position: null, withdrawn: true }),
      }),
      makeMarket({})
    );
    expect(outcomes.get("a")).toBe("won");
    expect(outcomes.get("b")).toBe("lost");
    expect(outcomes.get("c")).toBe("void");
  });

  it("top-3: position ≤ n wins", () => {
    const outcomes = MARKET_REGISTRY.top_n.settle(
      finalData({
        a: score("a", { position: 3 }),
        b: score("b", { position: 4 }),
      }),
      makeMarket({ market_type: "top_n", params: { n: 3 } })
    );
    expect(outcomes.get("a")).toBe("won");
    expect(outcomes.get("b")).toBe("lost");
  });

  it("gross score total: exact comparisons per value, missing score voids all three", () => {
    const market = makeMarket({ market_type: "score_total", subject_profile_id: "a", params: { basis: "gross", scores: [82] } });
    const under = MARKET_REGISTRY.score_total.settle(finalData({ a: score("a", { grossScore: 80 }) }), market);
    expect(under.get("u_82")).toBe("won");
    expect(under.get("e_82")).toBe("lost");
    expect(under.get("o_82")).toBe("lost");
    const exact = MARKET_REGISTRY.score_total.settle(finalData({ a: score("a", { grossScore: 82 }) }), market);
    expect(exact.get("e_82")).toBe("won");
    const voided = MARKET_REGISTRY.score_total.settle(finalData({ a: score("a", { grossScore: null }) }), market);
    expect(voided.get("u_82")).toBe("void");
    expect(voided.get("e_82")).toBe("void");
    expect(voided.get("o_82")).toBe("void");
  });

  it("birdies: achieved count wins even after withdrawal; unknown voids", () => {
    const market = makeMarket({ market_type: "birdies", subject_profile_id: "a", params: { count: 2 } });
    expect(
      MARKET_REGISTRY.birdies.settle(finalData({ a: score("a", { birdieCount: 2, withdrawn: true }) }), market).get("yes")
    ).toBe("won");
    expect(
      MARKET_REGISTRY.birdies.settle(finalData({ a: score("a", { birdieCount: 1 }) }), market).get("yes")
    ).toBe("lost");
    expect(
      MARKET_REGISTRY.birdies.settle(finalData({ a: score("a", { birdieCount: null }) }), market).get("yes")
    ).toBe("void");
  });

  it("h2h: lower score wins, equal scores win the draw", () => {
    const market = makeMarket({
      market_type: "h2h", subject_profile_id: "a", opponent_profile_id: "b", params: { basis: "net" },
    });
    const won = MARKET_REGISTRY.h2h.settle(
      finalData({ a: score("a", { netScore: 70 }), b: score("b", { netScore: 72 }) }),
      market
    );
    expect(won.get("a")).toBe("won");
    expect(won.get("draw")).toBe("lost");
    expect(won.get("b")).toBe("lost");
    const tied = MARKET_REGISTRY.h2h.settle(
      finalData({ a: score("a", { netScore: 71 }), b: score("b", { netScore: 71 }) }),
      market
    );
    expect(tied.get("a")).toBe("lost");
    expect(tied.get("draw")).toBe("won");
    expect(tied.get("b")).toBe("lost");
  });
});

describe("self-dependency and placement guards", () => {
  it("blocks cash-out on 1+ birdies for the subject themself", () => {
    const market = makeMarket({ market_type: "birdies", subject_profile_id: "me", params: { count: 1 } });
    expect(MARKET_REGISTRY.birdies.isSelfDependent(market, "yes", "me", liveCtx())).toBe(true);
    expect(MARKET_REGISTRY.birdies.isSelfDependent(market, "yes", "someone", liveCtx())).toBe(false);
  });

  it("3+ birdies on yourself stays cash-out-able until one birdie away", () => {
    const market = makeMarket({ market_type: "birdies", subject_profile_id: "me", params: { count: 3 } });
    expect(
      MARKET_REGISTRY.birdies.isSelfDependent(market, "yes", "me", liveCtx({ currentBirdies: () => 1 }))
    ).toBe(false);
    expect(
      MARKET_REGISTRY.birdies.isSelfDependent(market, "yes", "me", liveCtx({ currentBirdies: () => 2 }))
    ).toBe(true);
  });

  it("score total on yourself blocks cash-out on the final hole", () => {
    const market = makeMarket({ market_type: "score_total", subject_profile_id: "me", params: { basis: "gross", scores: [84] } });
    expect(
      MARKET_REGISTRY.score_total.isSelfDependent(market, "u_84", "me", liveCtx({ holesRemaining: () => 5 }))
    ).toBe(false);
    expect(
      MARKET_REGISTRY.score_total.isSelfDependent(market, "u_84", "me", liveCtx({ holesRemaining: () => 1 }))
    ).toBe(true);
  });

  it("placement blocks completed subjects and decided birdie markets", () => {
    const market = makeMarket({ market_type: "birdies", subject_profile_id: "a", params: { count: 2 } });
    expect(MARKET_REGISTRY.birdies.placementAllowed(market, "yes", liveCtx())).toBe(true);
    expect(
      MARKET_REGISTRY.birdies.placementAllowed(market, "yes", liveCtx({ currentBirdies: () => 2 }))
    ).toBe(false);
    expect(
      MARKET_REGISTRY.birdies.placementAllowed(market, "yes", liveCtx({ roundComplete: () => true }))
    ).toBe(false);
    expect(
      MARKET_REGISTRY.outright_winner.placementAllowed(makeMarket({}), "a", liveCtx({ eventCompleted: true }))
    ).toBe(false);
  });

  it("cash-out cutoffs: round complete cuts player-scoped markets", () => {
    const market = makeMarket({ market_type: "score_total", subject_profile_id: "a", params: { basis: "gross", scores: [84] } });
    const cut = MARKET_REGISTRY.score_total.cashoutCutoff(market, "u_84", liveCtx({ roundComplete: () => true }));
    expect(cut.eligible).toBe(false);
    const ok = MARKET_REGISTRY.score_total.cashoutCutoff(market, "u_84", liveCtx());
    expect(ok.eligible).toBe(true);
  });
});
