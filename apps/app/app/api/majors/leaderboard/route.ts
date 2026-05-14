import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import {
  getCompetitionLeaderboard,
  getGroupStandings,
  getCompetitionById,
  getCompetitionSubmissionMap,
  getCompetitionPendingParticipants,
} from "@/lib/majors/queries";
import type { FrozenLeaderboardEntry } from "@/lib/majors/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);

    const competitionId = url.searchParams.get("competition_id");
    const groupId = url.searchParams.get("group_id");

    if (competitionId) {
      const competition = await getCompetitionById(competitionId);
      if (!competition) {
        return NextResponse.json({ error: "Competition not found" }, { status: 404 });
      }

      const {
        leaderboard_freeze_state,
        leaderboard_freeze_last_holes,
        leaderboard_freeze_scope,
        leaderboard_freeze_top_x,
        leaderboard_reveal_style,
        leaderboard_reveal_top_x,
        num_rounds,
      } = competition as any;

      const freezeConfig = {
        freeze_state: leaderboard_freeze_state ?? "live",
        freeze_last_holes: leaderboard_freeze_last_holes ?? null,
        freeze_scope: leaderboard_freeze_scope ?? "all",
        freeze_top_x: leaderboard_freeze_top_x ?? null,
        reveal_style: leaderboard_reveal_style ?? "none",
        reveal_top_x: leaderboard_reveal_top_x ?? null,
        total_holes: (num_rounds ?? 1) * 18,
      };

      let myRole: string | null = null;
      if ((competition as any).group_id) {
        const { data: mem } = await supabaseAdmin
          .from("major_group_memberships")
          .select("role")
          .eq("group_id", (competition as any).group_id)
          .eq("profile_id", profileId)
          .eq("status", "active")
          .maybeSingle();
        myRole = (mem as any)?.role ?? null;
      } else if ((competition as any).created_by_profile_id === profileId) {
        myRole = "owner";
      }

      const isFrozen = freezeConfig.freeze_state === "frozen" && freezeConfig.freeze_last_holes != null;

      if (isFrozen) {
        const threshold = freezeConfig.total_holes - (freezeConfig.freeze_last_holes as number);
        const rows = await getFrozenLeaderboard(competitionId, threshold, freezeConfig);
        return NextResponse.json(
          {
            rows,
            freeze: freezeConfig,
            my_role: myRole,
            scoring_model: (competition as any).scoring_model ?? "net",
          },
          { headers: { "Cache-Control": "no-store" } }
        );
      }

      const [liveRows, submissionMap] = await Promise.all([
        getCompetitionLeaderboard(competitionId),
        getCompetitionSubmissionMap(competitionId),
      ]);

      const scoredIds = new Set(liveRows.map((r) => r.profile_id));
      const pendingParticipants = await getCompetitionPendingParticipants(competitionId, scoredIds);

      const rows = [
        ...liveRows.map((r) => ({
          ...r,
          round_id: submissionMap[r.profile_id] ?? null,
          tee_time: null as string | null,
        })),
        ...pendingParticipants.map((p) => ({
          profile_id: p.profile_id,
          profile: { id: p.profile_id, name: p.name, avatar_url: p.avatar_url },
          gross_score: null,
          net_score: null,
          format_points: null,
          points_earned: null,
          rounds_submitted: 0,
          last_submission_at: null,
          is_live: false,
          holes_completed: 0,
          position: null,
          computed_at: null,
          competition_id: competitionId,
          round_id: null,
          tee_time: p.tee_time,
        })),
      ];

      return NextResponse.json(
        {
          rows,
          freeze: freezeConfig,
          my_role: myRole,
          scoring_model: (competition as any).scoring_model ?? "net",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (groupId) {
      const rows = await getGroupStandings(groupId);
      return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ error: "Provide competition_id or group_id" }, { status: 400 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

async function getFrozenLeaderboard(
  competitionId: string,
  threshold: number,
  freezeConfig: {
    freeze_scope: string;
    freeze_top_x: number | null;
  }
): Promise<FrozenLeaderboardEntry[]> {
  // Get per-hole-truncated scores from DB function
  const { data: frozenRows, error } = await supabaseAdmin.rpc(
    "ciaga_get_frozen_leaderboard",
    { p_competition_id: competitionId, p_threshold_hole: threshold }
  );
  if (error) throw error;

  // Fetch profiles for all players in frozen results
  const profileIds = (frozenRows ?? []).map((r: any) => r.profile_id as string);
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, name, avatar_url")
    .in("id", profileIds);
  const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));

  const frozen = ((frozenRows ?? []) as any[]).map((r): FrozenLeaderboardEntry => ({
    profile_id: r.profile_id,
    gross_score: r.gross_score,
    net_score: r.net_score,
    holes_shown: r.holes_shown,
    is_live: r.is_live,
    position: r.leaderboard_pos,
    profile: profileMap[r.profile_id] ?? undefined,
  }));

  // For top_x freeze scope: only freeze positions 1..top_x; the rest show live scores
  if (freezeConfig.freeze_scope === "top_x" && freezeConfig.freeze_top_x != null) {
    const topX = freezeConfig.freeze_top_x;
    const liveRows = await getCompetitionLeaderboard(competitionId);
    const liveByProfile = Object.fromEntries(liveRows.map((r) => [r.profile_id, r]));

    return frozen.map((row) => {
      if (row.position > topX) {
        // Replace with live data for this player
        const live = liveByProfile[row.profile_id];
        if (live) {
          return {
            ...row,
            gross_score: live.gross_score,
            net_score: live.net_score,
            holes_shown: live.holes_completed,
            is_live: live.is_live,
          };
        }
      }
      return row;
    });
  }

  return frozen;
}
