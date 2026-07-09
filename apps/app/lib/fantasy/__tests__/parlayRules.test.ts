import { describe, expect, it } from "vitest";
import {
  combinedOdds,
  exclusivitySlot,
  findParlayViolation,
  isPositionFamily,
  marketAllowsMultiple,
  subjectKeysFor,
  type ParlayLeg,
} from "@/lib/fantasy/parlayRules";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const P3 = "33333333-3333-3333-3333-333333333333";

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
    for (const t of ["birdies", "gross_ou", "h2h", "eagle_count", "field_special"]) {
      expect(isPositionFamily(t)).toBe(false);
    }
  });

  it("allows multiple selections on top-N and wide ranges, not exclusive rows", () => {
    expect(marketAllowsMultiple({ market_type: "top_n", params: { n: 3 } })).toBe(true);
    expect(marketAllowsMultiple({ market_type: "finish_range", params: { from: 4, to: 6 } })).toBe(true);
    expect(marketAllowsMultiple({ market_type: "finish_range", params: { kind: "last" } })).toBe(false);
    expect(marketAllowsMultiple({ market_type: "outright_winner", params: {} })).toBe(false);
    expect(marketAllowsMultiple({ market_type: "birdies", params: {} })).toBe(false);
  });

  it("marks exclusive finishing slots", () => {
    expect(exclusivitySlot({ market_type: "outright_winner", params: {} }, P1)).toBe("winner");
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

describe("combinedOdds", () => {
  it("multiplies leg odds (void handling happens at settlement)", () => {
    expect(combinedOdds([2, 3])).toBe(6);
    expect(combinedOdds([1.5, 2, 4])).toBe(12);
    expect(combinedOdds([2.25])).toBe(2.25);
  });
});
