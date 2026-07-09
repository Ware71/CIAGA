import { describe, expect, it } from "vitest";
import { eventPointsForPosition } from "@/lib/fantasy/simulation/seasonPoints";
import { simulateSeason, type RemainingEvent } from "@/lib/fantasy/simulation/seasonEngine";
import type { JointMatrix } from "@/lib/fantasy/simulation/jointPricing";

describe("eventPointsForPosition", () => {
  it("fedex_style reads the fixed ladder, capped at 20th", () => {
    const cfg = { pointsModel: "fedex_style", fieldSize: 30 };
    expect(eventPointsForPosition(cfg, 1)).toBe(500);
    expect(eventPointsForPosition(cfg, 2)).toBe(300);
    expect(eventPointsForPosition(cfg, 25)).toBe(1);
  });

  it("position/custom table reads the jsonb map (absent → 0)", () => {
    const cfg = { pointsModel: "position_based", pointsTable: { "1": 25, "2": 18, "3": 15 }, fieldSize: 10 };
    expect(eventPointsForPosition(cfg, 1)).toBe(25);
    expect(eventPointsForPosition(cfg, 3)).toBe(15);
    expect(eventPointsForPosition(cfg, 9)).toBe(0);
  });

  it("ciaga_formula matches the documented default (P=1, F=6 → 55)", () => {
    expect(eventPointsForPosition({ pointsModel: "ciaga_formula", fieldSize: 6, numRounds: 1 }, 1)).toBe(55);
  });

  it("ciaga_formula decreases monotonically; last ≈ base", () => {
    const cfg = { pointsModel: "ciaga_formula", fieldSize: 10, numRounds: 1 };
    expect(eventPointsForPosition(cfg, 1)).toBeGreaterThan(eventPointsForPosition(cfg, 2));
    expect(eventPointsForPosition(cfg, 2)).toBeGreaterThan(eventPointsForPosition(cfg, 10));
    expect(eventPointsForPosition(cfg, 10)).toBe(18); // base only (posTerm 0)
  });

  it("none / unknown model scores 0", () => {
    expect(eventPointsForPosition({ pointsModel: "none", fieldSize: 10 }, 1)).toBe(0);
  });
});

function matrix(playerIds: string[], perIter: Record<string, number>[]): JointMatrix {
  const simCount = perIter.length;
  const positions = new Int8Array(playerIds.length * simCount);
  playerIds.forEach((id, pi) => {
    for (let it = 0; it < simCount; it++) positions[pi * simCount + it] = perIter[it][id] ?? 0;
  });
  return { playerIds, simCount, positions };
}

describe("simulateSeason", () => {
  it("with no remaining events the current leader wins deterministically", () => {
    const res = simulateSeason({
      currentPoints: { A: 100, B: 50, C: 10 },
      playerIds: ["A", "B", "C"],
      remaining: [],
      iterations: 200,
      seed: 1,
    });
    const a = res.players.find((p) => p.profileId === "A")!;
    expect(a.winProb).toBeCloseTo(1, 6);
    expect(a.top3Prob).toBeCloseTo(1, 6);
  });

  it("a trailing player can still win when a big event remains", () => {
    const ev: RemainingEvent = {
      matrix: matrix(["A", "B"], [
        { A: 1, B: 2 },
        { B: 1, A: 2 },
      ]),
      points: { pointsModel: "fedex_style", fieldSize: 2 }, // 1st 500, 2nd 300
    };
    const res = simulateSeason({
      currentPoints: { A: 40, B: 0 },
      playerIds: ["A", "B"],
      remaining: [ev],
      iterations: 400,
      seed: 3,
    });
    // B wins the event ~half the time; +500 vs A's +300 overturns the 40 gap.
    expect(res.players.find((p) => p.profileId === "B")!.winProb).toBeGreaterThan(0.3);
  });

  it("season win probabilities sum to ~1 (ties split)", () => {
    const res = simulateSeason({
      currentPoints: { A: 10, B: 10, C: 10 },
      playerIds: ["A", "B", "C"],
      remaining: [
        {
          matrix: matrix(["A", "B", "C"], [
            { A: 1, B: 2, C: 3 },
            { B: 1, C: 2, A: 3 },
            { C: 1, A: 2, B: 3 },
          ]),
          points: { pointsModel: "ciaga_formula", fieldSize: 3 },
        },
      ],
      iterations: 300,
      seed: 7,
    });
    const sum = res.players.reduce((s, p) => s + p.winProb, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});
