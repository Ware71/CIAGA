import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// ── Types ────────────────────────────────────────────────────────────────────

export type LiveGroupStandingEntry = {
  profile_id: string;
  profile: { id: string; name: string | null; avatar_url: string | null };
  /** Points locked in from completed/official competitions only */
  confirmed_points: number;
  /** Projected points from the current in-progress competition (0 if none) */
  live_points_pending: number;
  live_total_points: number;
  events_played: number;
  wins: number;
  /** Rank by confirmed_points only */
  confirmed_position: number | null;
  /** Rank by live_total_points */
  live_position: number | null;
};

export type LiveGroupStandingsResponse = {
  hasLive: boolean;
  rows: LiveGroupStandingEntry[];
  liveRoundIds: string[];
  /** IDs of live competitions (for competition_leaderboard_entries subscription) */
  liveCompetitionIds: string[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPointsForPosition(
  position: number | null,
  pointsModel: string | null,
  pointsTable: Record<string, number> | null
): number | null {
  if (position == null || !pointsModel || pointsModel === "none") return null;
  if (pointsModel === "fedex_style") {
    const table = [500, 300, 190, 140, 110, 90, 75, 60, 48, 38, 30, 24, 18, 14, 10, 8, 6, 4, 2, 1];
    return table[Math.min(position, 20) - 1] ?? 0;
  }
  if ((pointsModel === "position_based" || pointsModel === "custom_table") && pointsTable) {
    return pointsTable[String(position)] ?? 0;
  }
  return null;
}

/** Dense rank: tied players share a position; next rank increments by 1. */
function denseRank(players: Array<{ profileId: string; score: number | null }>, higherBetter: boolean) {
  const withScores = players.filter((p) => p.score != null);
  withScores.sort((a, b) => {
    if (a.score! === b.score!) return 0;
    return higherBetter ? b.score! - a.score! : a.score! - b.score!;
  });

  const ranks = new Map<string, number>();
  let rank = 1;
  for (let i = 0; i < withScores.length; i++) {
    if (i > 0 && withScores[i].score !== withScores[i - 1].score) {
      rank = i + 1;
    }
    ranks.set(withScores[i].profileId, rank);
  }
  return ranks;
}

// ── Route ────────────────────────────────────────────────────────────────────

// GET /api/majors/groups/[id]/live-standings
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id: groupId } = await params;

    // ── 1. Fetch live and completed competitions in parallel ──────────────
    const [liveCompsRes, completedCompsRes] = await Promise.all([
      supabaseAdmin
        .from("competitions")
        .select("id, points_model, points_table, scoring_model, num_rounds")
        .eq("group_id", groupId)
        .eq("majors_status", "live")
        .in("standings_contribution", ["season", "both"]),
      supabaseAdmin
        .from("competitions")
        .select("id")
        .eq("group_id", groupId)
        .in("majors_status", ["completed", "official"])
        .in("standings_contribution", ["season", "both"]),
    ]);

    if (liveCompsRes.error) throw liveCompsRes.error;
    if (completedCompsRes.error) throw completedCompsRes.error;

    const liveComps = liveCompsRes.data ?? [];
    const completedCompIds = (completedCompsRes.data ?? []).map((c) => c.id);

    // ── 2. Confirmed points: aggregate from competition_leaderboard_entries ──
    const confirmedMap = new Map<
      string,
      { confirmed_points: number; events: Set<string>; wins: number }
    >();

    if (completedCompIds.length > 0) {
      const { data: confirmedEntries, error: ceErr } = await supabaseAdmin
        .from("competition_leaderboard_entries")
        .select("profile_id, points_earned, position, competition_id")
        .in("competition_id", completedCompIds)
        .not("net_score", "is", null);

      if (ceErr) throw ceErr;

      for (const entry of confirmedEntries ?? []) {
        if (!entry.profile_id) continue;
        const existing = confirmedMap.get(entry.profile_id) ?? {
          confirmed_points: 0,
          events: new Set<string>(),
          wins: 0,
        };
        existing.confirmed_points += entry.points_earned ?? 0;
        existing.events.add(entry.competition_id);
        if (entry.position === 1) existing.wins += 1;
        confirmedMap.set(entry.profile_id, existing);
      }
    }

    // ── 3. Live pending points: compute from current in-progress scores ────
    const livePointsMap = new Map<string, number>();
    const allLiveRoundIds: string[] = [];

    for (const comp of liveComps) {
      const higherBetter = (comp.scoring_model as string | null) === "stableford_points";
      const numRounds = (comp as any).num_rounds ?? 1;
      const pointsModel = (comp.points_model as string | null) ?? "none";
      const pointsTable = (comp.points_table as Record<string, number> | null) ?? null;

      // 3a. Get tee times + round IDs
      const { data: teeTimes, error: ttErr } = await supabaseAdmin
        .from("competition_tee_times")
        .select("id, round_id")
        .eq("competition_id", comp.id);
      if (ttErr) throw ttErr;

      const roundIds = (teeTimes ?? []).map((t) => t.round_id).filter(Boolean) as string[];
      if (!roundIds.length) continue;

      // 3b. Round statuses
      const { data: rounds, error: rErr } = await supabaseAdmin
        .from("rounds")
        .select("id, status")
        .in("id", roundIds);
      if (rErr) throw rErr;

      const roundStatusMap = new Map((rounds ?? []).map((r) => [r.id, r.status]));
      const liveRoundIdsForComp = roundIds.filter(
        (id) => roundStatusMap.get(id) === "live" || roundStatusMap.get(id) === "starting"
      );
      const finishedRoundIdsForComp = roundIds.filter(
        (id) => roundStatusMap.get(id) === "finished"
      );

      allLiveRoundIds.push(...liveRoundIdsForComp);

      // Map: profileId → { netScore, holesCompleted }
      const competitionPlayerScores = new Map<
        string,
        { netScore: number | null; holesCompleted: number }
      >();

      // 3c. Finished rounds in this live competition: read from leaderboard entries
      if (finishedRoundIdsForComp.length > 0) {
        // Find which profiles played finished rounds in this competition
        const { data: finParticipants, error: fpErr } = await supabaseAdmin
          .from("round_participants")
          .select("profile_id")
          .in("round_id", finishedRoundIdsForComp);
        if (fpErr) throw fpErr;

        const finProfileIds = new Set(
          (finParticipants ?? []).map((p) => p.profile_id).filter(Boolean) as string[]
        );

        if (finProfileIds.size > 0) {
          const { data: leaderEntries, error: leErr } = await supabaseAdmin
            .from("competition_leaderboard_entries")
            .select("profile_id, net_score, holes_completed, is_live")
            .eq("competition_id", comp.id)
            .eq("is_live", false);
          if (leErr) throw leErr;

          for (const le of leaderEntries ?? []) {
            if (!le.profile_id || !finProfileIds.has(le.profile_id)) continue;
            competitionPlayerScores.set(le.profile_id, {
              netScore: le.net_score ?? null,
              holesCompleted: le.holes_completed ?? 18,
            });
          }
        }
      }

      // 3d. Live rounds: aggregate from round_current_scores
      if (liveRoundIdsForComp.length > 0) {
        const [scoresRes, participantsRes] = await Promise.all([
          supabaseAdmin
            .from("round_current_scores")
            .select("round_id, participant_id, hole_number, strokes")
            .in("round_id", liveRoundIdsForComp),
          supabaseAdmin
            .from("round_participants")
            .select("id, profile_id, course_handicap_used, playing_handicap_used, round_id")
            .in("round_id", liveRoundIdsForComp),
        ]);

        if (scoresRes.error) throw scoresRes.error;
        if (participantsRes.error) throw participantsRes.error;

        // Participant lookup: participant_id → { profileId, courseHcp }
        const participantMap = new Map<string, { profileId: string; courseHcp: number }>();
        for (const p of participantsRes.data ?? []) {
          if (!p.profile_id) continue;
          const hcp =
            typeof (p as any).playing_handicap_used === "number"
              ? (p as any).playing_handicap_used
              : typeof p.course_handicap_used === "number"
              ? p.course_handicap_used
              : 0;
          participantMap.set(p.id, { profileId: p.profile_id, courseHcp: hcp });
        }

        // Aggregate scores per participant
        const scoreAgg = new Map<string, { gross: number; holes: Set<number> }>();
        for (const s of scoresRes.data ?? []) {
          if (typeof s.strokes !== "number") continue;
          if (!scoreAgg.has(s.participant_id)) {
            scoreAgg.set(s.participant_id, { gross: 0, holes: new Set() });
          }
          const agg = scoreAgg.get(s.participant_id)!;
          agg.gross += s.strokes;
          agg.holes.add(s.hole_number);
        }

        for (const [participantId, pInfo] of participantMap) {
          // Skip players who already have a finished submission in this competition
          if (competitionPlayerScores.has(pInfo.profileId)) continue;

          const agg = scoreAgg.get(participantId);
          const thru = agg?.holes.size ?? 0;
          const gross = agg?.gross ?? 0;
          const net = gross > 0 ? gross - pInfo.courseHcp : null;

          // If this player appears in multiple live rounds, use the one with more holes
          const existing = competitionPlayerScores.get(pInfo.profileId);
          if (!existing || thru > (existing.holesCompleted ?? 0)) {
            competitionPlayerScores.set(pInfo.profileId, {
              netScore: net,
              holesCompleted: thru,
            });
          }
        }
      }

      // 3e. Rank all players in this competition and compute projected points
      const rankInput = Array.from(competitionPlayerScores.entries()).map(
        ([profileId, { netScore }]) => ({ profileId, score: netScore })
      );
      const ranks = denseRank(rankInput, higherBetter);

      for (const [profileId, { netScore }] of competitionPlayerScores) {
        if (netScore == null) continue; // No score yet — no pending points
        const position = ranks.get(profileId) ?? null;
        const pts = getPointsForPosition(position, pointsModel, pointsTable);
        if (pts != null) {
          livePointsMap.set(profileId, (livePointsMap.get(profileId) ?? 0) + pts);
        }
      }
    }

    // ── 4. Union all profile IDs and fetch profiles ───────────────────────
    const allProfileIds = new Set<string>([
      ...confirmedMap.keys(),
      ...livePointsMap.keys(),
    ]);

    if (allProfileIds.size === 0) {
      return NextResponse.json(
        {
          hasLive: liveComps.length > 0,
          rows: [],
          liveRoundIds: allLiveRoundIds,
          liveCompetitionIds: liveComps.map((c) => c.id),
        } satisfies LiveGroupStandingsResponse,
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", [...allProfileIds]);
    if (profErr) throw profErr;

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    // ── 5. Build rows and compute positions ───────────────────────────────
    const allPlayerIds = [...allProfileIds];

    const confirmedScoreInput = allPlayerIds.map((profileId) => ({
      profileId,
      score: confirmedMap.get(profileId)?.confirmed_points ?? 0,
    }));
    // For confirmed position, rank by confirmed points (higher is better in standings)
    const confirmedRanks = denseRank(confirmedScoreInput, true);

    const liveTotalInput = allPlayerIds.map((profileId) => {
      const confirmed = confirmedMap.get(profileId)?.confirmed_points ?? 0;
      const pending = livePointsMap.get(profileId) ?? 0;
      return { profileId, score: confirmed + pending };
    });
    const liveRanks = denseRank(liveTotalInput, true);

    const rows: LiveGroupStandingEntry[] = allPlayerIds.map((profileId) => {
      const conf = confirmedMap.get(profileId);
      const confirmed_points = conf?.confirmed_points ?? 0;
      const live_points_pending = livePointsMap.get(profileId) ?? 0;
      const prof = profileMap.get(profileId);

      return {
        profile_id: profileId,
        profile: {
          id: profileId,
          name: prof?.name ?? null,
          avatar_url: prof?.avatar_url ?? null,
        },
        confirmed_points,
        live_points_pending,
        live_total_points: confirmed_points + live_points_pending,
        events_played: conf?.events.size ?? 0,
        wins: conf?.wins ?? 0,
        confirmed_position: confirmedRanks.get(profileId) ?? null,
        live_position: liveRanks.get(profileId) ?? null,
      };
    });

    // Sort by live_position ASC (nulls last), then confirmed_position
    rows.sort((a, b) => {
      const ap = a.live_position ?? 9999;
      const bp = b.live_position ?? 9999;
      if (ap !== bp) return ap - bp;
      return (a.confirmed_position ?? 9999) - (b.confirmed_position ?? 9999);
    });

    return NextResponse.json(
      {
        hasLive: liveComps.length > 0,
        rows,
        liveRoundIds: allLiveRoundIds,
        liveCompetitionIds: liveComps.map((c) => c.id),
      } satisfies LiveGroupStandingsResponse,
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
