import { describe, expect, it } from "vitest";
import { detectFirstPlaceTie } from "@/lib/majors/eventLeaderboardPayload";

const player = (
  net_score: number | null,
  rounds_submitted: number,
  cut_status: string | null = null,
) => ({ net_score, rounds_submitted, cut_status });

/**
 * Gates the playoff UI and event completion. With a cut in play, players who
 * missed it never reach num_rounds — without special handling the event could
 * never read as complete.
 */
describe("detectFirstPlaceTie", () => {
  it("needs the tied leaders to have finished every round", () => {
    const partial = detectFirstPlaceTie([player(140, 1), player(140, 2)], 2);
    expect(partial.has_first_place_tie).toBe(false);

    const done = detectFirstPlaceTie([player(140, 2), player(140, 2)], 2);
    expect(done.has_first_place_tie).toBe(true);
  });

  it("does not call a single leader a tie", () => {
    expect(detectFirstPlaceTie([player(140, 2), player(145, 2)], 2).has_first_place_tie).toBe(false);
  });

  it("lets a player still out on the course not block the leaders' tie", () => {
    // Trailing the leaders, so the tie stands — but the event is not complete.
    const r = detectFirstPlaceTie([player(140, 2), player(140, 2), player(150, 1)], 2);
    expect(r.has_first_place_tie).toBe(true);
    expect(r.all_rounds_complete).toBe(false);
  });

  it("defers to a live player who is genuinely ahead", () => {
    // Mid-round their cumulative net is lower because they have played fewer
    // holes, so they hold the lead and there is no tie to resolve yet.
    const r = detectFirstPlaceTie([player(140, 2), player(140, 2), player(80, 1)], 2);
    expect(r.has_first_place_tie).toBe(false);
  });

  it("treats a cut player as finished", () => {
    // Two survivors done at 2 rounds; the cut player stops at 1 and must not
    // hold the event open forever.
    const r = detectFirstPlaceTie(
      [player(140, 2), player(145, 2), player(90, 1, "missed")],
      2,
    );
    expect(r.all_rounds_complete).toBe(true);
  });

  it("never lets a cut player form a first-place tie", () => {
    // Their through-the-cut total is lowest simply because they played fewer
    // rounds — they cannot win.
    const r = detectFirstPlaceTie(
      [player(90, 1, "missed"), player(90, 1, "missed"), player(140, 2, "made")],
      2,
    );
    expect(r.has_first_place_tie).toBe(false);
  });

  it("still finds a tie between two survivors alongside cut players", () => {
    const r = detectFirstPlaceTie(
      [player(140, 2, "made"), player(140, 2, "made"), player(90, 1, "missed")],
      2,
    );
    expect(r.has_first_place_tie).toBe(true);
    expect(r.all_rounds_complete).toBe(true);
  });

  it("reports nothing when no one has a score", () => {
    expect(detectFirstPlaceTie([player(null, 0)], 2)).toEqual({
      has_first_place_tie: false,
      all_rounds_complete: false,
    });
  });
});
