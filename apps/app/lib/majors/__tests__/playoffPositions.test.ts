import { describe, expect, it } from "vitest";
import { resolvedPositionsFromPlayoff } from "@/lib/majors/playoffPoints";

const WARE = "ware-id";
const LINEHAN = "linehan-id";
const JACK = "jack-id";

/**
 * Only the TROPHY is decided by a playoff. These positions feed the outright
 * winner market; position/top-N/range markets keep settling on the tied rank.
 */
describe("resolvedPositionsFromPlayoff", () => {
  const completed = {
    status: "completed",
    winner_profile_id: WARE,
    tied_profile_ids: [LINEHAN, WARE],
  };

  it("gives the winner 1 and every other tied player 2", () => {
    const resolved = resolvedPositionsFromPlayoff(completed);
    expect(resolved.get(WARE)).toBe(1);
    expect(resolved.get(LINEHAN)).toBe(2);
  });

  it("leaves players outside the tie alone", () => {
    expect(resolvedPositionsFromPlayoff(completed).has(JACK)).toBe(false);
  });

  it("resolves nothing until the playoff is completed", () => {
    for (const status of ["pending", "in_progress", "abandoned", null]) {
      expect(resolvedPositionsFromPlayoff({ ...completed, status }).size).toBe(0);
    }
  });

  it("resolves nothing when there is no playoff at all", () => {
    // Callers then fall back to playoff_final_position ?? position.
    expect(resolvedPositionsFromPlayoff(null).size).toBe(0);
  });

  it("handles a three-way tie: one winner, the rest joint 2nd", () => {
    const resolved = resolvedPositionsFromPlayoff({
      status: "completed",
      winner_profile_id: WARE,
      tied_profile_ids: [WARE, LINEHAN, JACK],
    });
    expect([...resolved.entries()].sort()).toEqual(
      [
        [JACK, 2],
        [LINEHAN, 2],
        [WARE, 1],
      ].sort()
    );
  });

  it("survives a missing winner or empty tied set rather than inventing a result", () => {
    expect(
      resolvedPositionsFromPlayoff({ status: "completed", winner_profile_id: null, tied_profile_ids: [WARE] })
        .get(WARE)
    ).toBe(2);
    expect(
      resolvedPositionsFromPlayoff({ status: "completed", winner_profile_id: WARE, tied_profile_ids: null }).size
    ).toBe(0);
  });
});
