import { describe, expect, it } from "vitest";
import {
  combineAcca,
  jointPositionProbability,
  jointProbability,
  MIN_JOINT_SUPPORT,
  type AccaLegForPricing,
  type JointMatrix,
  type MatrixLeg,
} from "@/lib/fantasy/simulation/jointPricing";
import type { JointBundle } from "@/lib/fantasy/simulation/jointBundle";
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

  it("an unpriceable group (round-scoped leg on a positions-only row) falls back to the product, not p=0", () => {
    // `matrix` has no round arrays — the pre-extension row shape.
    const r1Winner: MatrixLeg = { marketType: "outright_winner", params: { round: 1, resolvedBasis: "net" }, playerId: A, selectionKey: A };
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

// ─── Extended bundles: cross-family joint pricing ───────────────────────────

function flat8(playerIds: string[], perPlayer: Record<string, number[]>): Int8Array {
  const simCount = perPlayer[playerIds[0]].length;
  const out = new Int8Array(playerIds.length * simCount);
  playerIds.forEach((id, pi) => out.set(perPlayer[id], pi * simCount));
  return out;
}

function flat16(playerIds: string[], perPlayer: Record<string, number[]>): Int16Array {
  const simCount = perPlayer[playerIds[0]].length;
  const out = new Int16Array(playerIds.length * simCount);
  playerIds.forEach((id, pi) => out.set(perPlayer[id], pi * simCount));
  return out;
}

describe("jointProbability — extended bundles", () => {
  // Two players, 8 iterations, hand-checkable.
  const ids = [A, B];
  const grossA = [70, 69, 74, 71, 73, 70, 72, 75];
  const grossB = [72, 71, 70, 73, 69, 74, 70, 71];
  const bundle: JointBundle = {
    playerIds: ids,
    simCount: 8,
    positions: flat8(ids, { A: [1, 1, 2, 1, 2, 1, 2, 2], B: [2, 2, 1, 2, 1, 2, 1, 1] }),
    birdies: flat8(ids, { A: [2, 3, 0, 1, 0, 2, 1, 0], B: [1, 0, 2, 0, 1, 0, 1, 2] }),
    eagles: flat8(ids, { A: [1, 0, 0, 2, 0, 0, 0, 0], B: [0, 0, 0, 0, 0, 0, 0, 0] }),
    grossTotals: flat16(ids, { A: grossA, B: grossB }),
    netTotals: flat16(ids, {
      A: grossA.map((v) => v - 5),
      B: grossB.map((v) => v - 8),
    }),
    rounds: {
      1: {
        gross: flat16(ids, { A: [35, 34, 35, 36, 36, 35, 36, 38], B: [36, 35, 35, 37, 34, 37, 35, 35] }),
        net: flat16(ids, { A: [33, 32, 33, 34, 34, 33, 34, 36], B: [32, 31, 31, 33, 30, 33, 31, 31] }),
        birdies: flat8(ids, { A: [1, 2, 0, 1, 0, 1, 0, 0], B: [1, 0, 1, 0, 1, 0, 0, 1] }),
      },
    },
  };
  const winA: MatrixLeg = { marketType: "outright_winner", params: {}, playerId: A, selectionKey: A };
  const birdiesA = (count: number, round?: number): MatrixLeg => ({
    marketType: "birdies",
    params: round != null ? { count, round } : { count },
    playerId: A,
    selectionKey: "yes",
  });

  it("THE user case: win × 2+ birdies joint is far above the naive product", () => {
    // P(A wins) = 4/8; P(A 2+ birdies) = 3/8 (iters 0,1,5) — all three are
    // win iterations, so the true joint IS 3/8, double the 0.1875 product.
    const joint = jointProbability(bundle, [winA, birdiesA(2)]);
    expect(joint!.p).toBeCloseTo(3 / 8, 9);
    expect(joint!.support).toBe(3);
    expect(joint!.p).toBeGreaterThan((4 / 8) * (3 / 8));
  });

  it("eagle_count joins the joint", () => {
    const eagle1: MatrixLeg = { marketType: "eagle_count", params: { count: 1 }, playerId: A, selectionKey: "yes" };
    expect(jointProbability(bundle, [eagle1])!.p).toBeCloseTo(2 / 8, 9); // iters 0,3
    expect(jointProbability(bundle, [winA, eagle1])!.p).toBeCloseTo(2 / 8, 9); // both are win iters
  });

  it("score_total u/e/o counted straight off the retained totals", () => {
    const st = (sel: string): MatrixLeg => ({
      marketType: "score_total",
      params: { basis: "gross" },
      playerId: A,
      selectionKey: sel,
    });
    expect(jointProbability(bundle, [st("u_71")])!.p).toBeCloseTo(3 / 8, 9);
    expect(jointProbability(bundle, [st("e_71")])!.p).toBeCloseTo(1 / 8, 9);
    expect(jointProbability(bundle, [st("o_71")])!.p).toBeCloseTo(4 / 8, 9);
    // Win ∩ under-71 = iters {0,1,5}.
    expect(jointProbability(bundle, [winA, st("u_71")])!.p).toBeCloseTo(3 / 8, 9);
  });

  it("score_band tests the retained totals against the band bounds", () => {
    const band: MatrixLeg = {
      marketType: "score_band",
      params: { basis: "gross", bands: [{ key: "le_70", lo: null, hi: 70 }, { key: "71_74", lo: 71, hi: 74 }] },
      playerId: A,
      selectionKey: "le_70",
    };
    expect(jointProbability(bundle, [band])!.p).toBeCloseTo(3 / 8, 9); // 70,69,70
  });

  it("h2h prices BOTH bases off the totals — no ranking-basis restriction", () => {
    const h2hBasis = (basis: string, sel: "a" | "b" | "draw"): MatrixLeg => ({
      marketType: "h2h",
      params: { basis },
      playerId: A,
      opponentId: B,
      selectionKey: sel,
    });
    expect(jointProbability(bundle, [h2hBasis("gross", "a")])!.p).toBeCloseTo(4 / 8, 9);
    expect(jointProbability(bundle, [h2hBasis("net", "a")])!.p).toBeCloseTo(1 / 8, 9); // only iter 5
    expect(jointProbability(bundle, [h2hBasis("net", "draw")])!.p).toBeCloseTo(0, 9);
  });

  it("round winner: ties all win, counted from the round totals", () => {
    const r1 = (p: string): MatrixLeg => ({
      marketType: "outright_winner",
      params: { round: 1, resolvedBasis: "gross" },
      playerId: p,
      selectionKey: p,
    });
    expect(jointProbability(bundle, [r1(A)])!.p).toBeCloseTo(5 / 8, 9); // wins 0,1,3,5 + tie 2
    expect(jointProbability(bundle, [r1(B)])!.p).toBeCloseTo(4 / 8, 9); // wins 4,6,7 + tie 2
    // Joint "both win round 1" = the dead-heat iteration only.
    expect(jointProbability(bundle, [r1(A), r1(B)])!.p).toBeCloseTo(1 / 8, 9);
  });

  it("round-scoped birdies read the round's counts", () => {
    expect(jointProbability(bundle, [birdiesA(2, 1)])!.p).toBeCloseTo(1 / 8, 9); // iter 1 only
    expect(jointProbability(bundle, [birdiesA(1, 1)])!.p).toBeCloseTo(4 / 8, 9);
  });

  it("returns null when the bundle lacks the needed arrays (old rows)", () => {
    const bare: JointBundle = { playerIds: ids, simCount: 8, positions: bundle.positions };
    expect(jointProbability(bare, [winA, birdiesA(2)])).toBeNull();
    expect(
      jointProbability(bare, [
        { marketType: "score_total", params: { basis: "gross" }, playerId: A, selectionKey: "u_71" },
      ])
    ).toBeNull();
  });
});

describe("combineAcca — MIN_JOINT_SUPPORT", () => {
  // 100 iterations; A wins the first `winIters`, birdies land in `birdieIters`.
  const countsBundle = (winIters: number, birdieIters: [number, number]): JointBundle => {
    const posA = Array.from({ length: 100 }, (_, i) => (i < winIters ? 1 : 2));
    const posB = posA.map((p) => (p === 1 ? 2 : 1));
    const birdA = Array.from({ length: 100 }, (_, i) =>
      i >= birdieIters[0] && i < birdieIters[1] ? 1 : 0
    );
    return {
      playerIds: [A, B],
      simCount: 100,
      positions: flat8([A, B], { A: posA, B: posB }),
      birdies: flat8([A, B], { A: birdA, B: birdA }),
    };
  };
  const legs: AccaLegForPricing[] = [
    { eventId: "e1", decimalOdds: 4.0, matrixLeg: { marketType: "outright_winner", params: {}, playerId: A, selectionKey: A } },
    { eventId: "e1", decimalOdds: 5.0, matrixLeg: { marketType: "birdies", params: { count: 1 }, playerId: A, selectionKey: "yes" } },
  ];

  it("support at the threshold prices normally", () => {
    const price = combineAcca(legs, new Map([["e1", countsBundle(50, [0, MIN_JOINT_SUPPORT])]]));
    expect(price.jointPriced).toBe(true);
    expect(price.lowSupport).toBe(false);
    expect(price.infeasible).toBe(false);
  });

  it("support just below the threshold flags lowSupport", () => {
    const price = combineAcca(legs, new Map([["e1", countsBundle(50, [0, MIN_JOINT_SUPPORT - 1])]]));
    expect(price.jointPriced).toBe(true);
    expect(price.lowSupport).toBe(true);
    expect(price.infeasible).toBe(false);
  });

  it("zero support stays infeasible, not lowSupport", () => {
    // Birdies only land in iterations A doesn't win.
    const price = combineAcca(legs, new Map([["e1", countsBundle(50, [60, 90])]]));
    expect(price.infeasible).toBe(true);
    expect(price.lowSupport).toBe(false);
  });
});
