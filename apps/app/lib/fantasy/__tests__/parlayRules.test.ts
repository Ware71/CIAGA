import { describe, expect, it } from "vitest";
import {
  combinedOdds,
  exclusivitySlot,
  findParlayViolation,
  isCorrelatedFamily,
  isMatrixExpressible,
  isPositionFamily,
  marketAllowsMultiple,
  subjectKeysFor,
  type ParlayLeg,
} from "@/lib/fantasy/parlayRules";
import type { JointCapabilities } from "@/lib/fantasy/simulation/jointBundle";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const P3 = "33333333-3333-3333-3333-333333333333";
const P4 = "44444444-4444-4444-4444-444444444444";

/** A pre-extension row: positions matrix only. */
const positionsOnly = (): JointCapabilities => ({
  totals: false,
  birdies: false,
  eagles: false,
  rounds: new Set<number>(),
});
/** A fully-extended bundle (multi-round). */
const fullCaps = (rounds: number[] = [1, 2]): JointCapabilities => ({
  totals: true,
  birdies: true,
  eagles: true,
  rounds: new Set(rounds),
});
const capsE1 = (caps: JointCapabilities) => new Map([["e1", caps]]);

describe("subjectKeysFor", () => {
  it("player markets → the subject (and opponent for h2h)", () => {
    expect(
      subjectKeysFor(
        { market_type: "birdies", subject_profile_id: P1, opponent_profile_id: null },
        "yes"
      )
    ).toEqual([P1]);
    expect(
      subjectKeysFor(
        { market_type: "h2h", subject_profile_id: P1, opponent_profile_id: P2 },
        "a"
      ).sort()
    ).toEqual([P1, P2].sort());
  });

  it("field markets → the selected player", () => {
    expect(
      subjectKeysFor(
        { market_type: "outright_winner", subject_profile_id: null, opponent_profile_id: null },
        P1
      )
    ).toEqual([P1]);
  });

  it("field specials share one identity per event", () => {
    expect(
      subjectKeysFor(
        { market_type: "field_special", subject_profile_id: null, opponent_profile_id: null },
        "yes"
      )
    ).toEqual(["field"]);
  });
});

describe("isPositionFamily / marketAllowsMultiple / exclusivitySlot", () => {
  it("classifies the finishing-position family", () => {
    for (const t of ["outright_winner", "top_n", "finish_position", "finish_range"]) {
      expect(isPositionFamily(t)).toBe(true);
    }
    for (const t of ["birdies", "score_total", "h2h", "eagle_count", "field_special"]) {
      expect(isPositionFamily(t)).toBe(false);
    }
  });

  it("allows multiple selections on top-N, wide ranges and hole scores, not exclusive rows", () => {
    expect(marketAllowsMultiple({ market_type: "top_n", params: { n: 3 } })).toBe(true);
    expect(marketAllowsMultiple({ market_type: "finish_range", params: { from: 4, to: 6 } })).toBe(true);
    expect(marketAllowsMultiple({ market_type: "hole_score", params: { outcome: "birdie_or_better" } })).toBe(true);
    expect(marketAllowsMultiple({ market_type: "finish_range", params: { kind: "last" } })).toBe(false);
    expect(marketAllowsMultiple({ market_type: "outright_winner", params: {} })).toBe(false);
    expect(marketAllowsMultiple({ market_type: "birdies", params: {} })).toBe(false);
    expect(marketAllowsMultiple({ market_type: "score_total", params: {} })).toBe(false);
  });

  it("marks exclusive finishing slots, per round for round winners", () => {
    expect(exclusivitySlot({ market_type: "outright_winner", params: {} }, P1)).toBe("winner");
    expect(exclusivitySlot({ market_type: "outright_winner", params: { round: 2 } }, P1)).toBe("winner:r2");
    expect(exclusivitySlot({ market_type: "finish_range", params: { kind: "last" } }, P1)).toBe("last");
    expect(exclusivitySlot({ market_type: "finish_position" }, "2")).toBe("pos:2");
    expect(exclusivitySlot({ market_type: "top_n", params: { n: 3 } }, P1)).toBeNull();
    expect(exclusivitySlot({ market_type: "finish_range", params: { from: 4, to: 6 } }, P1)).toBeNull();
  });
});

describe("findParlayViolation", () => {
  const top3 = (player: string): ParlayLeg => ({
    eventId: "e1",
    marketId: "m-top3",
    marketType: "top_n",
    params: { n: 3 },
    subjectKeys: [player],
    selectionKey: player,
  });
  const birdie = (player: string): ParlayLeg => ({
    eventId: "e1",
    marketId: `m-birdie-${player}`,
    marketType: "birdies",
    params: {},
    subjectKeys: [player],
    selectionKey: "yes",
  });
  const winner = (player: string): ParlayLeg => ({
    eventId: "e1",
    marketId: "m-winner",
    marketType: "outright_winner",
    params: {},
    subjectKeys: [player],
    selectionKey: player,
  });

  it("allows two different players in the same top-3 market (joint-priced)", () => {
    expect(findParlayViolation([top3(P1), top3(P2)])).toBeNull();
  });

  it("allows the user's example: X,Y top-3 + X,Y,Z to birdie", () => {
    expect(
      findParlayViolation([
        top3(P1),
        top3(P2),
        birdie(P1),
        birdie(P2),
        birdie(P3),
      ])
    ).toBeNull();
  });

  it("blocks the redundant winner + top-3 for the same player", () => {
    expect(findParlayViolation([winner(P1), top3(P1)])).not.toBeNull();
  });

  it("blocks two outright winners (mutually exclusive)", () => {
    expect(findParlayViolation([winner(P1), winner(P2)])).not.toBeNull();
  });

  it("blocks two players finishing exactly the same position", () => {
    const exactly = (player: string): ParlayLeg => ({
      eventId: "e1",
      marketId: `m-fp-${player}`,
      marketType: "finish_position",
      params: { maxPos: 8 },
      subjectKeys: [player],
      selectionKey: "2",
    });
    expect(findParlayViolation([exactly(P1), exactly(P2)])).not.toBeNull();
  });

  it("allows two players at different exact positions", () => {
    const exactly = (player: string, pos: string): ParlayLeg => ({
      eventId: "e1",
      marketId: `m-fp-${player}`,
      marketType: "finish_position",
      params: { maxPos: 8 },
      subjectKeys: [player],
      selectionKey: pos,
    });
    expect(findParlayViolation([exactly(P1, "2"), exactly(P2, "3")])).toBeNull();
  });

  it("blocks a duplicate exact selection", () => {
    expect(findParlayViolation([top3(P1), top3(P1)])).not.toBeNull();
  });

  it("allows a player's top-3 alongside their own birdie leg (independent)", () => {
    expect(findParlayViolation([top3(P1), birdie(P1)])).toBeNull();
  });
});

describe("findParlayViolation — new correctness rules", () => {
  const basis = { eventRankingBasis: "net" as const };
  const win = (player: string): ParlayLeg => ({
    eventId: "e1",
    marketId: "m-winner",
    marketType: "outright_winner",
    params: {},
    subjectKeys: [player],
    selectionKey: player,
    ...basis,
  });
  const topN = (player: string, marketId = "m-top3"): ParlayLeg => ({
    eventId: "e1",
    marketId,
    marketType: "top_n",
    params: { n: 3 },
    subjectKeys: [player],
    selectionKey: player,
    ...basis,
  });
  const spoon = (player: string): ParlayLeg => ({
    eventId: "e1",
    marketId: "m-spoon",
    marketType: "finish_range",
    params: { kind: "last" },
    subjectKeys: [player],
    selectionKey: player,
    ...basis,
  });
  const h2h = (
    a: string,
    b: string,
    sel: "a" | "draw" | "b",
    params: Record<string, unknown> = { basis: "net" }
  ): ParlayLeg => ({
    eventId: "e1",
    marketId: `m-h2h-${a}-${b}-${JSON.stringify(params)}`,
    marketType: "h2h",
    params,
    subjectKeys: [a, b],
    selectionKey: sel,
    subjectProfileId: a,
    opponentProfileId: b,
    ...basis,
  });
  const hole = (player: string, outcome: string, sel: string): ParlayLeg => ({
    eventId: "e1",
    marketId: `m-hole-${player}-${outcome}`,
    marketType: "hole_score",
    params: { outcome },
    subjectKeys: [player],
    selectionKey: sel,
    ...basis,
  });

  it("blocks a second selection on a non-co-occurrable market", () => {
    const uo = (sel: string): ParlayLeg => ({
      eventId: "e1",
      marketId: "m-total-p1",
      marketType: "score_total",
      params: { basis: "gross" },
      subjectKeys: [P1],
      selectionKey: sel,
      ...basis,
    });
    expect(findParlayViolation([uo("u_75"), uo("o_75")])).not.toBeNull();
  });

  it("allows birdie-or-better on two different holes of one market", () => {
    expect(
      findParlayViolation([hole(P1, "birdie_or_better", "r1_h3"), hole(P1, "birdie_or_better", "r1_h7")])
    ).toBeNull();
  });

  it("blocks opposite outcomes on the same hole", () => {
    expect(
      findParlayViolation([hole(P1, "birdie_or_better", "r1_h3"), hole(P1, "bogey_or_worse", "r1_h3")])
    ).not.toBeNull();
    expect(
      findParlayViolation([hole(P1, "birdie_or_better", "r1_h3"), hole(P1, "bogey_or_worse", "r1_h7")])
    ).toBeNull();
  });

  it("Hall feasibility: no 4 players all top-3, winner counts against the slots", () => {
    expect(findParlayViolation([topN(P1), topN(P2), topN(P3)])).toBeNull();
    expect(findParlayViolation([topN(P1), topN(P2), topN(P3), topN(P4)])).not.toBeNull();
    expect(findParlayViolation([win(P1), topN(P2), topN(P3)])).toBeNull();
    expect(findParlayViolation([win(P1), topN(P2), topN(P3), topN(P4)])).not.toBeNull();
  });

  it("allows win + h2h on the same player when the matrix can price it", () => {
    expect(findParlayViolation([win(P1), h2h(P1, P2, "a")])).toBeNull();
  });

  it("off-basis / round-scoped h2h overlap: allowed with totals, blocked on positions-only rows", () => {
    // No caps (client pre-check) → optimistic: totals express any-basis h2h.
    expect(findParlayViolation([win(P1), h2h(P1, P2, "a", { basis: "gross" })])).toBeNull();
    expect(findParlayViolation([win(P1), h2h(P1, P2, "a", { basis: "net", round: 1 })])).toBeNull();
    // Server re-check with extended caps → still allowed (joint-priced).
    expect(
      findParlayViolation([win(P1), h2h(P1, P2, "a", { basis: "gross" })], capsE1(fullCaps()))
    ).toBeNull();
    // Pre-extension positions-only row → blocked, exactly the old behaviour.
    expect(
      findParlayViolation([win(P1), h2h(P1, P2, "a", { basis: "gross" })], capsE1(positionsOnly()))
    ).not.toBeNull();
    expect(
      findParlayViolation(
        [win(P1), h2h(P1, P2, "a", { basis: "net", round: 1 })],
        capsE1(positionsOnly())
      )
    ).not.toBeNull();
    // Round-scoped h2h needs that round retained, not just totals.
    expect(
      findParlayViolation(
        [win(P1), h2h(P1, P2, "a", { basis: "net", round: 3 })],
        capsE1(fullCaps([1, 2]))
      )
    ).not.toBeNull();
  });

  it("basis-unknown h2h overlap (stale slip legs) is blocked on positions-only rows", () => {
    const leg = h2h(P1, P2, "a");
    delete (leg as Partial<ParlayLeg>).eventRankingBasis;
    // Positions-only row can't tell whether the h2h basis matches → blocked.
    expect(findParlayViolation([win(P1), { ...leg }], capsE1(positionsOnly()))).not.toBeNull();
    // With totals the basis needn't match the ranking basis → allowed.
    expect(findParlayViolation([win(P1), { ...leg }], capsE1(fullCaps()))).toBeNull();
  });

  it("stableford events joint-price h2h off totals; blocked on positions-only rows", () => {
    const w = { ...win(P1), eventRankingBasis: "stableford" as const };
    const m = { ...h2h(P1, P2, "a"), eventRankingBasis: "stableford" as const };
    expect(findParlayViolation([w, m], capsE1(fullCaps()))).toBeNull();
    expect(findParlayViolation([w, m], capsE1(positionsOnly()))).not.toBeNull();
  });

  it("own-score legs joined the correlated family", () => {
    for (const t of ["birdies", "eagle_count", "score_total", "score_band", "h2h"]) {
      expect(isCorrelatedFamily(t)).toBe(true);
    }
    for (const t of ["hole_score", "field_special"]) {
      expect(isCorrelatedFamily(t)).toBe(false);
    }
  });

  it("win + own birdies overlap: allowed when the bundle retains counts, blocked otherwise", () => {
    const birdie2: ParlayLeg = {
      eventId: "e1",
      marketId: "m-birdies-p1",
      marketType: "birdies",
      params: { count: 2 },
      subjectKeys: [P1],
      selectionKey: "yes",
      ...basis,
    };
    expect(findParlayViolation([win(P1), birdie2])).toBeNull(); // optimistic client
    expect(findParlayViolation([win(P1), birdie2], capsE1(fullCaps()))).toBeNull();
    expect(findParlayViolation([win(P1), birdie2], capsE1(positionsOnly()))).not.toBeNull();
  });

  it("1+ and 2+ birdies on one player: joint-priced with counts, blocked without", () => {
    const b = (count: number): ParlayLeg => ({
      eventId: "e1",
      marketId: `m-birdies-${count}`,
      marketType: "birdies",
      params: { count },
      subjectKeys: [P1],
      selectionKey: "yes",
      ...basis,
    });
    expect(findParlayViolation([b(1), b(2)], capsE1(fullCaps()))).toBeNull();
    expect(findParlayViolation([b(1), b(2)], capsE1(positionsOnly()))).not.toBeNull();
  });

  it("isMatrixExpressible per capability", () => {
    const netBasis = { eventRankingBasis: "net" as const };
    const full = fullCaps([1, 2]);
    const bare = positionsOnly();
    // Position family event-wide works on any row.
    expect(isMatrixExpressible({ marketType: "top_n", params: { n: 3 }, ...netBasis }, bare)).toBe(true);
    // Round winner needs that round's totals.
    expect(
      isMatrixExpressible({ marketType: "outright_winner", params: { round: 2 }, ...netBasis }, full)
    ).toBe(true);
    expect(
      isMatrixExpressible({ marketType: "outright_winner", params: { round: 2 }, ...netBasis }, bare)
    ).toBe(false);
    // Own-score families need their arrays.
    expect(isMatrixExpressible({ marketType: "eagle_count", params: {}, ...netBasis }, full)).toBe(true);
    expect(isMatrixExpressible({ marketType: "eagle_count", params: {}, ...netBasis }, bare)).toBe(false);
    expect(
      isMatrixExpressible({ marketType: "score_total", params: { basis: "gross" }, ...netBasis }, full)
    ).toBe(true);
    expect(
      isMatrixExpressible({ marketType: "score_band", params: { basis: "net" }, ...netBasis }, bare)
    ).toBe(false);
    // Round-scoped birdies price off the round's birdie array.
    expect(
      isMatrixExpressible({ marketType: "birdies", params: { count: 1, round: 1 }, ...netBasis }, full)
    ).toBe(true);
    expect(
      isMatrixExpressible({ marketType: "birdies", params: { count: 1, round: 1 }, ...netBasis }, bare)
    ).toBe(false);
    // Ranking-basis h2h stays expressible on a bare row (positions path).
    expect(
      isMatrixExpressible({ marketType: "h2h", params: { basis: "net" }, ...netBasis }, bare)
    ).toBe(true);
  });

  it("a lone inexpressible h2h leg is fine — only overlaps need the matrix", () => {
    const birdie: ParlayLeg = {
      eventId: "e1",
      marketId: "m-birdie",
      marketType: "birdies",
      params: {},
      subjectKeys: [P3],
      selectionKey: "yes",
      ...basis,
    };
    expect(findParlayViolation([h2h(P1, P2, "a", { basis: "gross" }), birdie])).toBeNull();
  });

  it("allows two expressible h2h legs sharing a player (joint-priced)", () => {
    expect(findParlayViolation([h2h(P1, P2, "a"), h2h(P1, P3, "a")])).toBeNull();
  });

  it("contradiction: X beats Y + Y to win can never land", () => {
    expect(findParlayViolation([h2h(P1, P2, "a"), win(P2)])).not.toBeNull();
    expect(findParlayViolation([h2h(P1, P2, "b"), win(P1)])).not.toBeNull();
  });

  it("contradiction: X beats Y + X wooden spoon can never land", () => {
    expect(findParlayViolation([h2h(P1, P2, "a"), spoon(P1)])).not.toBeNull();
  });

  it("no contradiction for the draw or for the winner's own h2h side", () => {
    expect(findParlayViolation([h2h(P1, P2, "draw"), win(P2)])).toBeNull();
    expect(findParlayViolation([h2h(P1, P2, "a"), win(P1)])).toBeNull();
  });
});

describe("combinedOdds", () => {
  it("multiplies leg odds (void handling happens at settlement)", () => {
    expect(combinedOdds([2, 3])).toBe(6);
    expect(combinedOdds([1.5, 2, 4])).toBe(12);
    expect(combinedOdds([2.25])).toBe(2.25);
  });

  it("clamps at MAX_COMBINED_ODDS (numeric(12,2) guard)", () => {
    expect(combinedOdds([201, 201, 201])).toBe(10000);
  });
});
