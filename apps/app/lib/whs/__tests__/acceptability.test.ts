import { describe, expect, it } from "vitest";
import {
  MIN_HOLES_9,
  MIN_HOLES_18,
  acceptabilityFor,
  isAuthorisedFormat,
  minHolesForAcceptance,
  rejectedReasonLabel,
  type AcceptabilityInput,
} from "../acceptability";

/**
 * These mirror `compute_handicap_round_result`'s `reason` CTE. The SQL is the
 * source of truth; this file exists so the rule-shaped edge cases are pinned
 * somewhere runnable, and so a change to one side without the other is loud.
 *
 * Standard: R&A Rules of Handicapping as applied within GB&I (v2.8). See
 * docs/whs-acceptable-scores.md.
 */

/** A round that counts: 18 holes, all played, strokeplay, rated tee, indexed player. */
function ok(overrides: Partial<AcceptabilityInput> = {}): AcceptabilityInput {
  return {
    holeCount: 18,
    holesStarted: 18,
    format: "strokeplay",
    isFinished: true,
    handicapIndex: 12.4,
    courseRating: 71.2,
    slopeRating: 128,
    hasHoleData: true,
    ...overrides,
  };
}

describe("minimum holes (G2.2(1)B)", () => {
  it("is 10 for an 18-hole score and 9 for a 9-hole score", () => {
    // The 2024 revision moved 18-hole from 14 to 10, and 9-hole from 7 to all 9.
    expect(MIN_HOLES_18).toBe(10);
    expect(MIN_HOLES_9).toBe(9);
    expect(minHolesForAcceptance(18)).toBe(10);
    expect(minHolesForAcceptance(9)).toBe(9);
  });

  it("rejects an 18-hole round below 10 holes, accepts from 10 up", () => {
    for (const h of [0, 1, 7, 8, 9]) {
      expect(acceptabilityFor(ok({ holesStarted: h }))).toEqual({
        accepted: false,
        rejectedReason: "min_holes_not_met_18",
      });
    }
    for (const h of [10, 11, 13, 14, 17, 18]) {
      expect(acceptabilityFor(ok({ holesStarted: h })).accepted).toBe(true);
    }
  });

  it("accepts the 10-13 hole band that the old 14-hole gate discarded", () => {
    for (const h of [10, 11, 12, 13]) {
      expect(acceptabilityFor(ok({ holesStarted: h })).accepted).toBe(true);
    }
  });

  it("requires all 9 holes on a 9-hole tee", () => {
    // The old gate let 7 and 8 through; GB&I requires the full measured 9.
    for (const h of [6, 7, 8]) {
      expect(acceptabilityFor(ok({ holeCount: 9, holesStarted: h }))).toEqual({
        accepted: false,
        rejectedReason: "min_holes_not_met_9",
      });
    }
    expect(acceptabilityFor(ok({ holeCount: 9, holesStarted: 9 })).accepted).toBe(true);
  });
});

describe("authorised formats (Rule 2.1a / G2.1a(1), G5.10)", () => {
  it("rejects shared-ball formats — the player doesn't play their own ball", () => {
    for (const format of ["scramble", "greensomes", "foursomes"]) {
      expect(isAuthorisedFormat(format)).toBe(false);
      expect(acceptabilityFor(ok({ format }))).toEqual({
        accepted: false,
        rejectedReason: "format_not_authorised",
      });
    }
  });

  it("accepts individual and four-ball formats", () => {
    for (const format of [
      "strokeplay",
      "stableford",
      "pairs_stableford",
      "team_strokeplay",
      "team_stableford",
      "team_bestball",
      "skins",
      "wolf",
    ]) {
      expect(isAuthorisedFormat(format)).toBe(true);
      expect(acceptabilityFor(ok({ format })).accepted).toBe(true);
    }
  });

  it("accepts matchplay — a deliberate divergence from GB&I", () => {
    // GB&I does not authorise match play (G3.3/1). CIAGA counts it anyway; see
    // docs/whs-acceptable-scores.md §4.1. If this test ever fails because
    // someone "fixed" it, that was a policy change and needs a full replay.
    expect(isAuthorisedFormat("matchplay")).toBe(true);
    expect(acceptabilityFor(ok({ format: "matchplay" })).accepted).toBe(true);
  });

  it("treats an unknown or missing format as authorised", () => {
    expect(isAuthorisedFormat(null)).toBe(true);
    expect(isAuthorisedFormat("some_future_format")).toBe(true);
  });
});

describe("course rating and hole data (Rule 2.1)", () => {
  it("rejects a tee with no course rating or slope", () => {
    expect(acceptabilityFor(ok({ courseRating: null })).rejectedReason).toBe("no_course_rating");
    expect(acceptabilityFor(ok({ slopeRating: null })).rejectedReason).toBe("no_course_rating");
    // Slope 0 would be a divide-by-zero, which used to yield a NULL
    // differential on a row still marked accepted.
    expect(acceptabilityFor(ok({ slopeRating: 0 })).rejectedReason).toBe("no_course_rating");
  });

  it("rejects a tee with no per-hole par", () => {
    expect(acceptabilityFor(ok({ hasHoleData: false })).rejectedReason).toBe("no_hole_data");
  });
});

describe("pre-index players (Rule 3.1a / G2.2(1)A)", () => {
  it("accepts a complete round from a player with no index", () => {
    expect(acceptabilityFor(ok({ handicapIndex: null })).accepted).toBe(true);
    expect(
      acceptabilityFor(ok({ handicapIndex: null, holeCount: 9, holesStarted: 9 })).accepted
    ).toBe(true);
  });

  it("rejects an incomplete round from a player with no index", () => {
    // The initial award is built from complete rounds only: without an index
    // there is no expected score to scale the missing holes up with.
    expect(acceptabilityFor(ok({ handicapIndex: null, holesStarted: 15 }))).toEqual({
      accepted: false,
      rejectedReason: "incomplete_round_no_index",
    });
  });

  it("accepts the same incomplete round once the player has an index", () => {
    expect(acceptabilityFor(ok({ handicapIndex: 20.1, holesStarted: 15 })).accepted).toBe(true);
  });
});

describe("reason ordering", () => {
  it("reports not-finished ahead of everything else", () => {
    expect(
      acceptabilityFor(ok({ isFinished: false, format: "scramble", holesStarted: 2 }))
        .rejectedReason
    ).toBe("round_not_finished");
  });

  it("reports an unauthorised format ahead of a short card", () => {
    expect(acceptabilityFor(ok({ format: "scramble", holesStarted: 3 })).rejectedReason).toBe(
      "format_not_authorised"
    );
  });

  it("derives accepted from the reason, so the two can never disagree", () => {
    // The old SQL tested `status = 'finished'` in rejected_reason but not in
    // accepted, so a live round read accepted = true alongside
    // rejected_reason = 'round_not_finished'.
    const live = acceptabilityFor(ok({ isFinished: false }));
    expect(live.accepted).toBe(false);
    expect(live.rejectedReason).toBe("round_not_finished");
  });
});

describe("rejectedReasonLabel", () => {
  it("returns null when the round counted", () => {
    expect(rejectedReasonLabel(null)).toBeNull();
    expect(rejectedReasonLabel(undefined)).toBeNull();
  });

  it("names the hole thresholds using the same constants as the gate", () => {
    expect(rejectedReasonLabel("min_holes_not_met_18")).toBe("Fewer than 10 holes played");
    expect(rejectedReasonLabel("min_holes_not_met_9")).toBe("Fewer than 9 holes played");
  });

  it("falls back for a reason it doesn't recognise", () => {
    expect(rejectedReasonLabel("something_new")).toBe("Not acceptable for handicapping");
  });
});
