import { describe, expect, it } from "vitest";
import {
  combineOpenLegProbability,
  effectiveParlayReturn,
  type OpenLegForPricing,
} from "@/lib/fantasy/parlayCashout";
import { computeCashoutValue } from "@/lib/fantasy/cashout";
import { MIN_JOINT_SUPPORT, type MatrixLeg } from "@/lib/fantasy/simulation/jointPricing";
import type { JointBundle } from "@/lib/fantasy/simulation/jointBundle";

const A = "A";
const B = "B";

function flat8(playerIds: string[], perPlayer: Record<string, number[]>): Int8Array {
  const simCount = perPlayer[playerIds[0]].length;
  const out = new Int8Array(playerIds.length * simCount);
  playerIds.forEach((id, pi) => out.set(perPlayer[id], pi * simCount));
  return out;
}

describe("effectiveParlayReturn", () => {
  const leg = (status: "open" | "won" | "lost" | "void", odds = 1): { status: typeof status; decimal_odds: number } => ({
    status,
    decimal_odds: odds,
  });

  it("non-joint: stake × won odds × open odds, voids at 1.0", () => {
    const parlay = { stake: 10, potential_return: 240, joint_priced: false };
    expect(
      effectiveParlayReturn(parlay, [leg("won", 2), leg("void", 4), leg("open", 3)])
    ).toBe(60);
  });

  it("non-joint, all legs still open: the full locked product", () => {
    const parlay = { stake: 10, potential_return: 100, joint_priced: false };
    expect(effectiveParlayReturn(parlay, [leg("open", 2.5), leg("open", 4)])).toBe(100);
  });

  it("joint-priced with no voids: the locked potential return", () => {
    const parlay = { stake: 10, potential_return: 87.5, joint_priced: true };
    expect(effectiveParlayReturn(parlay, [leg("won", 2), leg("open", 3)])).toBe(87.5);
  });

  it("joint-priced with a void leg: settlement voids the acca — best case is the stake", () => {
    const parlay = { stake: 10, potential_return: 87.5, joint_priced: true };
    expect(effectiveParlayReturn(parlay, [leg("void"), leg("open", 3)])).toBe(10);
  });

  it("rounds the non-joint product to 2dp", () => {
    const parlay = { stake: 3, potential_return: 0, joint_priced: false };
    expect(effectiveParlayReturn(parlay, [leg("open", 1.333), leg("open", 1.333)])).toBe(5.33);
  });
});

describe("combineOpenLegProbability", () => {
  const winA: MatrixLeg = { marketType: "outright_winner", params: {}, playerId: A, selectionKey: A };
  const birdiesA: MatrixLeg = { marketType: "birdies", params: { count: 2 }, playerId: A, selectionKey: "yes" };

  // An 8-iteration pattern tiled 25× (200 iterations) so the joint support
  // (75) clears MIN_JOINT_SUPPORT. Per tile: A wins {0,1,3,5}; A has 2+
  // birdies {0,1,5} — every birdie iteration is a win iteration.
  const tile = (pattern: number[]): number[] =>
    Array.from({ length: 25 }, () => pattern).flat();
  const bundle: JointBundle = {
    playerIds: [A, B],
    simCount: 200,
    positions: flat8([A, B], {
      A: tile([1, 1, 2, 1, 2, 1, 2, 2]),
      B: tile([2, 2, 1, 2, 1, 2, 1, 1]),
    }),
    birdies: flat8([A, B], {
      A: tile([2, 3, 0, 1, 0, 2, 1, 0]),
      B: tile([0, 0, 0, 0, 0, 0, 0, 0]),
    }),
  };
  const bundles = new Map([["e1", bundle]]);

  it("independent legs multiply", () => {
    const legs: OpenLegForPricing[] = [
      { eventId: "e1", probability: 0.5 },
      { eventId: "e1", probability: 0.4 },
    ];
    expect(combineOpenLegProbability(legs, bundles)).toBeCloseTo(0.2, 9);
  });

  it("a single expressible leg keeps its marginal snapshot probability", () => {
    const legs: OpenLegForPricing[] = [
      { eventId: "e1", probability: 0.5, matrixLeg: winA },
      { eventId: "e2", probability: 0.4 },
    ];
    expect(combineOpenLegProbability(legs, bundles)).toBeCloseTo(0.2, 9);
  });

  it("≥2 expressible legs on one event count the TRUE joint (win × birdies)", () => {
    const legs: OpenLegForPricing[] = [
      { eventId: "e1", probability: 4 / 8, matrixLeg: winA },
      { eventId: "e1", probability: 3 / 8, matrixLeg: birdiesA },
    ];
    // Joint = 3/8 (birdie iterations are all win iterations), not 0.1875.
    expect(combineOpenLegProbability(legs, bundles)).toBeCloseTo(3 / 8, 9);
  });

  it("missing bundle falls back to the marginal product (under-quotes, never over-pays)", () => {
    const legs: OpenLegForPricing[] = [
      { eventId: "eX", probability: 0.5, matrixLeg: winA },
      { eventId: "eX", probability: 0.375, matrixLeg: birdiesA },
    ];
    expect(combineOpenLegProbability(legs, new Map())).toBeCloseTo(0.1875, 9);
  });

  it("inexpressible legs (positions-only bundle) fall back to the product", () => {
    const bare = new Map([
      ["e1", { playerIds: [A, B], simCount: 8, positions: bundle.positions } as JointBundle],
    ]);
    const legs: OpenLegForPricing[] = [
      { eventId: "e1", probability: 0.5, matrixLeg: winA },
      { eventId: "e1", probability: 0.375, matrixLeg: birdiesA },
    ];
    expect(combineOpenLegProbability(legs, bare)).toBeCloseTo(0.1875, 9);
  });

  it("sub-support joints fall back to the product", () => {
    // 100 iterations, joint support = MIN_JOINT_SUPPORT − 1.
    const posA = Array.from({ length: 100 }, (_, i) => (i < 50 ? 1 : 2));
    const lowBundle: JointBundle = {
      playerIds: [A, B],
      simCount: 100,
      positions: flat8([A, B], { A: posA, B: posA.map((p) => (p === 1 ? 2 : 1)) }),
      birdies: flat8([A, B], {
        A: Array.from({ length: 100 }, (_, i) => (i < MIN_JOINT_SUPPORT - 1 ? 2 : 0)),
        B: new Array<number>(100).fill(0),
      }),
    };
    const legs: OpenLegForPricing[] = [
      { eventId: "e1", probability: 0.5, matrixLeg: winA },
      { eventId: "e1", probability: 0.19, matrixLeg: birdiesA },
    ];
    expect(combineOpenLegProbability(legs, new Map([["e1", lowBundle]]))).toBeCloseTo(
      0.5 * 0.19,
      9
    );
  });

  it("events multiply independently", () => {
    const legs: OpenLegForPricing[] = [
      { eventId: "e1", probability: 4 / 8, matrixLeg: winA },
      { eventId: "e1", probability: 3 / 8, matrixLeg: birdiesA },
      { eventId: "e2", probability: 0.5 },
    ];
    expect(combineOpenLegProbability(legs, bundles)).toBeCloseTo((3 / 8) * 0.5, 9);
  });
});

describe("acca cash-out quote composition", () => {
  it("value = P(open legs) × effective return × 0.90", () => {
    // 2-leg non-joint acca, stake 10, one leg won @2.0, one open @3.0.
    const effReturn = effectiveParlayReturn(
      { stake: 10, potential_return: 60, joint_priced: false },
      [
        { status: "won", decimal_odds: 2 },
        { status: "open", decimal_odds: 3 },
      ]
    );
    expect(effReturn).toBe(60);
    // Open leg repriced to p = 0.5 → fair 30, quoted 27.
    expect(computeCashoutValue(0.5, effReturn)).toBe(27);
  });
});
