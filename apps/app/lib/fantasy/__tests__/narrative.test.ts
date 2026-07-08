import { describe, expect, it } from "vitest";
import { composeNarrative, type NarrativeInputs } from "@/lib/fantasy/narrative";
import type { RecentRound } from "@/lib/fantasy/profiles";

function rounds(grosses: number[], birdiesEach = 1, courseId: string | null = null): RecentRound[] {
  return grosses.map((g, i) => ({
    playedAt: `2026-07-0${(i % 7) + 1}`,
    roundId: `r${i}`,
    courseId,
    holes: 18,
    gross18: g,
    birdies: birdiesEach,
    eagles: 0,
  }));
}

function player(
  overrides: Partial<NarrativeInputs["players"][number]> & { profileId: string; name: string }
): NarrativeInputs["players"][number] {
  return {
    playingHandicap: 12,
    winProb: 0.1,
    meanGross: 85,
    meanNet: 73,
    sampleSize: 12,
    scoreStddev: 4,
    recentForm: 0,
    recentRounds: rounds([84, 86, 85]),
    ...overrides,
  };
}

function inputs(overrides: Partial<NarrativeInputs> = {}): NarrativeInputs {
  return {
    eventName: "July Medal",
    courseName: "Sandy Links",
    scoringModel: "net",
    rankingBasis: "net",
    allowance: 90,
    numRounds: 1,
    players: [
      player({ profileId: "a", name: "Alice Adams", winProb: 0.4 }),
      player({ profileId: "b", name: "Bob Brown", winProb: 0.2 }),
      player({ profileId: "c", name: "Cara Cole", winProb: 0.2 }),
      player({ profileId: "d", name: "Dan Drew", winProb: 0.2 }),
    ],
    ...overrides,
  };
}

describe("composeNarrative", () => {
  it("is deterministic for the same inputs and seed", () => {
    const a = composeNarrative(inputs(), "course-1", 42);
    const b = composeNarrative(inputs(), "course-1", 42);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("describes the event setup (allowance + format) first", () => {
    const text = composeNarrative(inputs(), "course-1", 7);
    expect(text).toContain("90% strokeplay");
    expect(text).toContain("Sandy Links");
    expect(text).toContain("4 players");
  });

  it("surfaces the clear market favourite", () => {
    const text = composeNarrative(inputs(), "course-1", 3);
    expect(text).toContain("Alice Adams");
    expect(text).toMatch(/40%/);
  });

  it("scoring prefers the objectively bigger deviation", () => {
    const text = composeNarrative(
      inputs({
        players: [
          // Even market → no favourite angle; spread projections → no
          // tight-race angle. Only the form extractor can mention players.
          player({ profileId: "a", name: "Hot Harry", winProb: 0.25, meanNet: 70, recentForm: -6, recentRounds: rounds([78, 79, 80]) }),
          player({ profileId: "b", name: "Flat Fred", winProb: 0.25, meanNet: 73, recentForm: -1.2 }),
          player({ profileId: "c", name: "Even Eve", winProb: 0.25, meanNet: 76 }),
          player({ profileId: "d", name: "Mid Mia", winProb: 0.25, meanNet: 79 }),
        ],
      }),
      null,
      11
    );
    // Harry's streak (6 strokes of form) makes the cut…
    expect(text).toContain("78, 79, 80");
    // …Fred's 1.2 strokes sits below the 1.5 threshold: no mention at all.
    expect(text).not.toContain("Fred");
  });

  it("mentions debutants priced off handicap", () => {
    const text = composeNarrative(
      inputs({
        players: [
          player({ profileId: "a", name: "Alice Adams", winProb: 0.25 }),
          player({ profileId: "b", name: "New Nick", winProb: 0.25, sampleSize: 0, recentRounds: null, recentForm: null }),
          player({ profileId: "c", name: "Cara Cole", winProb: 0.25 }),
          player({ profileId: "d", name: "Dan Drew", winProb: 0.25 }),
        ],
      }),
      null,
      5
    );
    expect(text).toContain("New Nick");
    expect(text.toLowerCase()).toContain("handicap");
  });

  it("different events read differently (structure varies with seed)", () => {
    const texts = new Set(
      [1, 2, 3, 4, 5, 6].map((s) => composeNarrative(inputs(), "course-1", s))
    );
    expect(texts.size).toBeGreaterThan(1);
  });
});
