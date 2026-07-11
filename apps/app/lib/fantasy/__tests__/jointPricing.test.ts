import { describe, expect, it } from "vitest";
import {
  combineAcca,
  jointPositionProbability,
  type AccaLegForPricing,
  type JointMatrix,
  type MatrixLeg,
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

const top3 = (p: string): MatrixLeg => ({ marketType: "top_n", params: { n: 3 }, playerId: p, selectionKey: p });
const winner = (p: string): MatrixLeg => ({ marketType: "outright_winner", params: {}, playerId: p, selectionKey: p });
const h2h = (a: string, b: string, sel: "a" | "draw" | "b"): MatrixLeg => ({
  marketType: "h2h",
  params: { basis: "net" },
  playerId: a,
  opponentId: b,
  selectionKey: sel,
});

describe("jointPositionProbability", () => {
  it("a single top-3 leg equals its marginal", () => {
    expect(jointPositionProbability(matrix, [top3(A)])).toBeCloseTo(0.75, 9); // top-3 in 3 of 4
    expect(jointPositionProbability(matrix, [top3(D)])).toBeCloseTo(0.5, 9);
  });

  it("two top-3 legs are negatively correlated — joint below the product", () => {
    const joint = jointPositionProbability(matrix, [top3(A), top3(B)]);
    const product = 0.75 * 0.75;
    expect(joint).toBeCloseTo(0.5, 9);
    expect(joint!).toBeLessThan(product);
  });

  it("prices outright winner as P(position 1)", () => {
    expect(jointPositionProbability(matrix, [winner(A)])).toBeCloseTo(0.25, 9);
  });

  it("wooden spoon = finishing at the max present position", () => {
    const last = (p: string): MatrixLeg => ({ marketType: "finish_range", params: { kind: "last" }, playerId: p, selectionKey: p });
    // D is last (position 4) in iters 0 and 1 → 0.5.
    expect(jointPositionProbability(matrix, [last(D)])).toBeCloseTo(0.5, 9);
  });

  it("returns null (not 0) for a player missing from the matrix", () => {
    expect(jointPositionProbability(matrix, [top3(A), top3("Z")])).toBeNull();
  });

  it("returns null for round-scoped legs — the matrix is event-wide only", () => {
    const r1Winner: MatrixLeg = { marketType: "outright_winner", params: { round: 1 }, playerId: A, selectionKey: A };
    expect(jointPositionProbability(matrix, [r1Winner, top3(B)])).toBeNull();
  });

  it("prices h2h sides off relative positions", () => {
    // A beats B in iters 0 and 2 → 0.5 each way, no draws in this matrix.
    expect(jointPositionProbability(matrix, [h2h(A, B, "a")])).toBeCloseTo(0.5, 9);
    expect(jointPositionProbability(matrix, [h2h(A, B, "b")])).toBeCloseTo(0.5, 9);
    expect(jointPositionProbability(matrix, [h2h(A, B, "draw")])).toBeCloseTo(0, 9);
  });

  it("shared positions (competition-ranking ties) are draws", () => {
    const tied = buildMatrix([A, B, C], [
      { A: 1, B: 1, C: 3 },
      { A: 1, B: 2, C: 3 },
    ]);
    expect(jointPositionProbability(tied, [h2h(A, B, "draw")])).toBeCloseTo(0.5, 9);
    expect(jointPositionProbability(tied, [h2h(A, B, "a")])).toBeCloseTo(0.5, 9);
  });

  it("an absent player (pos 0) fails the h2h leg, mirroring void-not-win", () => {
    const absent = buildMatrix([A, B], [
      { A: 1, B: 0 },
      { A: 1, B: 2 },
    ]);
    expect(jointPositionProbability(absent, [h2h(A, B, "a")])).toBeCloseTo(0.5, 9);
  });

  it("THE fix: win + beat-someone collapses to the win probability", () => {
    // P(A wins) = 0.25; P(A beats B) = 0.5. Product says 0.125 — but A winning
    // implies A beat B, so the true joint IS 0.25.
    const joint = jointPositionProbability(matrix, [winner(A), h2h(A, B, "a")]);
    expect(joint).toBeCloseTo(0.25, 9);
  });

  it("win + LOSE to someone is impossible → 0", () => {
    expect(jointPositionProbability(matrix, [winner(A), h2h(A, B, "b")])).toBe(0);
  });
});

describe("combineAcca", () => {
  const marginalOdds = (p: string) =>
    probabilityToDecimalOdds(jointPositionProbability(matrix, [top3(p)])!);
  const matrices = new Map([["e1", matrix]]);

  it("two correlated top-3 legs price LONGER than the naive product", () => {
    const legs: AccaLegForPricing[] = [
      { eventId: "e1", decimalOdds: marginalOdds(A), matrixLeg: top3(A) },
      { eventId: "e1", decimalOdds: marginalOdds(B), matrixLeg: top3(B) },
    ];
    const { combinedOdds, jointPriced, infeasible } = combineAcca(legs, matrices);
    const product = Math.round(marginalOdds(A) * marginalOdds(B) * 100) / 100;
    expect(combinedOdds).toBeCloseTo(probabilityToDecimalOdds(0.5), 2); // 1/0.5 = 2.0
    expect(combinedOdds).toBeGreaterThan(product);
    expect(jointPriced).toBe(true);
    expect(infeasible).toBe(false);
  });

  it("win + h2h collapses to the win leg's price", () => {
    const winOdds = probabilityToDecimalOdds(0.25);
    const legs: AccaLegForPricing[] = [
      { eventId: "e1", decimalOdds: winOdds, matrixLeg: winner(A) },
      { eventId: "e1", decimalOdds: probabilityToDecimalOdds(0.5), matrixLeg: h2h(A, B, "a") },
    ];
    const { combinedOdds, jointPriced } = combineAcca(legs, matrices);
    expect(combinedOdds).toBeCloseTo(winOdds, 2);
    expect(jointPriced).toBe(true);
  });

  it("a contradictory joint (count 0) flags infeasible, never prices the cap", () => {
    const legs: AccaLegForPricing[] = [
      { eventId: "e1", decimalOdds: probabilityToDecimalOdds(0.25), matrixLeg: winner(A) },
      { eventId: "e1", decimalOdds: probabilityToDecimalOdds(0.5), matrixLeg: h2h(A, B, "b") },
    ];
    expect(combineAcca(legs, matrices).infeasible).toBe(true);
  });

  it("a single correlated leg keeps its marginal odds", () => {
    const legs: AccaLegForPricing[] = [{ eventId: "e1", decimalOdds: marginalOdds(A), matrixLeg: top3(A) }];
    const { combinedOdds, jointPriced } = combineAcca(legs, matrices);
    expect(combinedOdds).toBeCloseTo(marginalOdds(A), 2);
    expect(jointPriced).toBe(false);
  });

  it("multiplies independent legs straight in", () => {
    const legs: AccaLegForPricing[] = [
      { eventId: "e1", decimalOdds: marginalOdds(A), matrixLeg: top3(A) },
      { eventId: "e1", decimalOdds: 2.0 }, // independent (e.g. a birdie leg)
    ];
    const { combinedOdds } = combineAcca(legs, matrices);
    expect(combinedOdds).toBeCloseTo(Math.round(marginalOdds(A) * 2.0 * 100) / 100, 2);
  });

  it("pure independent / cross-event accas fall back to the product", () => {
    const legs: AccaLegForPricing[] = [
      { eventId: "e1", decimalOdds: 2.0 },
      { eventId: "e2", decimalOdds: 3.0 },
    ];
    const { combinedOdds, jointPriced } = combineAcca(legs, new Map());
    expect(combinedOdds).toBeCloseTo(6.0, 2);
    expect(jointPriced).toBe(false);
  });

  it("an unpriceable group (round-scoped leg) falls back to the product, not p=0", () => {
    const r1Winner: MatrixLeg = { marketType: "outright_winner", params: { round: 1 }, playerId: A, selectionKey: A };
    const legs: AccaLegForPricing[] = [
      { eventId: "e1", decimalOdds: 4.0, matrixLeg: r1Winner },
      { eventId: "e1", decimalOdds: marginalOdds(B), matrixLeg: top3(B) },
    ];
    const { combinedOdds, jointPriced, infeasible } = combineAcca(legs, matrices);
    expect(combinedOdds).toBeCloseTo(Math.round(4.0 * marginalOdds(B) * 100) / 100, 2);
    expect(jointPriced).toBe(false);
    expect(infeasible).toBe(false);
  });
});
