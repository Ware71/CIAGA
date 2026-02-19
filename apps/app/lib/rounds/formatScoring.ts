/**
 * Format-aware scoring module.
 * Pure functions — no React or Supabase dependencies.
 * Takes raw round data, returns display-ready results for the "Format" tab.
 */

import type { Participant, Hole, Score, HoleState, Team, RoundFormatType } from "./hooks/useRoundDetail";
import { strokesReceivedOnHole, netFromGross } from "./handicapUtils";

// ── Types ──────────────────────────────────────────────────────────────

export type FormatScoreView = "gross" | "net" | "format";

export type FormatHoleResult = {
  /** Display string or number for the cell (e.g. "2", "+1", "W", "—") */
  displayValue: string | number | null;
  /** Optional CSS hint for cell coloring */
  cssHint?: "positive" | "negative" | "neutral" | "won" | "lost" | "halved";
};

export type FormatSummary = {
  participantId: string;
  teamId?: string | null;
  out: number | string;
  inn: number | string;
  total: number | string;
};

export type FormatDisplayData = {
  /** Label for the tab button (e.g. "Stableford", "Match", "Best Ball") */
  tabLabel: string;
  /** Keyed by `${participantId}:${holeNumber}` — same as scoresByKey */
  holeResults: Record<string, FormatHoleResult>;
  /** One entry per participant (or per team for team formats) */
  summaries: FormatSummary[];
  /** If true, higher total is better (stableford). Affects leaderboard sort. */
  higherIsBetter: boolean;
  /** If true, summaries are per-team rather than per-participant */
  isTeamView: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────

function grossFor(
  pid: string,
  hole: number,
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>
): number | null {
  const key = `${pid}:${hole}`;
  const state = holeStatesByKey[key];
  if (state === "picked_up" || state === "not_started") return null;
  const s = scoresByKey[key];
  return typeof s?.strokes === "number" ? s.strokes : null;
}

function playingHcp(p: Participant): number {
  return typeof p.playing_handicap_used === "number" ? p.playing_handicap_used : 0;
}

function sumRange(
  results: Record<string, FormatHoleResult>,
  pid: string,
  holes: Hole[],
  from: number,
  to: number
): number | string {
  let sum = 0;
  let anyValue = false;
  for (const h of holes) {
    if (h.hole_number < from || h.hole_number > to) continue;
    const r = results[`${pid}:${h.hole_number}`];
    if (r && typeof r.displayValue === "number") {
      sum += r.displayValue;
      anyValue = true;
    }
  }
  return anyValue ? sum : "–";
}

// ── Default stableford points table ────────────────────────────────────

const DEFAULT_STABLEFORD: Record<string, number> = {
  albatross: 5,
  eagle: 4,
  birdie: 3,
  par: 2,
  bogey: 1,
  double_bogey: 0,
  worse: 0,
};

function stablefordPoints(netRelToPar: number, pointsTable: Record<string, number>): number {
  if (netRelToPar <= -3) return pointsTable.albatross ?? DEFAULT_STABLEFORD.albatross;
  if (netRelToPar === -2) return pointsTable.eagle ?? DEFAULT_STABLEFORD.eagle;
  if (netRelToPar === -1) return pointsTable.birdie ?? DEFAULT_STABLEFORD.birdie;
  if (netRelToPar === 0) return pointsTable.par ?? DEFAULT_STABLEFORD.par;
  if (netRelToPar === 1) return pointsTable.bogey ?? DEFAULT_STABLEFORD.bogey;
  if (netRelToPar === 2) return pointsTable.double_bogey ?? DEFAULT_STABLEFORD.double_bogey;
  return pointsTable.worse ?? DEFAULT_STABLEFORD.worse;
}

/** Compute stableford points for a single participant on a single hole */
function playerStablefordPtsOnHole(
  p: Participant,
  h: Hole,
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>,
  pointsTable: Record<string, number>
): number | null {
  const gross = grossFor(p.id, h.hole_number, scoresByKey, holeStatesByKey);
  if (gross === null || !h.par) return null;
  const recv = strokesReceivedOnHole(playingHcp(p), h.stroke_index);
  const net = netFromGross(gross, recv);
  return stablefordPoints(net - h.par, pointsTable);
}

// ── Per-format calculators ─────────────────────────────────────────────

function computeStableford(
  participants: Participant[],
  holes: Hole[],
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>,
  formatConfig: Record<string, any>
): FormatDisplayData {
  const pointsTable = { ...DEFAULT_STABLEFORD, ...(formatConfig.points_table ?? {}) };
  const holeResults: Record<string, FormatHoleResult> = {};

  for (const p of participants) {
    for (const h of holes) {
      const key = `${p.id}:${h.hole_number}`;
      const pts = playerStablefordPtsOnHole(p, h, scoresByKey, holeStatesByKey, pointsTable);
      if (pts === null) {
        holeResults[key] = { displayValue: null };
      } else {
        holeResults[key] = {
          displayValue: pts,
          cssHint: pts >= 3 ? "positive" : pts === 0 ? "negative" : "neutral",
        };
      }
    }
  }

  const summaries: FormatSummary[] = participants.map((p) => ({
    participantId: p.id,
    out: sumRange(holeResults, p.id, holes, 1, 9),
    inn: sumRange(holeResults, p.id, holes, 10, 18),
    total: sumRange(holeResults, p.id, holes, 1, 18),
  }));

  return { tabLabel: "Stableford", holeResults, summaries, higherIsBetter: true, isTeamView: false };
}

function computeMatchPlay(
  participants: Participant[],
  holes: Hole[],
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>,
  formatConfig: Record<string, any>
): FormatDisplayData | null {
  const matchups: Array<{ player_a_id: string; player_b_id: string }> = formatConfig.matchups || [];

  // If no matchups configured, fall back to auto-pair with exactly 2 players
  if (matchups.length === 0) {
    if (participants.length !== 2) return null;
    return computeMatchPlayPair(
      participants[0], participants[1], participants, holes, scoresByKey, holeStatesByKey
    );
  }

  // Round-robin or manual matchups: compute for the first matchup for now
  // (full round-robin display would need a multi-match view)
  const first = matchups[0];
  const pA = participants.find((p) => p.id === first.player_a_id);
  const pB = participants.find((p) => p.id === first.player_b_id);
  if (!pA || !pB) return null;

  return computeMatchPlayPair(pA, pB, participants, holes, scoresByKey, holeStatesByKey);
}

function computeMatchPlayPair(
  pA: Participant,
  pB: Participant,
  allParticipants: Participant[],
  holes: Hole[],
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>
): FormatDisplayData {
  const hcpA = playingHcp(pA);
  const hcpB = playingHcp(pB);
  const holeResults: Record<string, FormatHoleResult> = {};
  let cumulativeState = 0;

  for (const h of holes) {
    const grossA = grossFor(pA.id, h.hole_number, scoresByKey, holeStatesByKey);
    const grossB = grossFor(pB.id, h.hole_number, scoresByKey, holeStatesByKey);

    if (grossA === null || grossB === null || !h.par) {
      holeResults[`${pA.id}:${h.hole_number}`] = { displayValue: null };
      holeResults[`${pB.id}:${h.hole_number}`] = { displayValue: null };
      continue;
    }

    const netA = netFromGross(grossA, strokesReceivedOnHole(hcpA, h.stroke_index));
    const netB = netFromGross(grossB, strokesReceivedOnHole(hcpB, h.stroke_index));

    if (netA < netB) {
      cumulativeState += 1;
      holeResults[`${pA.id}:${h.hole_number}`] = { displayValue: "W", cssHint: "won" };
      holeResults[`${pB.id}:${h.hole_number}`] = { displayValue: "L", cssHint: "lost" };
    } else if (netB < netA) {
      cumulativeState -= 1;
      holeResults[`${pA.id}:${h.hole_number}`] = { displayValue: "L", cssHint: "lost" };
      holeResults[`${pB.id}:${h.hole_number}`] = { displayValue: "W", cssHint: "won" };
    } else {
      holeResults[`${pA.id}:${h.hole_number}`] = { displayValue: "–", cssHint: "halved" };
      holeResults[`${pB.id}:${h.hole_number}`] = { displayValue: "–", cssHint: "halved" };
    }
  }

  const formatState = (state: number, isA: boolean): string => {
    const val = isA ? state : -state;
    if (val > 0) return `${val} UP`;
    if (val < 0) return `${Math.abs(val)} DN`;
    return "AS";
  };

  const summaries: FormatSummary[] = [
    { participantId: pA.id, out: "–", inn: "–", total: formatState(cumulativeState, true) },
    { participantId: pB.id, out: "–", inn: "–", total: formatState(cumulativeState, false) },
  ];

  return { tabLabel: "Match", holeResults, summaries, higherIsBetter: false, isTeamView: false };
}

function computeSkins(
  participants: Participant[],
  holes: Hole[],
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>
): FormatDisplayData {
  const holeResults: Record<string, FormatHoleResult> = {};
  const skinCounts: Record<string, number> = {};
  for (const p of participants) skinCounts[p.id] = 0;

  let carryover = 0;

  for (const h of holes) {
    let bestNet = Infinity;
    let bestPids: string[] = [];

    for (const p of participants) {
      const gross = grossFor(p.id, h.hole_number, scoresByKey, holeStatesByKey);
      if (gross === null || !h.par) continue;
      const recv = strokesReceivedOnHole(playingHcp(p), h.stroke_index);
      const net = netFromGross(gross, recv);
      if (net < bestNet) {
        bestNet = net;
        bestPids = [p.id];
      } else if (net === bestNet) {
        bestPids.push(p.id);
      }
    }

    const skinValue = 1 + carryover;

    if (bestPids.length === 1) {
      skinCounts[bestPids[0]] += skinValue;
      carryover = 0;
      for (const p of participants) {
        const key = `${p.id}:${h.hole_number}`;
        if (p.id === bestPids[0]) {
          holeResults[key] = { displayValue: skinValue, cssHint: "won" };
        } else {
          holeResults[key] = { displayValue: 0, cssHint: "neutral" };
        }
      }
    } else {
      carryover += 1;
      for (const p of participants) {
        holeResults[`${p.id}:${h.hole_number}`] = { displayValue: "–", cssHint: "halved" };
      }
    }
  }

  const summaries: FormatSummary[] = participants.map((p) => ({
    participantId: p.id,
    out: "–",
    inn: "–",
    total: skinCounts[p.id],
  }));

  return { tabLabel: "Skins", holeResults, summaries, higherIsBetter: true, isTeamView: false };
}

// ── Team format helpers ────────────────────────────────────────────────

function buildTeamMap(participants: Participant[], teams: Team[]): Map<string, Participant[]> {
  const map = new Map<string, Participant[]>();
  for (const t of teams) map.set(t.id, []);
  for (const p of participants) {
    if (p.team_id && map.has(p.team_id)) {
      map.get(p.team_id)!.push(p);
    }
  }
  return map;
}

function computeTeamStrokeplay(
  participants: Participant[],
  holes: Hole[],
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>,
  teams: Team[]
): FormatDisplayData | null {
  if (!teams.length) return null;
  const teamMap = buildTeamMap(participants, teams);
  const holeResults: Record<string, FormatHoleResult> = {};

  for (const [teamId, members] of teamMap) {
    for (const h of holes) {
      let sum = 0;
      let anyScore = false;
      for (const p of members) {
        const gross = grossFor(p.id, h.hole_number, scoresByKey, holeStatesByKey);
        if (gross !== null) { sum += gross; anyScore = true; }
      }
      holeResults[`${teamId}:${h.hole_number}`] = anyScore
        ? { displayValue: sum }
        : { displayValue: null };
    }
  }

  const summaries: FormatSummary[] = teams.map((t) => ({
    participantId: t.id,
    teamId: t.id,
    out: sumRange(holeResults, t.id, holes, 1, 9),
    inn: sumRange(holeResults, t.id, holes, 10, 18),
    total: sumRange(holeResults, t.id, holes, 1, 18),
  }));

  return { tabLabel: "Team", holeResults, summaries, higherIsBetter: false, isTeamView: true };
}

function computeTeamStableford(
  participants: Participant[],
  holes: Hole[],
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>,
  teams: Team[],
  formatConfig: Record<string, any>
): FormatDisplayData | null {
  if (!teams.length) return null;
  const teamMap = buildTeamMap(participants, teams);
  const pointsTable = { ...DEFAULT_STABLEFORD, ...(formatConfig.points_table ?? {}) };
  const holeResults: Record<string, FormatHoleResult> = {};

  for (const [teamId, members] of teamMap) {
    for (const h of holes) {
      let sum = 0;
      let anyScore = false;
      for (const p of members) {
        const pts = playerStablefordPtsOnHole(p, h, scoresByKey, holeStatesByKey, pointsTable);
        if (pts !== null) { sum += pts; anyScore = true; }
      }
      holeResults[`${teamId}:${h.hole_number}`] = anyScore
        ? { displayValue: sum, cssHint: sum >= 4 ? "positive" : sum === 0 ? "negative" : "neutral" }
        : { displayValue: null };
    }
  }

  const summaries: FormatSummary[] = teams.map((t) => ({
    participantId: t.id,
    teamId: t.id,
    out: sumRange(holeResults, t.id, holes, 1, 9),
    inn: sumRange(holeResults, t.id, holes, 10, 18),
    total: sumRange(holeResults, t.id, holes, 1, 18),
  }));

  return { tabLabel: "Team Stblfd", holeResults, summaries, higherIsBetter: true, isTeamView: true };
}

function computeTeamBestBall(
  participants: Participant[],
  holes: Hole[],
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>,
  teams: Team[],
  formatConfig: Record<string, any>
): FormatDisplayData | null {
  if (!teams.length) return null;
  const teamMap = buildTeamMap(participants, teams);
  const holeResults: Record<string, FormatHoleResult> = {};

  const scoringType: string = formatConfig.scoring_type || "net_strokes";
  const countPerHole: number = formatConfig.count_per_hole || 1;
  const pointsTable = { ...DEFAULT_STABLEFORD, ...(formatConfig.points_table ?? {}) };

  for (const [teamId, members] of teamMap) {
    for (const h of holes) {
      if (scoringType === "stableford") {
        // Best X stableford points
        const allPts: number[] = [];
        for (const p of members) {
          const pts = playerStablefordPtsOnHole(p, h, scoresByKey, holeStatesByKey, pointsTable);
          if (pts !== null) allPts.push(pts);
        }
        if (allPts.length === 0) {
          holeResults[`${teamId}:${h.hole_number}`] = { displayValue: null };
        } else {
          allPts.sort((a, b) => b - a); // highest first
          const topN = allPts.slice(0, countPerHole);
          const sum = topN.reduce((a, b) => a + b, 0);
          holeResults[`${teamId}:${h.hole_number}`] = {
            displayValue: sum,
            cssHint: sum >= 3 ? "positive" : sum === 0 ? "negative" : "neutral",
          };
        }
      } else {
        // Best X net strokes (lowest)
        const allNets: number[] = [];
        for (const p of members) {
          const gross = grossFor(p.id, h.hole_number, scoresByKey, holeStatesByKey);
          if (gross === null) continue;
          const recv = strokesReceivedOnHole(playingHcp(p), h.stroke_index);
          allNets.push(netFromGross(gross, recv));
        }
        if (allNets.length === 0) {
          holeResults[`${teamId}:${h.hole_number}`] = { displayValue: null };
        } else {
          allNets.sort((a, b) => a - b); // lowest first
          const topN = allNets.slice(0, countPerHole);
          const sum = topN.reduce((a, b) => a + b, 0);
          holeResults[`${teamId}:${h.hole_number}`] = { displayValue: sum };
        }
      }
    }
  }

  const higherIsBetter = scoringType === "stableford";
  const summaries: FormatSummary[] = teams.map((t) => ({
    participantId: t.id,
    teamId: t.id,
    out: sumRange(holeResults, t.id, holes, 1, 9),
    inn: sumRange(holeResults, t.id, holes, 10, 18),
    total: sumRange(holeResults, t.id, holes, 1, 18),
  }));

  return { tabLabel: "Best Ball", holeResults, summaries, higherIsBetter, isTeamView: true };
}

// ── Pairs Stableford ──────────────────────────────────────────────────

function computePairsStableford(
  participants: Participant[],
  holes: Hole[],
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>,
  teams: Team[],
  formatConfig: Record<string, any>
): FormatDisplayData | null {
  if (!teams.length) return null;
  const teamMap = buildTeamMap(participants, teams);
  const pointsTable = { ...DEFAULT_STABLEFORD, ...(formatConfig.points_table ?? {}) };
  const scoringMode: string = formatConfig.scoring_mode || "best";
  const countPerHole: number = formatConfig.count_per_hole || 1;
  const holeResults: Record<string, FormatHoleResult> = {};

  for (const [teamId, members] of teamMap) {
    for (const h of holes) {
      const allPts: number[] = [];
      for (const p of members) {
        const pts = playerStablefordPtsOnHole(p, h, scoresByKey, holeStatesByKey, pointsTable);
        if (pts !== null) allPts.push(pts);
      }

      if (allPts.length === 0) {
        holeResults[`${teamId}:${h.hole_number}`] = { displayValue: null };
        continue;
      }

      let teamPts: number;
      if (scoringMode === "combined") {
        teamPts = allPts.reduce((a, b) => a + b, 0);
      } else if (scoringMode === "worst") {
        allPts.sort((a, b) => a - b); // lowest first
        const selected = allPts.slice(0, countPerHole);
        teamPts = selected.reduce((a, b) => a + b, 0);
      } else {
        // "best" (default)
        allPts.sort((a, b) => b - a); // highest first
        const selected = allPts.slice(0, countPerHole);
        teamPts = selected.reduce((a, b) => a + b, 0);
      }

      holeResults[`${teamId}:${h.hole_number}`] = {
        displayValue: teamPts,
        cssHint: teamPts >= 3 ? "positive" : teamPts === 0 ? "negative" : "neutral",
      };
    }
  }

  const summaries: FormatSummary[] = teams.map((t) => ({
    participantId: t.id,
    teamId: t.id,
    out: sumRange(holeResults, t.id, holes, 1, 9),
    inn: sumRange(holeResults, t.id, holes, 10, 18),
    total: sumRange(holeResults, t.id, holes, 1, 18),
  }));

  return { tabLabel: "Pairs Stblfd", holeResults, summaries, higherIsBetter: true, isTeamView: true };
}

// ── Single-score team formats ─────────────────────────────────────────

function computeTeamSingleScore(
  tabLabel: string,
  participants: Participant[],
  holes: Hole[],
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>,
  teams: Team[]
): FormatDisplayData | null {
  // Scramble, Greensomes, Foursomes — all team members share the same score
  // In practice the first member's score is the team score
  if (!teams.length) return null;
  const teamMap = buildTeamMap(participants, teams);
  const holeResults: Record<string, FormatHoleResult> = {};

  for (const [teamId, members] of teamMap) {
    for (const h of holes) {
      let teamScore: number | null = null;
      for (const p of members) {
        const gross = grossFor(p.id, h.hole_number, scoresByKey, holeStatesByKey);
        if (gross !== null) { teamScore = gross; break; }
      }
      holeResults[`${teamId}:${h.hole_number}`] = teamScore !== null
        ? { displayValue: teamScore }
        : { displayValue: null };
    }
  }

  const summaries: FormatSummary[] = teams.map((t) => ({
    participantId: t.id,
    teamId: t.id,
    out: sumRange(holeResults, t.id, holes, 1, 9),
    inn: sumRange(holeResults, t.id, holes, 10, 18),
    total: sumRange(holeResults, t.id, holes, 1, 18),
  }));

  return { tabLabel, holeResults, summaries, higherIsBetter: false, isTeamView: true };
}

// ── Strokeplay format tab (conditional) ───────────────────────────────

function computeStrokeplayFormatTab(
  participants: Participant[],
  holes: Hole[],
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>
): FormatDisplayData | null {
  // Only show format tab if any player's playing_handicap_used differs from course_handicap_used
  // (meaning an allowance %, manual override, or compare_against_lowest was applied)
  const hasAdjustedHandicap = participants.some((p) => {
    const ph = typeof p.playing_handicap_used === "number" ? p.playing_handicap_used : null;
    const ch = typeof p.course_handicap_used === "number" ? p.course_handicap_used : null;
    if (ph === null && ch === null) return false;
    return ph !== ch;
  });

  if (!hasAdjustedHandicap) return null;

  // Show net scores using the playing handicap
  const holeResults: Record<string, FormatHoleResult> = {};

  for (const p of participants) {
    const hcp = playingHcp(p);
    for (const h of holes) {
      const key = `${p.id}:${h.hole_number}`;
      const gross = grossFor(p.id, h.hole_number, scoresByKey, holeStatesByKey);
      if (gross === null || !h.par) {
        holeResults[key] = { displayValue: null };
        continue;
      }
      const recv = strokesReceivedOnHole(hcp, h.stroke_index);
      const net = netFromGross(gross, recv);
      holeResults[key] = { displayValue: net };
    }
  }

  const summaries: FormatSummary[] = participants.map((p) => ({
    participantId: p.id,
    out: sumRange(holeResults, p.id, holes, 1, 9),
    inn: sumRange(holeResults, p.id, holes, 10, 18),
    total: sumRange(holeResults, p.id, holes, 1, 18),
  }));

  return { tabLabel: "Playing Hcp", holeResults, summaries, higherIsBetter: false, isTeamView: false };
}

// ── Main dispatcher ────────────────────────────────────────────────────

/**
 * Compute format-specific display data for the "Format" tab.
 * Returns `null` when no special tab is needed (e.g. strokeplay with 100% allowance).
 */
export function computeFormatDisplay(
  formatType: RoundFormatType,
  formatConfig: Record<string, any>,
  participants: Participant[],
  holes: Hole[],
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>,
  teams: Team[]
): FormatDisplayData | null {
  switch (formatType) {
    case "strokeplay":
      return computeStrokeplayFormatTab(participants, holes, scoresByKey, holeStatesByKey);

    case "stableford":
      return computeStableford(participants, holes, scoresByKey, holeStatesByKey, formatConfig);

    case "matchplay":
      return computeMatchPlay(participants, holes, scoresByKey, holeStatesByKey, formatConfig);

    case "skins":
      return computeSkins(participants, holes, scoresByKey, holeStatesByKey);

    case "pairs_stableford":
      return computePairsStableford(participants, holes, scoresByKey, holeStatesByKey, teams, formatConfig);

    case "team_strokeplay":
      return computeTeamStrokeplay(participants, holes, scoresByKey, holeStatesByKey, teams);

    case "team_stableford":
      return computeTeamStableford(participants, holes, scoresByKey, holeStatesByKey, teams, formatConfig);

    case "team_bestball":
      return computeTeamBestBall(participants, holes, scoresByKey, holeStatesByKey, teams, formatConfig);

    case "scramble":
      return computeTeamSingleScore("Scramble", participants, holes, scoresByKey, holeStatesByKey, teams);

    case "greensomes":
      return computeTeamSingleScore("Greensomes", participants, holes, scoresByKey, holeStatesByKey, teams);

    case "foursomes":
      return computeTeamSingleScore("Foursomes", participants, holes, scoresByKey, holeStatesByKey, teams);

    case "wolf":
      // Wolf is a complex rotating partner game — placeholder
      return { tabLabel: "Wolf", holeResults: {}, summaries: [], higherIsBetter: true, isTeamView: false };

    default:
      return null;
  }
}
