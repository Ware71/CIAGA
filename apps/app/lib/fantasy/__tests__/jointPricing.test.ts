import { describe, expect, it } from "vitest";
import {
  combineAccaOdds,
  jointPositionProbability,
  type AccaLegForPricing,
  type JointMatrix,
  type PositionLeg,
} from "@/lib/fantasy/simulation/jointPricing";
import { probabilityToDecimalOdds } from "@/lib/fantasy/simulation/types";

const A = "A", B = "B", C = "C", D = "D";

/** Build a matrix from explicit per-iteration position maps. */
function buildMatrix(playerIds: string[], perIter: Record<string, number>[]): JointMatrix {
  const simCount = perIter.length;
  const positions = new Int8Array(playerIds.length * simCount);
  playerIds.forEach((id, pi) => {
    for (let iter = 0; iter < simCount; iter++) {
      positions[pi * simCount + iter] = perIter[iter][id] ?? 0;
    }
  });
  return { playerIds, simCount, positions };
}

// Four players; every iteration is a clean 1–4 finish. A and B both finish
// top-3 in 2 of 4 iterations, but never lose a top-3 slot to each other in the
// same way the product assumes — they're negatively correlated.
const matrix = buildMatrix([A, B, C, D], [
  { A: 1, B: 2, C: 3, D: 4 },
  { B: 1, A: 2, C: 3, D: 4 },
  { C: 1, D: 2, A: 3, B: 4 },
  { D: 1, C: 2, B: 3, A: 4 },
]);

const top3 = (p: string): PositionLeg => ({ marketType: "top_n", params: { n: 3 }, playerId: p, selectionKey: p });
const winner = (p: string): PositionLeg => ({ marketType: "outright_winner", params: {}, playerId: p, selectionKey: p });

describe("jointPositionProbability", () => {
  it("a single top-3 leg equals its marginal", () => {
    expect(jointPositionProbability(matrix, [top3(A)])).toBeCloseTo(0.75, 9); // top-3 in 3 of 4
    expect(jointPositionProbability(matrix, [top3(D)])).toBeCloseTo(0.5, 9);
  });

  it("two top-3 legs are negatively correlated — joint below the product", () => {
    const joint = jointPositionProbability(matrix, [top3(A), top3(B)]);
    const product = 0.75 * 0.75;
    expect(joint).toBeCloseTo(0.5, 9);
    expect(joint).toBeLessThan(product);
  });

  it("prices outright winner as P(position 1)", () => {
    expect(jointPositionProbability(matrix, [winner(A)])).toBeCloseTo(0.25, 9);
  });

  it("wooden spoon = finishing at the max present position", () => {
    const last = (p: string): PositionLeg => ({ marketType: "finish_range", params: { kind: "last" }, playerId: p, selectionKey: p });
    // D is last (position 4) in iters 0 and 1 → 0.5.
    expect(jointPositionProbability(matrix, [last(D)])).toBeCloseTo(0.5, 9);
  });

  it("collapses to 0 for a player not in the matrix", () => {
    expect(jointPositionProbability(matrix, [top3(A), top3("Z")])).toBe(0);
  });
});

describe("combineAccaOdds", () => {
  const marginalOdds = (p: string) =>
    probabilityToDecimalOdds(jointPositionProbability(matrix, [top3(p)]));

  it("two correlated top-3 legs price LONGER than the naive product", () => {
    const legs: AccaLegForPricing[] = [
      { eventId: "e1", decimalOdds: marginalOdds(A), position: top3(A) },
      { eventId: "e1", decimalOdds: marginalOdds(B), position: top3(B) },
    ];
    const combined = combineAccaOdds(legs, new Map([["e1", matrix]]));
    const product = Math.round(marginalOdds(A) * marginalOdds(B) * 100) / 100;
    expect(combined).toBeCloseTo(probabilityToDecimalOdds(0.5), 2); // 1/0.5 = 2.0
    expect(combined).toBeGreaterThan(product);
  });

  it("a single position leg keeps its marginal odds", () => {
    const legs: AccaLegForPricing[] = [{ eventId: "e1", decimalOdds: marginalOdds(A), position: top3(A) }];
    expect(combineAccaOdds(legs, new Map([["e1", matrix]]))).toBeCloseTo(marginalOdds(A), 2);
  });

  it("multiplies independent legs straight in", () => {
    const legs: AccaLegForPricing[] = [
      { eventId: "e1", decimalOdds: marginalOdds(A), position: top3(A) },
      { eventId: "e1", decimalOdds: 2.0 }, // independent (e.g. a birdie leg)
    ];
    const combined = combineAccaOdds(legs, new Map([["e1", matrix]]));
    expect(combined).toBeCloseTo(Math.round(marginalOdds(A) * 2.0 * 100) / 100, 2);
  });

  it("pure independent / cross-event accas fall back to the product", () => {
    const legs: AccaLegForPricing[] = [
      { eventId: "e1", decimalOdds: 2.0 },
      { eventId: "e2", decimalOdds: 3.0 },
    ];
    expect(combineAccaOdds(legs, new Map())).toBeCloseTo(6.0, 2);
  });
});
