import { describe, expect, it } from "vitest";
import { findSelfRestriction } from "@/lib/fantasy/selfRestriction";

const ME = "11111111-1111-1111-1111-111111111111";
const THEM = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";

const market = (
  market_type: string,
  params: Record<string, unknown> | null = null,
  subject: string | null = ME,
  opponent: string | null = null
) => ({
  market_type,
  subject_profile_id: subject,
  opponent_profile_id: opponent,
  params,
});

describe("findSelfRestriction", () => {
  it("h2h: only your own side is backable when you're in the matchup", () => {
    const asSubject = market("h2h", { basis: "net" }, ME, THEM);
    expect(findSelfRestriction(ME, asSubject, "a")).toBeNull();
    expect(findSelfRestriction(ME, asSubject, "b")).not.toBeNull();
    expect(findSelfRestriction(ME, asSubject, "draw")).not.toBeNull();

    const asOpponent = market("h2h", { basis: "net" }, THEM, ME);
    expect(findSelfRestriction(ME, asOpponent, "b")).toBeNull();
    expect(findSelfRestriction(ME, asOpponent, "a")).not.toBeNull();
    expect(findSelfRestriction(ME, asOpponent, "draw")).not.toBeNull();
  });

  it("h2h: someone else's matchup is fully open", () => {
    const theirs = market("h2h", { basis: "net" }, THEM, OTHER);
    for (const sel of ["a", "draw", "b"]) {
      expect(findSelfRestriction(ME, theirs, sel)).toBeNull();
    }
  });

  it("score totals: Under on yourself is fine, Over and Exactly are not", () => {
    const m = market("score_total", { basis: "gross" });
    expect(findSelfRestriction(ME, m, "u_82")).toBeNull();
    expect(findSelfRestriction(ME, m, "o_82")).not.toBeNull();
    expect(findSelfRestriction(ME, m, "e_82")).not.toBeNull();
    expect(findSelfRestriction(ME, market("score_total", { basis: "gross" }, THEM), "o_82")).toBeNull();
  });

  it("score bands: every band on yourself is blocked", () => {
    const m = market("score_band", { basis: "gross" });
    for (const sel of ["le_78", "79_82", "ge_87"]) {
      expect(findSelfRestriction(ME, m, sel)).not.toBeNull();
    }
    expect(findSelfRestriction(ME, market("score_band", { basis: "gross" }, THEM), "le_78")).toBeNull();
  });

  it("hole scores: bogey-or-worse on yourself is blocked, birdie-or-better is fine", () => {
    expect(
      findSelfRestriction(ME, market("hole_score", { outcome: "bogey_or_worse" }), "r1_h3")
    ).not.toBeNull();
    expect(
      findSelfRestriction(ME, market("hole_score", { outcome: "birdie_or_better" }), "r1_h3")
    ).toBeNull();
    expect(
      findSelfRestriction(ME, market("hole_score", { outcome: "bogey_or_worse" }, THEM), "r1_h3")
    ).toBeNull();
  });

  it("finishing ranges: wooden spoon and mid/bottom ranges on yourself are blocked", () => {
    expect(
      findSelfRestriction(ME, market("finish_range", { kind: "last" }, null), ME)
    ).not.toBeNull();
    expect(
      findSelfRestriction(ME, market("finish_range", { from: 4, to: 6 }, null), ME)
    ).not.toBeNull();
    expect(findSelfRestriction(ME, market("finish_range", { from: 1, to: 3 }, null), ME)).toBeNull();
    expect(findSelfRestriction(ME, market("finish_range", { kind: "last" }, null), THEM)).toBeNull();
  });

  it("exact finish: only 1st is backable on yourself", () => {
    const m = market("finish_position", { maxPos: 8 });
    expect(findSelfRestriction(ME, m, "1")).toBeNull();
    expect(findSelfRestriction(ME, m, "2")).not.toBeNull();
    expect(findSelfRestriction(ME, m, "8")).not.toBeNull();
    expect(findSelfRestriction(ME, market("finish_position", { maxPos: 8 }, THEM), "5")).toBeNull();
  });

  it("positive markets stay open on yourself", () => {
    expect(findSelfRestriction(ME, market("birdies", { count: 2 }), "yes")).toBeNull();
    expect(findSelfRestriction(ME, market("eagle_count", { count: 1 }), "yes")).toBeNull();
    expect(findSelfRestriction(ME, market("outright_winner", {}, null), ME)).toBeNull();
    expect(findSelfRestriction(ME, market("top_n", { n: 3 }, null), ME)).toBeNull();
    expect(findSelfRestriction(ME, market("field_special", { kind: "hio" }, null), "yes")).toBeNull();
  });

  it("no bettor id → no restrictions (unauthenticated board render)", () => {
    expect(findSelfRestriction(null, market("score_band", { basis: "gross" }), "ge_87")).toBeNull();
  });
});
