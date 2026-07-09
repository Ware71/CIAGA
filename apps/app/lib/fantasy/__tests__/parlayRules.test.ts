import { describe, expect, it } from "vitest";
import { combinedOdds, findCorrelation, subjectKeysFor } from "@/lib/fantasy/parlayRules";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";

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

describe("findCorrelation", () => {
  it("blocks two legs on the same player in the same event", () => {
    expect(
      findCorrelation([
        { eventId: "e1", subjectKeys: [P1] },
        { eventId: "e1", subjectKeys: [P1] },
      ])
    ).toBe(P1);
  });

  it("allows the same player across different events", () => {
    expect(
      findCorrelation([
        { eventId: "e1", subjectKeys: [P1] },
        { eventId: "e2", subjectKeys: [P1] },
      ])
    ).toBeNull();
  });

  it("h2h legs correlate through either participant", () => {
    expect(
      findCorrelation([
        { eventId: "e1", subjectKeys: [P1, P2] },
        { eventId: "e1", subjectKeys: [P2] },
      ])
    ).toBe(P2);
  });

  it("different players in one event combine fine", () => {
    expect(
      findCorrelation([
        { eventId: "e1", subjectKeys: [P1] },
        { eventId: "e1", subjectKeys: [P2] },
      ])
    ).toBeNull();
  });
});

describe("combinedOdds", () => {
  it("multiplies leg odds (void handling happens at settlement)", () => {
    expect(combinedOdds([2, 3])).toBe(6);
    expect(combinedOdds([1.5, 2, 4])).toBe(12);
    expect(combinedOdds([2.25])).toBe(2.25);
  });
});
