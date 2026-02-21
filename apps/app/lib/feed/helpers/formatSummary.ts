/**
 * Server-side helper that computes format scores for a round,
 * bridging the DB to the pure `computeFormatDisplay` / `computeSideGameDisplays`
 * functions from formatScoring.ts.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  computeFormatDisplay,
  computeSideGameDisplays,
  type FormatDisplayData,
  type FormatSummary,
} from "@/lib/rounds/formatScoring";
import type {
  RoundFormatType,
  Participant,
  Hole,
  Score,
  HoleState,
  Team,
  SideGame,
} from "@/lib/rounds/hooks/useRoundDetail";

// ── Public types ─────────────────────────────────────────────────────

export type FormatFeedSummary = {
  format_type: string;
  format_label: string;
  /** participantId → display score (number for points, string for match results) */
  player_scores: Map<string, string | number>;
  format_winner: string | null;
  side_game_results: Array<{ label: string; winner: string | null }>;
};

// ── Pre-fetched data variant (used by batch RPC path) ────────────────

export type FormatSummaryInput = {
  format_type: string | null;
  format_config: Record<string, any>;
  side_games: SideGame[];
  participants: Participant[];
  teams: Team[];
  holes: Hole[];
  scoresByKey: Record<string, Score>;
  holeStatesByKey: Record<string, HoleState>;
};

/**
 * Compute format summary from pre-fetched data (no DB queries).
 * Used by the batch RPC path to avoid per-round query fan-out.
 */
export function computeFormatSummaryFromData(
  input: FormatSummaryInput,
): FormatFeedSummary | null {
  const formatType = input.format_type as RoundFormatType | null;
  if (!formatType) return null;

  const { format_config: formatConfig, side_games: sideGames, participants, teams, holes, scoresByKey, holeStatesByKey } = input;
  if (!holes.length) return null;

  return _computeFromParsedData(formatType, formatConfig, sideGames, participants, teams, holes, scoresByKey, holeStatesByKey);
}

// ── DB-fetching entry point (legacy, still used by non-batch callers) ─

export async function computeFormatSummaryForFeed(
  roundId: string,
): Promise<FormatFeedSummary | null> {
  // 1. Round metadata
  const { data: round, error: rErr } = await supabaseAdmin
    .from("rounds")
    .select("format_type, format_config, side_games")
    .eq("id", roundId)
    .single();

  if (rErr || !round) return null;

  const formatType = (round as any).format_type as RoundFormatType | null;
  if (!formatType) return null;

  const formatConfig: Record<string, any> =
    typeof (round as any).format_config === "object" && (round as any).format_config
      ? (round as any).format_config
      : {};

  const sideGames: SideGame[] = Array.isArray((round as any).side_games)
    ? (round as any).side_games
    : [];

  // 2. Participants
  const { data: partRows, error: pErr } = await supabaseAdmin
    .from("round_participants")
    .select(
      "id, profile_id, is_guest, display_name, role, tee_snapshot_id, team_id, playing_handicap_used, course_handicap_used",
    )
    .eq("round_id", roundId)
    .order("created_at", { ascending: true });

  if (pErr || !partRows?.length) return null;

  const participants: Participant[] = (partRows as any[]).map((r) => ({
    id: r.id,
    profile_id: r.profile_id ?? null,
    is_guest: !!r.is_guest,
    display_name: r.display_name ?? null,
    role: r.role ?? "player",
    tee_snapshot_id: r.tee_snapshot_id ?? null,
    team_id: r.team_id ?? null,
    playing_handicap_used:
      typeof r.playing_handicap_used === "number" ? r.playing_handicap_used : null,
    course_handicap_used:
      typeof r.course_handicap_used === "number" ? r.course_handicap_used : null,
  }));

  const participantIds = participants.map((p) => p.id);

  // 3. Teams
  const { data: teamRows } = await supabaseAdmin
    .from("round_teams")
    .select("id, round_id, name, team_number")
    .eq("round_id", roundId)
    .order("team_number", { ascending: true });

  const teams: Team[] = (teamRows ?? []).map((t: any) => ({
    id: t.id,
    round_id: t.round_id,
    name: t.name ?? `Team ${t.team_number}`,
    team_number: t.team_number,
  }));

  // 4. Tee snapshot IDs → hole snapshots
  const teeSnapIds = Array.from(
    new Set(participants.map((p) => p.tee_snapshot_id).filter(Boolean)),
  ) as string[];

  let holes: Hole[] = [];
  if (teeSnapIds.length) {
    const { data: holeRows } = await supabaseAdmin
      .from("round_hole_snapshots")
      .select("hole_number, par, yardage, stroke_index")
      .in("round_tee_snapshot_id", teeSnapIds)
      .order("hole_number", { ascending: true });

    // Deduplicate by hole_number (all tee snapshots in a round share the same holes)
    const seen = new Set<number>();
    for (const h of (holeRows ?? []) as any[]) {
      const hn = h.hole_number as number;
      if (seen.has(hn)) continue;
      seen.add(hn);
      holes.push({
        hole_number: hn,
        par: h.par ?? null,
        yardage: h.yardage ?? null,
        stroke_index: h.stroke_index ?? null,
      });
    }
  }

  if (!holes.length) return null;

  // 5. Scores
  const { data: scoreRows } = await supabaseAdmin
    .from("round_current_scores")
    .select("participant_id, hole_number, strokes, created_at")
    .eq("round_id", roundId)
    .in("participant_id", participantIds);

  const scoresByKey: Record<string, Score> = {};
  for (const s of (scoreRows ?? []) as any[]) {
    const key = `${s.participant_id}:${s.hole_number}`;
    scoresByKey[key] = {
      participant_id: s.participant_id,
      hole_number: s.hole_number,
      strokes: typeof s.strokes === "number" ? s.strokes : null,
      created_at: s.created_at ?? "",
    };
  }

  // 6. Hole states
  const { data: stateRows } = await supabaseAdmin
    .from("round_hole_states")
    .select("participant_id, hole_number, status")
    .eq("round_id", roundId)
    .in("participant_id", participantIds);

  const holeStatesByKey: Record<string, HoleState> = {};
  for (const hs of (stateRows ?? []) as any[]) {
    const key = `${hs.participant_id}:${hs.hole_number}`;
    const status = hs.status as string;
    if (status === "completed" || status === "picked_up" || status === "not_started") {
      holeStatesByKey[key] = status;
    }
  }

  return _computeFromParsedData(formatType, formatConfig, sideGames, participants, teams, holes, scoresByKey, holeStatesByKey);
}

// ── Shared computation logic ─────────────────────────────────────────

function _computeFromParsedData(
  formatType: RoundFormatType,
  formatConfig: Record<string, any>,
  sideGames: SideGame[],
  participants: Participant[],
  teams: Team[],
  holes: Hole[],
  scoresByKey: Record<string, Score>,
  holeStatesByKey: Record<string, HoleState>,
): FormatFeedSummary | null {
  // Compute format display
  const nameOf = (p: Participant) => p.display_name || "Player";

  const formatDisplays = computeFormatDisplay(
    formatType,
    formatConfig,
    participants,
    holes,
    scoresByKey,
    holeStatesByKey,
    teams,
    nameOf,
  );

  // 8. Compute side game displays
  const sideGameDisplays = computeSideGameDisplays(
    sideGames,
    participants,
    holes,
    scoresByKey,
    holeStatesByKey,
  );

  // 9. Extract primary format info
  const primary = formatDisplays[0] ?? null;

  // Build player_scores and determine winner from the primary format
  const player_scores = new Map<string, string | number>();
  let format_label = primary?.tabLabel ?? formatLabelForType(formatType);
  let format_winner: string | null = null;

  if (primary) {
    // Map summaries → per-participant scores
    for (const s of primary.summaries) {
      player_scores.set(s.participantId, s.total);
    }

    // Determine winner
    format_winner = determineWinner(
      primary.summaries,
      primary.higherIsBetter,
      primary.isTeamView,
      participants,
      teams,
    );
  } else {
    // Strokeplay with no adjusted handicap: computeFormatDisplay returns []
    // Build gross to-par scores manually
    format_label = "Strokeplay";
    for (const p of participants) {
      let gross = 0;
      let par = 0;
      let played = 0;
      for (const h of holes) {
        const score = scoresByKey[`${p.id}:${h.hole_number}`];
        if (score && typeof score.strokes === "number" && h.par) {
          gross += score.strokes;
          par += h.par;
          played++;
        }
      }
      if (played > 0) {
        const toPar = gross - par;
        player_scores.set(p.id, toPar === 0 ? "E" : toPar > 0 ? `+${toPar}` : `${toPar}`);
      }
    }

    // Winner = lowest gross
    const sortable = participants
      .map((p) => {
        let gross = 0;
        let count = 0;
        for (const h of holes) {
          const sc = scoresByKey[`${p.id}:${h.hole_number}`];
          if (sc && typeof sc.strokes === "number") {
            gross += sc.strokes;
            count++;
          }
        }
        return { p, gross, count };
      })
      .filter((x) => x.count > 0);

    sortable.sort((a, b) => a.gross - b.gross);
    if (sortable.length > 0) {
      const best = sortable[0];
      const name = best.p.display_name || "Player";
      const score = player_scores.get(best.p.id);
      format_winner = `${name} won (${score ?? best.gross})`;
    }
  }

  // 10. Side game results
  const side_game_results: Array<{ label: string; winner: string | null }> = [];
  for (const sgd of sideGameDisplays) {
    const winner = determineWinner(
      sgd.summaries,
      sgd.higherIsBetter,
      sgd.isTeamView,
      participants,
      teams,
    );
    side_game_results.push({ label: sgd.tabLabel, winner });
  }

  return {
    format_type: formatType,
    format_label,
    player_scores,
    format_winner,
    side_game_results,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatLabelForType(ft: string): string {
  const map: Record<string, string> = {
    strokeplay: "Strokeplay",
    stableford: "Stableford",
    matchplay: "Match",
    skins: "Skins",
    pairs_stableford: "Pairs Stblfd",
    team_strokeplay: "Team",
    team_stableford: "Team Stblfd",
    team_bestball: "Best Ball",
    scramble: "Scramble",
    greensomes: "Greensomes",
    foursomes: "Foursomes",
    wolf: "Wolf",
  };
  return map[ft] ?? ft;
}

function determineWinner(
  summaries: FormatSummary[],
  higherIsBetter: boolean,
  isTeamView: boolean,
  participants: Participant[],
  teams: Team[],
): string | null {
  if (!summaries.length) return null;

  // Filter to summaries with numeric totals for comparison
  const numeric = summaries.filter(
    (s) => typeof s.total === "number" && Number.isFinite(s.total as number),
  );

  // For string totals (matchplay), find the first non-tie result
  if (!numeric.length) {
    const strResults = summaries.filter(
      (s) => typeof s.total === "string" && s.total !== "AS" && s.total !== "—",
    );
    if (strResults.length) {
      const best = strResults[0];
      const name = resolveEntityName(best, isTeamView, participants, teams);
      return `${name} won (${best.total})`;
    }
    return null;
  }

  // Sort by total
  const sorted = [...numeric].sort((a, b) => {
    const aVal = a.total as number;
    const bVal = b.total as number;
    return higherIsBetter ? bVal - aVal : aVal - bVal;
  });

  const best = sorted[0];
  const name = resolveEntityName(best, isTeamView, participants, teams);
  const score = best.total;

  return `${name} won (${score})`;
}

function resolveEntityName(
  summary: FormatSummary,
  isTeamView: boolean,
  participants: Participant[],
  teams: Team[],
): string {
  if (isTeamView && summary.teamId) {
    const team = teams.find((t) => t.id === summary.teamId);
    return team?.name ?? "Team";
  }

  const participant = participants.find((p) => p.id === summary.participantId);
  return participant?.display_name || "Player";
}
