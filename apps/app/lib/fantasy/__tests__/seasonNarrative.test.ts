import { describe, expect, it } from "vitest";
import { composeSeasonNarrative, type SeasonNarrativeInputs } from "@/lib/fantasy/seasonNarrative";

type SeasonPlayer = SeasonNarrativeInputs["players"][number];

function player(overrides: Partial<SeasonPlayer> & { profileId: string; name: string }): SeasonPlayer {
  return {
    winProb: 0.05,
    top3Prob: 0.1,
    currentPoints: 50,
    position: 5,
    isLeader: false,
    pointsToLeader: 60,
    leadMargin: null,
    eventsPlayed: 6,
    wins: 0,
    top3s: 1,
    recentForm: 0,
    handicapDelta: null,
    isDefendingSeasonChampion: false,
    ...overrides,
  };
}

function inputs(overrides: Partial<SeasonNarrativeInputs> = {}): SeasonNarrativeInputs {
  return {
    seasonName: "2026 Season",
    remainingCount: 3,
    players: [
      player({ profileId: "a", name: "Alice Adams", winProb: 0.4, isLeader: true, position: 1, pointsToLeader: 0, leadMargin: 12, currentPoints: 120, top3s: 4, wins: 2 }),
      player({ profileId: "b", name: "Bob Brown", winProb: 0.2, position: 2, pointsToLeader: 20, currentPoints: 100 }),
      player({ profileId: "c", name: "Cara Cole", winProb: 0.2, position: 3, pointsToLeader: 40, currentPoints: 80 }),
      player({ profileId: "d", name: "Dan Drew", winProb: 0.2, position: 4, pointsToLeader: 60, currentPoints: 60 }),
    ],
    ...overrides,
  };
}

// Filler players with no qualifying properties — so the ONLY player the
// assertion can pick up is the one under test.
const filler = () => [
  player({ profileId: "b", name: "Bob Brown", position: 6, pointsToLeader: 70, currentPoints: 40 }),
  player({ profileId: "c", name: "Cara Cole", position: 7, pointsToLeader: 80, currentPoints: 30 }),
  player({ profileId: "d", name: "Dan Drew", position: 8, pointsToLeader: 90, currentPoints: 20 }),
];
const leader = (over: Partial<SeasonPlayer> = {}) =>
  player({ profileId: "L", name: "Leah Lead", winProb: 0.5, isLeader: true, position: 1, pointsToLeader: 0, leadMargin: 15, currentPoints: 130, ...over });
const withField = (target: SeasonPlayer, opts: { leader?: SeasonPlayer; remainingCount?: number } = {}) =>
  inputs({ players: [opts.leader ?? leader(), target, ...filler()], remainingCount: opts.remainingCount ?? 3 });

describe("composeSeasonNarrative", () => {
  it("is deterministic for the same inputs and seed", () => {
    const a = composeSeasonNarrative(inputs(), 42);
    const b = composeSeasonNarrative(inputs(), 42);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("frames the season and the run-in first", () => {
    const text = composeSeasonNarrative(inputs({ remainingCount: 3 }), 7);
    expect(text).toContain("2026 Season");
    expect(text).toContain("3 events still to play");
  });

  it("names the title favourite with the win probability", () => {
    const text = composeSeasonNarrative(inputs(), 3);
    expect(text).toContain("Alice Adams");
    expect(text).toMatch(/40%/);
  });

  it("calls a runaway leader", () => {
    const text = composeSeasonNarrative(
      withField(player({ profileId: "x", name: "Xavi Extra" }), { leader: leader({ winProb: 0.72, leadMargin: 30 }) }),
      2
    );
    expect(text).toMatch(/Leah/);
  });

  it("declares a decided title when the race is settled", () => {
    const text = composeSeasonNarrative(
      inputs({ remainingCount: 0, players: [leader({ winProb: 0.99 }), ...filler()] }),
      5
    );
    expect(text).toMatch(/Leah/);
    // Decided/runaway/favourite for a certainty never print a probability.
    expect(text).not.toContain("%");
  });

  it("flags a two-horse title race", () => {
    const text = composeSeasonNarrative(
      inputs({
        players: [
          player({ profileId: "a", name: "Tia Top", winProb: 0.4, isLeader: true, position: 1, pointsToLeader: 0, leadMargin: 2, currentPoints: 122 }),
          player({ profileId: "b", name: "Ty Two", winProb: 0.4, position: 2, pointsToLeader: 2, currentPoints: 120 }),
          player({ profileId: "c", name: "Cara Cole", winProb: 0.1, position: 7, pointsToLeader: 80, currentPoints: 30 }),
          player({ profileId: "d", name: "Dan Drew", winProb: 0.1, position: 8, pointsToLeader: 90, currentPoints: 20 }),
        ],
      }),
      6
    );
    expect(text).toMatch(/Tia/);
    expect(text).toMatch(/Ty/);
  });

  it("frames a close chaser by the points gap", () => {
    const text = composeSeasonNarrative(
      withField(player({ profileId: "a", name: "Nadia Near", winProb: 0.1, position: 2, pointsToLeader: 5, currentPoints: 125 })),
      4
    );
    expect(text).toContain("5 pts");
    expect(text).toMatch(/Nadia/);
  });

  it("spots a form surge up the table", () => {
    const text = composeSeasonNarrative(
      withField(player({ profileId: "a", name: "Sunny Surge", winProb: 0.1, position: 6, pointsToLeader: 40, recentForm: -3 })),
      9
    );
    expect(text).toMatch(/Sunny/);
  });

  it("credits the season's wins leader", () => {
    const text = composeSeasonNarrative(
      withField(player({ profileId: "a", name: "Wanda West", winProb: 0.1, position: 3, wins: 3 })),
      8
    );
    expect(text).toMatch(/Wanda/);
    expect(text).toMatch(/3 wins|winner's circle/);
  });

  it("notes a reliable podium finisher", () => {
    const text = composeSeasonNarrative(
      withField(player({ profileId: "a", name: "Percy Podium", winProb: 0.1, top3Prob: 0.6, position: 8, pointsToLeader: 70 })),
      5
    );
    expect(text).toContain("60%");
    expect(text).toMatch(/Percy/);
  });

  it("flags a season-long handicap cut", () => {
    const text = composeSeasonNarrative(
      withField(player({ profileId: "a", name: "Carl Cutter", winProb: 0.1, position: 3, pointsToLeader: 55, handicapDelta: -2.2 })),
      4
    );
    expect(text).toContain("2.2 shots");
    expect(text).toMatch(/Carl/);
  });

  it("welcomes the defending season champion", () => {
    const text = composeSeasonNarrative(
      withField(player({ profileId: "a", name: "Denny Defender", winProb: 0.1, position: 3, pointsToLeader: 45, isDefendingSeasonChampion: true })),
      3
    );
    expect(text).toMatch(/Denny/);
  });

  it("calls a wide-open race with no standout", () => {
    const text = composeSeasonNarrative(
      inputs({
        players: [
          player({ profileId: "a", name: "Ann", winProb: 0.15, top3Prob: 0.2, position: 1 }),
          player({ profileId: "b", name: "Ben", winProb: 0.15, top3Prob: 0.2, position: 2 }),
          player({ profileId: "c", name: "Cat", winProb: 0.15, top3Prob: 0.2, position: 3 }),
          player({ profileId: "d", name: "Dev", winProb: 0.15, top3Prob: 0.2, position: 4 }),
        ],
      }),
      1
    );
    // No favourite/podium ⇒ no probability printed, and no single player named.
    expect(text).not.toContain("%");
    expect(text).not.toMatch(/Ann|Ben|Cat|Dev/);
    expect(text.length).toBeGreaterThan(40);
  });

  it("reads differently across seeds", () => {
    const texts = new Set([1, 2, 3, 4, 5, 6].map((s) => composeSeasonNarrative(inputs(), s)));
    expect(texts.size).toBeGreaterThan(1);
  });

  it("produces coherent text with sparse data and never throws", () => {
    const text = composeSeasonNarrative(
      inputs({
        remainingCount: 5,
        players: [
          player({ profileId: "a", name: "One One", winProb: 0.1, top3Prob: 0.1, position: null, isLeader: false, pointsToLeader: null }),
          player({ profileId: "b", name: "Two Two", winProb: 0.1, top3Prob: 0.1, position: null, isLeader: false, pointsToLeader: null }),
        ],
      }),
      2
    );
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toMatch(/undefined|NaN|null/);
  });
});
