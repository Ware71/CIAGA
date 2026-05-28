import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import {
  getEventLeaderboard,
  getGroupStandings,
  getEventById,
  getEventSubmissionMap,
  getEventPendingParticipants,
} from "@/lib/majors/queries";
import type { FrozenLeaderboardEntry } from "@/lib/majors/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);

    const eventId = url.searchParams.get("event_id");
    const groupId = url.searchParams.get("group_id");

    if (eventId) {
      const event = await getEventById(eventId);
      if (!event) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }

      const {
        leaderboard_freeze_state,
        leaderboard_freeze_last_holes,
        leaderboard_freeze_scope,
        leaderboard_freeze_top_x,
        leaderboard_reveal_style,
        leaderboard_reveal_top_x,
        num_rounds,
      } = event as any;

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
      if ((event as any).group_id) {
        const { data: mem } = await supabaseAdmin
          .from("major_group_memberships")
          .select("role")
          .eq("group_id", (event as any).group_id)
          .eq("profile_id", profileId)
          .eq("status", "active")
          .maybeSingle();
        myRole = (mem as any)?.role ?? null;
      } else if ((event as any).created_by_profile_id === profileId) {
        myRole = "owner";
      }

      const isFrozen = freezeConfig.freeze_state === "frozen" && freezeConfig.freeze_last_holes != null;

      if (isFrozen) {
        const threshold = freezeConfig.total_holes - (freezeConfig.freeze_last_holes as number);
        const rows = await getFrozenLeaderboard(eventId, threshold, freezeConfig, (event as any).scoring_model ?? "net");
        return NextResponse.json(
          {
            rows,
            freeze: freezeConfig,
            my_role: myRole,
            scoring_model: (event as any).scoring_model ?? "net",
          },
          { headers: { "Cache-Control": "no-store" } }
        );
      }

      const [liveRows, submissionMap] = await Promise.all([
        getEventLeaderboard(eventId),
        getEventSubmissionMap(eventId),
      ]);

      const scoredIds = new Set(liveRows.map((r) => r.profile_id));
      const pendingParticipants = await getEventPendingParticipants(eventId, scoredIds);

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
          event_id: eventId,
          round_id: null,
          tee_time: p.tee_time,
        })),
      ];

      return NextResponse.json(
        {
          rows,
          freeze: freezeConfig,
          my_role: myRole,
          scoring_model: (event as any).scoring_model ?? "net",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (groupId) {
      const rows = await getGroupStandings(groupId);
      return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ error: "Provide event_id or group_id" }, { status: 400 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

async function getFrozenLeaderboard(
  eventId: string,
  threshold: number,
  freezeConfig: {
    freeze_scope: string;
    freeze_top_x: number | null;
  },
  scoringModel: string
): Promise<FrozenLeaderboardEntry[]> {
  // Prefer the per-player snapshot written at freeze time. Fall back to the
  // dynamic function only when the snapshot is absent (manual freeze before
  // this migration ran, or a race where the trigger hadn't fired yet).
  const { data: snapshotRows } = await supabaseAdmin
    .from("event_player_freeze_snapshots")
    .select("*")
    .eq("event_id", eventId);

  // Always fetch live entries — needed for below-threshold players and top_x scope.
  const liveRows = await getEventLeaderboard(eventId);

  type RawRow = {
    profile_id: string;
    gross_score: number | null;
    net_score: number | null;
    to_par: number | null;
    holes_shown: number;
    actual_holes_completed: number | null;
    is_live: boolean;
  };

  let frozenRows: RawRow[];

  if (snapshotRows && snapshotRows.length > 0) {
    frozenRows = (snapshotRows as any[]).map((r) => ({
      profile_id: r.profile_id,
      gross_score: r.gross_score,
      net_score: r.net_score,
      to_par: r.to_par ?? null,
      holes_shown: r.holes_shown,
      actual_holes_completed: r.actual_holes_completed ?? null,
      is_live: r.is_live,
    }));
  } else {
    // Dynamic fallback: recompute from score events (original behaviour)
    const { data: rpcRows, error } = await supabaseAdmin.rpc(
      "ciaga_get_frozen_leaderboard",
      { p_event_id: eventId, p_threshold_hole: threshold }
    );
    if (error) throw error;
    frozenRows = ((rpcRows ?? []) as any[]).map((r) => ({
      profile_id: r.profile_id,
      gross_score: r.gross_score,
      net_score: r.net_score,
      to_par: r.to_par ?? null,
      holes_shown: r.holes_shown,
      actual_holes_completed: r.actual_holes_completed ?? null,
      is_live: r.is_live,
    }));
  }

  // Players in the snapshot are frozen. Players not yet in the snapshot are
  // still below the threshold and should show live, updating scores.
  const frozenProfileIds = new Set(frozenRows.map((r) => r.profile_id));
  const liveOnlyRows: RawRow[] = liveRows
    .filter((r) => !frozenProfileIds.has(r.profile_id))
    .map((r) => ({
      profile_id: r.profile_id,
      gross_score: r.gross_score ?? null,
      net_score: r.net_score ?? null,
      to_par: (r as any).to_par ?? null,
      holes_shown: r.holes_completed ?? 0,
      actual_holes_completed: r.holes_completed ?? null,
      is_live: r.is_live ?? false,
    }));

  const combined: RawRow[] = [...frozenRows, ...liveOnlyRows];

  // Fetch profiles for everyone in the combined set
  const profileIds = combined.map((r) => r.profile_id);
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, name, avatar_url")
    .in("id", profileIds);
  const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));

  // Sort by displayed score and assign positions
  const higherBetter = scoringModel === "stableford_points";
  combined.sort((a, b) => {
    const aScore = a.net_score ?? a.gross_score;
    const bScore = b.net_score ?? b.gross_score;
    if (aScore == null && bScore == null) return 0;
    if (aScore == null) return 1;
    if (bScore == null) return -1;
    // Secondary: more holes completed ranks higher
    const scoreDiff = higherBetter ? bScore - aScore : aScore - bScore;
    if (scoreDiff !== 0) return scoreDiff;
    return (b.holes_shown ?? 0) - (a.holes_shown ?? 0);
  });

  const result: FrozenLeaderboardEntry[] = combined.map((r, i) => ({
    profile_id: r.profile_id,
    gross_score: r.gross_score,
    net_score: r.net_score,
    to_par: r.to_par ?? null,
    holes_shown: r.holes_shown,
    actual_holes_completed: r.actual_holes_completed ?? undefined,
    is_live: r.is_live,
    position: i + 1,
    profile: profileMap[r.profile_id] ?? undefined,
  }));

  // For top_x freeze scope: players outside top-x always show live scores
  if (freezeConfig.freeze_scope === "top_x" && freezeConfig.freeze_top_x != null) {
    const topX = freezeConfig.freeze_top_x;
    const liveByProfile = Object.fromEntries(liveRows.map((r) => [r.profile_id, r]));
    return result.map((row) => {
      if (row.position > topX) {
        const live = liveByProfile[row.profile_id];
        if (live) {
          return {
            ...row,
            gross_score: live.gross_score ?? null,
            net_score: live.net_score ?? null,
            holes_shown: live.holes_completed ?? 0,
            actual_holes_completed: live.holes_completed ?? undefined,
            is_live: live.is_live ?? false,
          };
        }
      }
      return row;
    });
  }

  return result;
}
