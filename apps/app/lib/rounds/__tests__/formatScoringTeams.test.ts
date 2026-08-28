import { describe, expect, it } from "vitest";
import {
  computeFormatDisplay,
  playerSummariesOf,
  TEAM_FORMATS,
  type ScoringContext,
} from "@/lib/rounds/formatScoring";
import type { Hole, Participant, Score, HoleState, Team, RoundFormatType } from "@/lib/rounds/hooks/useRoundDetail";

/**
 * Team formats shipped for months rendering nothing: the calculators keyed every
 * result by TEAM id while the scorecard and leaderboard looked them up by PLAYER
 * id, so every cell was blank and every total was "–". There was no team test
 * coverage at all, which is why nobody noticed.
 *
 * The contract these tests pin:
 *   - `holeResults` has an entry for every player AND every team.
 *   - `summaries` ranks TEAMS only — the social feed names a round's winner off
 *     it, so a stray player entry would crown an individual.
 *   - `playerSummariesOf()` gives one entry per player, for the column totals.
 */

function participant(id: string, teamId: string, playingHandicap = 0): Participant {
  return {
    id,
    profile_id: id,
    is_guest: false,
    display_name: id,
    role: "player",
    tee_snapshot_id: null,
    team_id: teamId,
    playing_handicap_used: playingHandicap,
    course_handicap: playingHandicap,
  };
}

function team(id: string, teamNumber: number): Team {
  return { id, round_id: "r", name: `Team ${id}`, team_number: teamNumber, playing_handicap_used: 0 };
}

/** Uniform par 4s, stroke index 1..n. */
function holes(count: number): Hole[] {
  return Array.from({ length: count }, (_, i) => ({
    hole_number: i + 1,
    par: 4,
    yardage: 400,
    stroke_index: i + 1,
  }));
}

const TEAMS = [team("t1", 1), team("t2", 2)];
const A = participant("A", "t1");
const B = participant("B", "t1");
const C = participant("C", "t2");
const D = participant("D", "t2");
const PLAYERS = [A, B, C, D];

function mkScores(entries: Array<[string, number, number]>) {
  const scoresByKey: Record<string, Score> = {};
  const holeStatesByKey: Record<string, HoleState> = {};
  for (const [pid, hole, strokes] of entries) {
    scoresByKey[`${pid}:${hole}`] = { participant_id: pid, hole_number: hole, strokes, created_at: "" };
    holeStatesByKey[`${pid}:${hole}`] = "completed";
  }
  return { scoresByKey, holeStatesByKey };
}

function run(
  formatType: RoundFormatType,
  formatConfig: Record<string, any>,
  players: Participant[],
  teams: Team[],
  entries: Array<[string, number, number]>,
  holeCount = 3,
  ctx?: ScoringContext
) {
  const { scoresByKey, holeStatesByKey } = mkScores(entries);
  return computeFormatDisplay(
    formatType,
    formatConfig,
    players,
    holes(holeCount),
    scoresByKey,
    holeStatesByKey,
    teams,
    (p) => p.id,
    new Set(),
    {},
    1,
    ctx
  );
}

describe("team formats — the contract", () => {
  // The single test that would have caught the whole class of bug.
  it("gives every participant a hole result and a summary, on every team format", () => {
    const entries: Array<[string, number, number]> = PLAYERS.flatMap((p) =>
      [1, 2, 3].map((h) => [p.id, h, 4] as [string, number, number])
    );

    for (const formatType of TEAM_FORMATS) {
      const [display] = run(formatType, {}, PLAYERS, TEAMS, entries);
      expect(display, `${formatType} produced no display`).toBeDefined();

      for (const p of PLAYERS) {
        for (const h of holes(3)) {
          expect(
            display.holeResults[`${p.id}:${h.hole_number}`],
            `${formatType} has no cell for ${p.id} on hole ${h.hole_number}`
          ).toBeDefined();
        }
        expect(
          playerSummariesOf(display).find((s) => s.participantId === p.id),
          `${formatType} has no player summary for ${p.id}`
        ).toBeDefined();
      }
    }
  });

  // Guards the social feed: determineWinner picks the best numeric total off
  // `summaries` and names it. On team_strokeplay a team total always exceeds any
  // individual's, so a player entry here would be crowned instead of the team.
  it("ranks teams and only teams in `summaries`", () => {
    const entries: Array<[string, number, number]> = PLAYERS.flatMap((p) =>
      [1, 2, 3].map((h) => [p.id, h, 4] as [string, number, number])
    );

    for (const formatType of TEAM_FORMATS) {
      const [display] = run(formatType, {}, PLAYERS, TEAMS, entries);
      expect(display.isTeamView, `${formatType} should be a team view`).toBe(true);
      expect(display.summaries.length, `${formatType} summary count`).toBe(TEAMS.length);
      expect(
        display.summaries.every((s) => s.teamId != null),
        `${formatType} leaked a non-team entry into summaries`
      ).toBe(true);
    }
  });
});

describe("team_stableford", () => {
  it("shows each player's own points and the team's combined total", () => {
    // Par 4s off scratch. A: 3 = birdie = 3 pts. B: 4 = par = 2 pts. Team = 5.
    const [display] = run("team_stableford", {}, PLAYERS, TEAMS, [
      ["A", 1, 3],
      ["B", 1, 4],
      ["C", 1, 5],
      ["D", 1, 6],
    ]);

    expect(display.holeResults["A:1"]?.displayValue).toBe(3);
    expect(display.holeResults["B:1"]?.displayValue).toBe(2);
    expect(display.holeResults["t1:1"]?.displayValue).toBe(5);

    // C: 5 = bogey = 1 pt. D: 6 = double = 0. Team = 1.
    expect(display.holeResults["C:1"]?.displayValue).toBe(1);
    expect(display.holeResults["D:1"]?.displayValue).toBe(0);
    expect(display.holeResults["t2:1"]?.displayValue).toBe(1);

    expect(playerSummariesOf(display).find((s) => s.participantId === "A")?.total).toBe(3);
    expect(display.summaries.find((s) => s.teamId === "t1")?.total).toBe(5);
    expect(display.summaries.find((s) => s.teamId === "t2")?.total).toBe(1);
  });
});

describe("team_strokeplay", () => {
  it("shows each player's own gross and the team's sum", () => {
    const [display] = run("team_strokeplay", {}, PLAYERS, TEAMS, [
      ["A", 1, 4],
      ["B", 1, 5],
    ]);

    expect(display.holeResults["A:1"]?.displayValue).toBe(4);
    expect(display.holeResults["B:1"]?.displayValue).toBe(5);
    expect(display.holeResults["t1:1"]?.displayValue).toBe(9);
    expect(playerSummariesOf(display).find((s) => s.participantId === "B")?.total).toBe(5);
    expect(display.summaries.find((s) => s.teamId === "t1")?.total).toBe(9);
  });
});

describe("team_bestball", () => {
  it("net_strokes: the player cell is their NET, and the team takes the lowest net", () => {
    // A plays off 18 on a 3-hole card, so receives 6 shots a hole — gross 10 is
    // net 4. B is scratch with gross 5. The team must take A's 4, not B's gross.
    const a18 = participant("A", "t1", 18);
    const [display] = run(
      "team_bestball",
      { scoring_type: "net_strokes", count_per_hole: 1 },
      [a18, B],
      [TEAMS[0]],
      [
        ["A", 1, 10],
        ["B", 1, 5],
      ]
    );

    expect(display.holeResults["A:1"]?.displayValue).toBe(4);
    expect(display.holeResults["A:1"]?.recv).toBe(6);
    expect(display.holeResults["B:1"]?.displayValue).toBe(5);
    expect(display.holeResults["t1:1"]?.displayValue).toBe(4);
  });

  it("stableford: the player cells are own points, the team takes the best", () => {
    const [display] = run(
      "team_bestball",
      { scoring_type: "stableford", count_per_hole: 1 },
      [A, B],
      [TEAMS[0]],
      [
        ["A", 1, 3],
        ["B", 1, 5],
      ]
    );

    expect(display.holeResults["A:1"]?.displayValue).toBe(3);
    expect(display.holeResults["B:1"]?.displayValue).toBe(1);
    expect(display.holeResults["t1:1"]?.displayValue).toBe(3);
  });
});

describe("pairs_stableford", () => {
  it("changes the team row per scoring_mode but never the player cells", () => {
    const entries: Array<[string, number, number]> = [
      ["A", 1, 3],
      ["B", 1, 5],
    ];
    const cells: Record<string, unknown> = {};
    const teamTotals: Record<string, unknown> = {};

    for (const mode of ["best", "worst", "combined"]) {
      const [display] = run("pairs_stableford", { scoring_mode: mode }, [A, B], [TEAMS[0]], entries);
      cells[mode] = [display.holeResults["A:1"]?.displayValue, display.holeResults["B:1"]?.displayValue];
      teamTotals[mode] = display.holeResults["t1:1"]?.displayValue;
    }

    // A = 3 pts (birdie), B = 1 pt (bogey) under every mode.
    expect(cells.best).toEqual([3, 1]);
    expect(cells.worst).toEqual([3, 1]);
    expect(cells.combined).toEqual([3, 1]);

    expect(teamTotals.best).toBe(3);
    expect(teamTotals.worst).toBe(1);
    expect(teamTotals.combined).toBe(4);
  });
});

describe("scramble (single ball)", () => {
  it("mirrors the team's value onto every member, including the first-member key", () => {
    // The scorecard's virtual team column is keyed by the FIRST member's id, so
    // that key is the one that decides whether a scramble card renders at all.
    const [display] = run("scramble", {}, [A, B], [TEAMS[0]], [["A", 1, 4]]);

    const teamCell = display.holeResults["t1:1"];
    expect(teamCell?.displayValue).toBe(4);
    expect(display.holeResults["A:1"]).toEqual(teamCell);
    expect(display.holeResults["B:1"]).toEqual(teamCell);

    // Handicap must be reachable under member ids too, or the header PH and the
    // stroke dots go blank on the virtual column.
    expect(display.playingHandicaps?.["A"]).toBe(0);
    expect(display.playingHandicaps?.["t1"]).toBe(0);

    const playerTotal = playerSummariesOf(display).find((s) => s.participantId === "A")?.total;
    expect(playerTotal).toBe(display.summaries.find((s) => s.teamId === "t1")?.total);
  });
});

describe("teams × multiple tees", () => {
  it("scores each team member off their own tee", () => {
    // A off White (hole 1 is a par 4), B off Red (par 5). Both score 5:
    // A bogeys for 1 pt, B pars for 2. Team = 3.
    const WHITE: Hole[] = [{ hole_number: 1, par: 4, yardage: 400, stroke_index: 5 }];
    const RED: Hole[] = [{ hole_number: 1, par: 5, yardage: 330, stroke_index: 18 }];
    const byPid: Record<string, Hole[]> = { A: WHITE, B: RED };

    const ctx: ScoringContext = {
      holeFor: (pid, hole) => byPid[pid]?.find((h) => h.hole_number === hole.hole_number) ?? hole,
      holeCountFor: () => 1,
    };

    const [display] = run(
      "team_stableford",
      {},
      [A, B],
      [TEAMS[0]],
      [
        ["A", 1, 5],
        ["B", 1, 5],
      ],
      1,
      ctx
    );

    expect(display.holeResults["A:1"]?.displayValue).toBe(1);
    expect(display.holeResults["B:1"]?.displayValue).toBe(2);
    expect(display.holeResults["t1:1"]?.displayValue).toBe(3);
  });
});

describe("a team format with no teams", () => {
  // Pins today's behaviour so changing it stays a deliberate decision: the round
  // screen shows an explicit "no teams" banner rather than an empty tab, and the
  // real fix (letting an owner edit teams while live) is a separate change.
  it("produces no format display at all", () => {
    expect(run("team_stableford", {}, PLAYERS, [], [["A", 1, 4]])).toEqual([]);
  });
});
