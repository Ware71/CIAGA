import { describe, expect, it } from "vitest";
import { selectFinalRounds, type SubmissionRow } from "@/lib/majors/resolveEventRoundForRound";

const WARE = "ware-id";
const JACK = "jack-id";

const row = (
  profileId: string,
  roundId: string,
  roundNumber: number | null,
  submittedAt: string,
): SubmissionRow => ({ profileId, roundId, roundNumber, submittedAt });

/**
 * Countback runs on the last round played. This used to be picked with
 * `ORDER BY submitted_at DESC`, which is only usually the final round — an
 * admin re-accepting round 1 after round 2 was already in silently switched
 * the countback onto round 1.
 */
describe("selectFinalRounds", () => {
  it("picks the highest round number, not the latest submission", () => {
    const picked = selectFinalRounds([
      row(WARE, "r2-card", 2, "2026-08-02T10:00:00Z"),
      // Round 1 re-accepted by an admin AFTER round 2 was submitted.
      row(WARE, "r1-card", 1, "2026-08-03T09:00:00Z"),
    ]);
    expect(picked[WARE]).toBe("r2-card");
  });

  it("handles each player independently", () => {
    const picked = selectFinalRounds([
      row(WARE, "ware-r2", 2, "2026-08-02T10:00:00Z"),
      row(WARE, "ware-r1", 1, "2026-08-01T10:00:00Z"),
      row(JACK, "jack-r1", 1, "2026-08-01T10:00:00Z"),
    ]);
    expect(picked[WARE]).toBe("ware-r2");
    expect(picked[JACK]).toBe("jack-r1");
  });

  it("prefers a placed round over one with no round number", () => {
    const picked = selectFinalRounds([
      row(WARE, "unplaced", null, "2026-08-09T10:00:00Z"),
      row(WARE, "r1-card", 1, "2026-08-01T10:00:00Z"),
    ]);
    expect(picked[WARE]).toBe("r1-card");
  });

  it("falls back to latest submitted among unplaceable rows", () => {
    const picked = selectFinalRounds([
      row(WARE, "older", null, "2026-08-01T10:00:00Z"),
      row(WARE, "newer", null, "2026-08-05T10:00:00Z"),
    ]);
    expect(picked[WARE]).toBe("newer");
  });

  it("breaks a same-round tie on submission time", () => {
    const picked = selectFinalRounds([
      row(WARE, "first", 2, "2026-08-02T10:00:00Z"),
      row(WARE, "resubmitted", 2, "2026-08-02T18:00:00Z"),
    ]);
    expect(picked[WARE]).toBe("resubmitted");
  });

  it("skips rows with no round id, and omits players with nothing accepted", () => {
    const picked = selectFinalRounds([
      { profileId: WARE, roundId: null, roundNumber: 1, submittedAt: "2026-08-01T10:00:00Z" },
    ]);
    expect(picked[WARE]).toBeUndefined();
    expect(selectFinalRounds([])).toEqual({});
  });
});
