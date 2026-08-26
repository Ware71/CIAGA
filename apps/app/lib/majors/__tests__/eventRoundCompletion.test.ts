import { describe, expect, it } from "vitest";
import {
  computeRoundCompletion,
  isEventComplete,
  newlyCompletedRoundIds,
  type EventRoundRow,
  type TeeSlotRow,
} from "@/lib/majors/eventRoundCompletion";

const R1 = "round-1-id";
const R2 = "round-2-id";

const scheduled = (id: string): EventRoundRow => ({ id, status: "scheduled" });

const slot = (eventRoundId: string | null, roundStatus: string | null): TeeSlotRow => ({
  event_round_id: eventRoundId,
  roundStatus,
});

/**
 * The defect this guards: a two-round event used to complete the moment round
 * 1's last card was signed, because completion was tested across the whole
 * event rather than per round. Completing settles the fantasy book
 * irreversibly, so this must never go true early.
 */
describe("computeRoundCompletion", () => {
  it("completes a round once every card played off its tee times is finished", () => {
    const completion = computeRoundCompletion(
      [scheduled(R1), scheduled(R2)],
      [slot(R1, "finished"), slot(R1, "finished"), slot(R2, "scheduled")],
    );

    expect(completion.find((r) => r.id === R1)?.complete).toBe(true);
    expect(completion.find((r) => r.id === R2)?.complete).toBe(false);
  });

  it("holds a round that still has a live card", () => {
    const completion = computeRoundCompletion(
      [scheduled(R1)],
      [slot(R1, "finished"), slot(R1, "live")],
    );
    expect(completion[0].complete).toBe(false);
  });

  it("never completes a round that has no tee times yet", () => {
    // Round 2 drawn only after round 1 is played — the deferred re-draw.
    const completion = computeRoundCompletion(
      [scheduled(R1), scheduled(R2)],
      [slot(R1, "finished")],
    );
    expect(completion.find((r) => r.id === R2)?.complete).toBe(false);
  });

  it("disregards cancelled rounds and cancelled cards", () => {
    const completion = computeRoundCompletion(
      [scheduled(R1), { id: R2, status: "cancelled" }],
      [slot(R1, "finished"), slot(R1, "cancelled")],
    );

    expect(completion).toHaveLength(1);
    expect(completion[0].id).toBe(R1);
    expect(completion[0].complete).toBe(true);
  });

  it("attributes unassigned tee times only when there is a single round", () => {
    const single = computeRoundCompletion([scheduled(R1)], [slot(null, "finished")]);
    expect(single[0].complete).toBe(true);

    // With two rounds an unassigned slot is ambiguous, so it counts for neither.
    const multi = computeRoundCompletion(
      [scheduled(R1), scheduled(R2)],
      [slot(null, "finished")],
    );
    expect(multi.every((r) => !r.complete)).toBe(true);
  });
});

describe("isEventComplete", () => {
  it("stays false while any round is outstanding", () => {
    const completion = computeRoundCompletion(
      [scheduled(R1), scheduled(R2)],
      [slot(R1, "finished"), slot(R2, "scheduled")],
    );
    expect(isEventComplete(completion)).toBe(false);
  });

  it("stays false for a two-round event whose round 2 is undrawn", () => {
    const completion = computeRoundCompletion(
      [scheduled(R1), scheduled(R2)],
      [slot(R1, "finished")],
    );
    expect(isEventComplete(completion)).toBe(false);
  });

  it("goes true once every round is finished", () => {
    const completion = computeRoundCompletion(
      [scheduled(R1), scheduled(R2)],
      [slot(R1, "finished"), slot(R2, "finished")],
    );
    expect(isEventComplete(completion)).toBe(true);
  });

  it("accepts a round already marked completed by an earlier pass", () => {
    const completion = computeRoundCompletion(
      [{ id: R1, status: "completed" }, scheduled(R2)],
      // R1's tee times are long gone from this view; its status carries it.
      [slot(R2, "finished")],
    );
    expect(isEventComplete(completion)).toBe(true);
  });

  it("is false when the event has no rounds at all", () => {
    expect(isEventComplete(computeRoundCompletion([], [slot(null, "finished")]))).toBe(false);
  });
});

describe("newlyCompletedRoundIds", () => {
  it("returns only rounds that finished this pass", () => {
    const completion = computeRoundCompletion(
      [{ id: R1, status: "completed" }, scheduled(R2)],
      [slot(R1, "finished"), slot(R2, "finished")],
    );
    expect(newlyCompletedRoundIds(completion)).toEqual([R2]);
  });

  it("returns nothing when no round has finished", () => {
    const completion = computeRoundCompletion([scheduled(R1)], [slot(R1, "live")]);
    expect(newlyCompletedRoundIds(completion)).toEqual([]);
  });
});
