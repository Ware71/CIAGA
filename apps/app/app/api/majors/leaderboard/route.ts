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
import type { FrozenLeaderboardEntry, EventPlayoff } from "@/lib/majors/types";
import { computeFormulaPoints, FEDEX_POINTS } from "@/lib/events/constants";

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

      // Load any active/completed playoff for this event
      const { data: playoffData } = await supabaseAdmin
        .from("event_playoffs")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const activePlayoff = playoffData as EventPlayoff | null;

      if (isFrozen) {
        const threshold = freezeConfig.total_holes - (freezeConfig.freeze_last_holes as number);
        const scoringModel = (event as any).scoring_model ?? "net";
        const frozenRows = await getFrozenLeaderboard(eventId, threshold, freezeConfig, scoringModel, event as any);
        const frozenIds = new Set(frozenRows.map((r) => r.profile_id));
        const pendingParticipants = await getEventPendingParticipants(eventId, frozenIds);

        // Fetch rounds_submitted + playoff fields from the live entries table
        const { data: entrySubmissions } = await supabaseAdmin
          .from("event_leaderboard_entries")
          .select("profile_id, rounds_submitted, playoff_result, playoff_final_position")
          .eq("event_id", eventId);
        const entryMap = Object.fromEntries(
          (entrySubmissions ?? []).map((e: any) => [e.profile_id, e])
        );

        // When playoff is complete, derive winner/loser positions + result from the
        // playoff record (robust to leaderboard recomputes) and re-sort.
        const rankedFrozenRows = applyCompletedPlayoff(frozenRows, activePlayoff, event as any);

        // Compute tied_count from (possibly playoff-adjusted) positions
        const positionCounts = countByPosition(rankedFrozenRows.map((r) => r.position ?? null));

        const rows = [
          ...rankedFrozenRows.map((r) => ({
            ...r,
            tied_count: positionCounts[r.position ?? -1] ?? 1,
            playoff_result: (r as any).playoff_result ?? entryMap[r.profile_id]?.playoff_result ?? null,
            playoff_final_position: (r as any).playoff_final_position ?? entryMap[r.profile_id]?.playoff_final_position ?? null,
          })),
          ...pendingParticipants.map((p) => ({
            profile_id: p.profile_id,
            profile: { id: p.profile_id, name: p.name, avatar_url: p.avatar_url },
            gross_score: null,
            net_score: null,
            format_points: null,
            points_earned: null,
            holes_shown: 0,
            is_live: false,
            position: null,
            tied_count: 1,
          })),
        ];

        // Detect the tie on the FULL final standings, not the masked frozen
        // positions — otherwise a tie whose deciding holes fall inside the hidden
        // window would never surface the resolution buttons before reveal.
        const liveFull = await getEventLeaderboard(eventId);
        const { has_first_place_tie, all_rounds_complete } = detectFirstPlaceTie(
          liveFull.map((r) => ({
            net_score: r.net_score ?? null,
            rounds_submitted: (r as any).rounds_submitted ?? 0,
          })),
          (event as any).num_rounds ?? 1,
        );
        const all_entrants_complete = all_rounds_complete && pendingParticipants.length === 0;

        return NextResponse.json(
          {
            rows,
            freeze: freezeConfig,
            my_role: myRole,
            scoring_model: scoringModel,
            has_first_place_tie: !activePlayoff && has_first_place_tie,
            all_entrants_complete,
            active_playoff: activePlayoff ?? null,
          },
          { headers: { "Cache-Control": "no-store" } }
        );
      }

      const [liveRows, submissionMap] = await Promise.all([
        getEventLeaderboard(eventId),
        getEventSubmissionMap(eventId),
      ]);

      // Compute tied_count per position
      const positionCounts = countByPosition(liveRows.map((r) => r.position ?? null));

      // Detect 1st-place tie: >1 player shares the best net_score and those leaders are done.
      const { has_first_place_tie, all_rounds_complete } = detectFirstPlaceTie(
        liveRows.map((r) => ({
          net_score: r.net_score ?? null,
          rounds_submitted: (r as any).rounds_submitted ?? 0,
        })),
        (event as any).num_rounds ?? 1,
      );

      // When a playoff is complete, derive winner/loser positions, points and result
      // from the playoff record (robust to leaderboard recomputes) and re-sort.
      const resolvedRows = applyCompletedPlayoff(liveRows as any[], activePlayoff, event as any);

      // Recompute tied_count from the (possibly playoff-adjusted) positions
      const finalPositionCounts = countByPosition(resolvedRows.map((r) => (r as any).position ?? null));

      const scoredIds = new Set(resolvedRows.map((r) => r.profile_id));
      const pendingParticipants = await getEventPendingParticipants(eventId, scoredIds);
      const all_entrants_complete = all_rounds_complete && pendingParticipants.length === 0;

      const rows = [
        ...resolvedRows.map((r) => ({
          ...r,
          round_id: submissionMap[r.profile_id] ?? null,
          tee_time: null as string | null,
          tied_count: finalPositionCounts[(r as any).position ?? -1] ?? 1,
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
          tied_count: 1,
        })),
      ];

      return NextResponse.json(
        {
          rows,
          freeze: freezeConfig,
          my_role: myRole,
          scoring_model: (event as any).scoring_model ?? "net",
          has_first_place_tie: !activePlayoff && has_first_place_tie,
          all_entrants_complete,
          active_playoff: activePlayoff ?? null,
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

/** Count how many entries share each position value. */
function countByPosition(positions: (number | null)[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const p of positions) {
    if (p == null) continue;
    counts[p] = (counts[p] ?? 0) + 1;
  }
  return counts;
}

type PlayoffAdjustable = {
  profile_id: string;
  position: number | null;
  net_score?: number | null;
  points_earned?: number | null;
  playoff_result?: string | null;
  playoff_final_position?: number | null;
};

/**
 * Apply a COMPLETED playoff's outcome to the leaderboard rows, derived from the
 * `event_playoffs` record (winner + tied set + resolution type) rather than the
 * `playoff_final_position`/`playoff_result` columns on event_leaderboard_entries —
 * those are wiped every time `ciaga_compute_event_leaderboard` re-inserts entries.
 * Deriving here keeps the playoff result correct regardless of recomputes.
 */
function applyCompletedPlayoff<T extends PlayoffAdjustable>(
  rows: T[],
  activePlayoff: EventPlayoff | null,
  event: EventConfig,
): T[] {
  if (!activePlayoff || activePlayoff.status !== "completed") return rows;
  const tied = new Set(activePlayoff.tied_profile_ids ?? []);
  const winner = activePlayoff.winner_profile_id;
  const type = activePlayoff.resolution_type ?? "playoff";
  const fieldSize = Math.max(rows.filter((r) => (r.net_score ?? null) != null).length, 1);
  const adjusted = rows.map((r) => {
    if (!tied.has(r.profile_id)) return r;
    const pos = r.profile_id === winner ? 1 : 2;
    return {
      ...r,
      position: pos,
      points_earned: computePointsForPosition(pos, fieldSize, event),
      playoff_result: r.profile_id === winner ? `won_${type}` : `lost_${type}`,
      playoff_final_position: pos,
    };
  });
  return adjusted.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
}

/**
 * Returns true when multiple players share the best (lowest) net_score AND those
 * tied leaders have all completed their required rounds. Detection compares
 * net_score directly — the same lower-is-better metric the leaderboard ranks by
 * (stableford is stored as its net-stroke equivalent, gross stores gross) — rather
 * than the stored `position` integer, which RANK() can split into 1/2 for equal
 * scores. Other scored entries (e.g. live in-progress players) do not block the
 * tie — only the tied leaders must be done.
 */
function detectFirstPlaceTie(
  entries: Array<{ net_score: number | null; rounds_submitted: number }>,
  numRounds: number,
): { has_first_place_tie: boolean; all_rounds_complete: boolean } {
  const scored = entries.filter((e) => e.net_score != null);

  if (scored.length === 0) return { has_first_place_tie: false, all_rounds_complete: false };

  const allComplete = scored.every((e) => (e.rounds_submitted ?? 0) >= numRounds);

  const best = Math.min(...scored.map((e) => e.net_score as number));
  const leaders = scored.filter((e) => e.net_score === best);

  // Only the tied leaders need to have completed their rounds.
  const leadersComplete = leaders.every((e) => (e.rounds_submitted ?? 0) >= numRounds);

  return {
    has_first_place_tie: leaders.length > 1 && leadersComplete,
    all_rounds_complete: allComplete,
  };
}

type EventConfig = {
  points_model?: string | null;
  points_table?: Record<string, unknown> | null;
  points_config?: Record<string, unknown> | null;
  num_rounds?: number | null;
  standings_contribution?: string | null;
};

function computePointsForPosition(
  position: number,
  fieldSize: number,
  event: EventConfig,
): number | null {
  const model = event.points_model;
  if (!model || model === "none") return null;
  if (event.standings_contribution === "event_only") return null;
  if (model === "fedex_style") {
    return FEDEX_POINTS[position - 1] ?? 0;
  }
  if (model === "position_based" || model === "custom_table") {
    const table = event.points_table ?? {};
    const val = table[String(position)];
    return typeof val === "number" ? val : null;
  }
  if (model === "ciaga_formula" || model === "custom_formula") {
    const config = (event.points_config ?? {}) as Parameters<typeof computeFormulaPoints>[3];
    return computeFormulaPoints(position, fieldSize, event.num_rounds ?? 1, config);
  }
  return null;
}

async function getFrozenLeaderboard(
  eventId: string,
  threshold: number,
  freezeConfig: {
    freeze_scope: string;
    freeze_top_x: number | null;
  },
  scoringModel: string,
  event: EventConfig,
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
    format_points: number | null;
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
      format_points: r.format_points ?? null,
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
      format_points: r.format_points ?? null,
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
      format_points: (r as any).format_points ?? null,
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

  // Sort by net_score ASC (lower is better for all formats — stableford uses
  // net-stroke equivalent so the same direction applies).
  combined.sort((a, b) => {
    const aScore = a.net_score ?? a.gross_score;
    const bScore = b.net_score ?? b.gross_score;
    if (aScore == null && bScore == null) return 0;
    if (aScore == null) return 1;
    if (bScore == null) return -1;
    const scoreDiff = aScore - bScore;
    if (scoreDiff !== 0) return scoreDiff;
    return (b.holes_shown ?? 0) - (a.holes_shown ?? 0);
  });

  // Field size for points: use configured override if present, else count scored players.
  const configuredParticipants = (event.points_config as any)?.num_participants;
  const fieldSize: number = configuredParticipants != null
    ? Number(configuredParticipants)
    : Math.max(combined.filter((r) => r.net_score != null).length, 1);

  let rankPos = 1;
  let prevScore: number | undefined = undefined;
  let placed = 0;

  const result: FrozenLeaderboardEntry[] = combined.map((r) => {
    const score = r.net_score ?? r.gross_score;
    let position: number | null = null;
    if (score != null) {
      if (score !== prevScore) {
        rankPos = placed + 1;
        prevScore = score;
      }
      placed++;
      position = rankPos;
    }
    return {
      profile_id: r.profile_id,
      gross_score: r.gross_score,
      net_score: r.net_score,
      to_par: r.to_par ?? null,
      format_points: r.format_points ?? null,
      points_earned: position != null ? computePointsForPosition(position, fieldSize, event) : null,
      holes_shown: r.holes_shown,
      actual_holes_completed: r.actual_holes_completed ?? undefined,
      is_live: r.is_live,
      position,
      profile: profileMap[r.profile_id] ?? undefined,
    };
  });

  // For top_x freeze scope: players outside top-x always show live scores
  if (freezeConfig.freeze_scope === "top_x" && freezeConfig.freeze_top_x != null) {
    const topX = freezeConfig.freeze_top_x;
    const liveByProfile = Object.fromEntries(liveRows.map((r) => [r.profile_id, r]));
    return result.map((row) => {
      if ((row.position ?? Infinity) > topX) {
        const live = liveByProfile[row.profile_id];
        if (live) {
          return {
            ...row,
            gross_score: live.gross_score ?? null,
            net_score: live.net_score ?? null,
            to_par: (live as any).to_par ?? null,
            format_points: (live as any).format_points ?? null,
            points_earned: row.position != null ? computePointsForPosition(row.position, fieldSize, event) : null,
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
