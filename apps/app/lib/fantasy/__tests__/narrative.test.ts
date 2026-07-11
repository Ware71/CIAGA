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

  // ── New angles ────────────────────────────────────────────────────────
  // Each fixture spreads meanNet (73/76/79/82) and keeps winProb under the
  // favourite threshold so the ONLY angle that can mention player "a" is the
  // one under test — the assertion then proves that extractor fired.
  const filler = () => [
    player({ profileId: "b", name: "Bob Brown", meanNet: 76 }),
    player({ profileId: "c", name: "Cara Cole", meanNet: 79 }),
    player({ profileId: "d", name: "Dan Drew", meanNet: 82 }),
  ];
  const withLead = (lead: NarrativeInputs["players"][number]) =>
    inputs({ players: [lead, ...filler()] });

  it("flags a recent handicap cut", () => {
    const text = composeNarrative(
      withLead(player({ profileId: "a", name: "Carl Cutter", winProb: 0.25, handicapDelta: -2.2 })),
      null,
      4
    );
    expect(text).toContain("2.2 shots");
    expect(text).toMatch(/Carl/);
  });

  it("flags a handicap drifting up", () => {
    const text = composeNarrative(
      withLead(player({ profileId: "a", name: "Rusty Rise", winProb: 0.25, handicapDelta: 1.8 })),
      null,
      8
    );
    expect(text).toContain("1.8 shots");
  });

  it("names the season standings leader with the lead margin", () => {
    const text = composeNarrative(
      withLead(
        player({
          profileId: "a", name: "Ace Adams", winProb: 0.25,
          isSeasonLeader: true, seasonPoints: 120, seasonPosition: 1, leadMargin: 15, pointsToLeader: 0,
        })
      ),
      null,
      2
    );
    expect(text).toContain("15 points clear");
    expect(text).toMatch(/Ace/);
  });

  it("frames a close chaser by the points gap", () => {
    const text = composeNarrative(
      withLead(
        player({
          profileId: "a", name: "Nadia Near", winProb: 0.25,
          seasonPosition: 2, seasonPoints: 115, pointsToLeader: 5, recentForm: 0,
        })
      ),
      null,
      6
    );
    expect(text).toContain("5 pts");
    expect(text).toMatch(/Nadia/);
  });

  it("frames a trailing-but-hot comeback", () => {
    const text = composeNarrative(
      withLead(
        player({
          profileId: "a", name: "Charlie Chase", winProb: 0.25,
          seasonPosition: 6, pointsToLeader: 40, recentForm: -3, recentRounds: null,
        })
      ),
      null,
      9
    );
    expect(text).toMatch(/Charlie/);
    expect(text).toMatch(/6th|40 pts/);
  });

  it("welcomes the defending champion", () => {
    const text = composeNarrative(
      withLead(player({ profileId: "a", name: "Titus Holder", winProb: 0.25, isDefendingEventChampion: true })),
      null,
      3
    );
    expect(text).toMatch(/Titus/);
  });

  it("highlights a recent exceptional round", () => {
    const text = composeNarrative(
      withLead(
        player({
          profileId: "a", name: "Larry Lowe", winProb: 0.25,
          avgGross: 84, scoreStddev: 4, recentForm: 0, recentRounds: rounds([76, 85, 86]),
        })
      ),
      null,
      5
    );
    expect(text).toContain("76");
    expect(text).toMatch(/Larry/);
  });

  it("praises a metronomically consistent player", () => {
    const text = composeNarrative(
      withLead(player({ profileId: "a", name: "Eddie Steady", winProb: 0.25, scoreStddev: 1.5, sampleSize: 12 })),
      null,
      7
    );
    expect(text).toMatch(/Eddie/);
  });

  it("silently omits season/title angles when linkage is absent", () => {
    // No season fields set on any player → no standings/defending lines, no throw.
    const text = composeNarrative(inputs(), "course-1", 1);
    expect(text).not.toMatch(/standings|points clear|defending|champion/i);
    expect(text.length).toBeGreaterThan(20);
  });
});
