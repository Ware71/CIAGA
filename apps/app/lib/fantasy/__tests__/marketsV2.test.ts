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
import { scoreTotal } from "@/lib/fantasy/markets/scoreTotal";
import { eagleCount } from "@/lib/fantasy/markets/eagles";
import { holeScore, holeSelectionKey } from "@/lib/fantasy/markets/holeScore";
import { fieldSpecial } from "@/lib/fantasy/markets/fieldSpecials";
import { outrightWinner } from "@/lib/fantasy/markets/outrightWinner";
import { shapeFor } from "@/lib/fantasy/__tests__/shapeFixture";

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
    // Derived from the level (see shapeFixture.ts) so an avgGross override
    // stays a player who could exist once the par bin is calibrated.
    ...shapeFor(overrides.avgGross ?? 85, overrides.birdiesPerRound ?? 1),
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
  const base = {
    position: null,
    resolvedPosition: null,
    grossScore: null,
    netScore: null,
    birdieCount: null,
    eagleCount: null,
    roundScores: {},
    holeStrokes: null,
    withdrawn: false,
    ...overrides,
  };
  // No tie-break unless a test says so: the resolved position mirrors the tied
  // one, which is what a playoff-free event looks like.
  return { ...base, resolvedPosition: overrides.resolvedPosition ?? base.position };
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

  it("round-scoped outright prices from that round's samples with ties at FULL credit", () => {
    const m = market({ market_type: "outright_winner", params: { round: 2 } });
    const probs = outrightWinner.simulate(two, m);
    const total = [...probs.values()].reduce((s, p) => s + p, 0);
    // Round winners settle "ties all win", so tied iterations credit every
    // tied player in full — Σp exceeds 1 by exactly the tie mass.
    expect(total).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(total).toBeLessThan(1.5);
  });

  it("round outright: constructed dead-heat prices both winners in full", () => {
    // Hand-built sim: 4 iterations, players tie for the round-1 lead in 2 of them.
    const totals = {
      a: Int16Array.from([70, 70, 69, 72]),
      b: Int16Array.from([70, 70, 71, 70]),
    };
    const mini: SimulationResult = {
      simulationCount: 4,
      rankingBasis: "gross",
      holes: makeHoles([1]),
      playerIndex: { a: 0, b: 1 },
      players: (["a", "b"] as const).map((id) => ({
        profileId: id,
        grossTotals: totals[id],
        netTotals: totals[id],
        roundGrossTotals: { 1: totals[id] },
        roundNetTotals: { 1: totals[id] },
        birdieHistogram: [4],
        birdieCounts: new Int8Array(4),
        eagleCounts: new Int8Array(4),
        roundBirdieCounts: { 1: new Int8Array(4) },
        winProb: 0,
        topNProb: {},
        positionHistogram: [0, 0],
        lastProb: 0,
        meanGross: 0,
        meanNet: 0,
        holeOutcomes: [],
      })),
    };
    const probs = outrightWinner.simulate(mini, market({ market_type: "outright_winner", params: { round: 1 } }));
    // a wins iters 1,2 (tie), 3 → 3/4; b wins iters 1,2 (tie), 4 → 3/4.
    expect(probs.get("a")).toBeCloseTo(0.75, 9);
    expect(probs.get("b")).toBeCloseTo(0.75, 9);
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
    const m = market({ market_type: "finish_position", subject_profile_id: "a", params: {} });
    const probs = finishPosition.simulate(sim, m);
    const sum = [...probs.values()].reduce((s, p) => s + p, 0);
    expect(sum).toBeCloseTo(1, 5); // maxPos = field → full distribution
    expect(probs.get("1")!).toBeGreaterThan(probs.get("4")!);
  });

  it("finish_position settles exactly one winner", () => {
    const m = market({ market_type: "finish_position", subject_profile_id: "a", params: {} });
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

  it("band settlement pays exactly the covering band via settleKey", () => {
    // Bands are dynamic/self-describing, so a placed pick settles on its OWN key.
    const m = market({ market_type: "score_band", subject_profile_id: "a", params: { basis: "gross" } });
    const final = finalData([finalPlayer({ profileId: "a", grossScore: 88 })]);
    const sk = scoreBand.settleKey!;
    expect(sk(final, m, "86_89")).toBe("won"); // 88 ∈ [86,89]
    expect(sk(final, m, "82_85")).toBe("lost");
    expect(sk(final, m, "le_81")).toBe("lost");
    expect(sk(final, m, "ge_90")).toBe("lost");
  });

  it("centres the inner-band junction on the projection with full integer coverage", () => {
    for (const mean of [72.2, 79.7, 85, 90.5, 66]) {
      const bands = bandsAround(mean);
      const inner = bands.filter((b) => b.lo != null && b.hi != null);
      expect(inner).toHaveLength(2); // two 4-stroke inner bands + two open tails
      // Junction between the two inner bands should sit within half a stroke of
      // the projection, so a centred distribution splits evenly across them.
      const junction = inner[0].hi! + 0.5;
      expect(Math.abs(junction - mean)).toBeLessThanOrEqual(0.5);
      // Contiguous partition of the integer line: no gaps, no overlaps.
      expect(bands[0].hi! + 1).toBe(bands[1].lo);
      expect(bands[1].hi! + 1).toBe(bands[2].lo);
      expect(bands[2].hi! + 1).toBe(bands[3].lo);
    }
  });

  it("score totals settle under/exact/over against each value via settleKey", () => {
    const m = market({ market_type: "score_total", subject_profile_id: "a", params: { basis: "gross" } });
    const final = finalData([finalPlayer({ profileId: "a", grossScore: 84 })]);
    const sk = scoreTotal.settleKey!;
    expect(sk(final, m, "e_84")).toBe("won");
    expect(sk(final, m, "u_84")).toBe("lost");
    expect(sk(final, m, "o_84")).toBe("lost");
    expect(sk(final, m, "o_83")).toBe("won");
    expect(sk(final, m, "u_85")).toBe("won");
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

  it("REGRESSION: skips holes the engine never modelled, instead of quoting them at the floor", () => {
    // A finished round with only holes 1-2 recorded. The engine fixes those two
    // and samples nothing (the round is over), so every other hole's outcome
    // bins stay empty — the pick-up / mid-round-withdrawal shape. Quoting them
    // reported P = 0 on BOTH books, which the clamp turned into an identical
    // 1000/1 on each: "birdie and bogey have the same odds".
    const sim = runSimulation({
      players: [
        {
          profileId: "a",
          displayName: "a",
          profile: profile({ profileId: "a" }),
          playingHandicap: 10,
          completedHoles: { 101: 3, 102: 4 }, // hole 1 (par 4) birdie, hole 2 par
          roundComplete: true,
        },
        {
          profileId: "b",
          displayName: "b",
          profile: profile({ profileId: "b" }),
          playingHandicap: 10,
          completedHoles: {},
          roundComplete: false,
        },
      ],
      holes: makeHoles([1]),
      rankingBasis: "net",
      simulationCount: 200,
      seed: 17,
    });
    const forOutcome = (outcome: string) =>
      holeScore.simulate(
        sim,
        market({ market_type: "hole_score", subject_profile_id: "a", params: { outcome } })
      );
    const birdie = forOutcome("birdie_or_better");
    const bogey = forOutcome("bogey_or_worse");

    // Only the two recorded holes are offered — on both books.
    const recorded = [holeSelectionKey(1, 1), holeSelectionKey(1, 2)];
    expect([...birdie.keys()]).toEqual(recorded);
    expect([...bogey.keys()]).toEqual(recorded);

    // Played holes still price deterministically. Hole 2 was PARRED, so zero on
    // both books is correct — a decided hole, not a missing one.
    expect(birdie.get(holeSelectionKey(1, 1))).toBe(1);
    expect(bogey.get(holeSelectionKey(1, 1))).toBe(0);
    expect(birdie.get(holeSelectionKey(1, 2))).toBe(0);
    expect(bogey.get(holeSelectionKey(1, 2))).toBe(0);
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
