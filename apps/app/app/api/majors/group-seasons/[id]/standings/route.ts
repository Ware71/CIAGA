import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

export type SeasonStandingEntry = {
  season_id: string;
  profile_id: string;
  position: number | null;
  season_points: number;
  events_played: number;
  wins: number;
  top_3s: number;
  best_finish: number | null;
  last_computed_at: string | null;
  profile: { id: string; name: string | null; avatar_url: string | null } | null;
  total_gross: number | null;
  total_net: number | null;
  total_gross_to_par: number | null;
  total_net_to_par: number | null;
  avg_gross_to_par: number | null;
  avg_net_to_par: number | null;
  won_events: { event_id: string; event_name: string; event_date: string | null }[];
};

async function refreshGroupSeasonStandings(groupSeasonId: string) {
  const { data: liveEvents } = await supabaseAdmin
    .from("events")
    .select("id")
    .eq("group_season_id", groupSeasonId)
    .eq("majors_status", "live")
    .in("standings_contribution", ["season", "both"]);

  await Promise.all(
    (liveEvents ?? []).map((evt: any) =>
      supabaseAdmin.rpc("ciaga_compute_event_leaderboard", { p_event_id: evt.id })
    )
  );

  await supabaseAdmin.rpc("ciaga_compute_group_season_standings", { p_group_season_id: groupSeasonId });
}

// GET /api/majors/group-seasons/[id]/standings
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    await refreshGroupSeasonStandings(id);

    const { data: standings, error } = await supabaseAdmin
      .from("group_season_standings_entries")
      .select(`
        group_season_id, profile_id, position, season_points,
        events_played, wins, top_3s, best_finish, last_computed_at,
        profile:profiles(id, name, avatar_url)
      `)
      .eq("group_season_id", id)
      .order("position", { ascending: true });

    if (error) throw error;

    // Fetch stroke aggregates from event_leaderboard_entries
    const { data: seasonEvents } = await supabaseAdmin
      .from("events")
      .select("id, name, event_date")
      .eq("group_season_id", id)
      .in("majors_status", ["completed", "official"]);

    const eventIds = (seasonEvents ?? []).map((e: any) => e.id as string);
    const eventMap = new Map((seasonEvents ?? []).map((e: any) => [e.id as string, e]));

    type StrokeAgg = {
      total_gross: number;
      total_net: number;
      gross_to_par_sum: number;
      net_to_par_sum: number;
      stroke_events: number;
      total_rounds: number;
      won_events: { event_id: string; event_name: string; event_date: string | null }[];
    };

    const strokeMap = new Map<string, StrokeAgg>();

    if (eventIds.length > 0) {
      const { data: leaderEntries } = await supabaseAdmin
        .from("event_leaderboard_entries")
        .select("profile_id, event_id, position, playoff_final_position, net_score, gross_score, to_par, course_par, rounds_submitted")
        .in("event_id", eventIds)
        .not("net_score", "is", null);

      for (const e of leaderEntries ?? []) {
        if (!e.profile_id) continue;
        const agg: StrokeAgg = strokeMap.get(e.profile_id) ?? {
          total_gross: 0,
          total_net: 0,
          gross_to_par_sum: 0,
          net_to_par_sum: 0,
          stroke_events: 0,
          total_rounds: 0,
          won_events: [],
        };
        if (e.net_score != null) {
          agg.total_net += e.net_score;
          agg.net_to_par_sum += e.to_par ?? 0;
          agg.stroke_events += 1;
          agg.total_rounds += (e as any).rounds_submitted ?? 1;
        }
        if (e.gross_score != null) {
          agg.total_gross += e.gross_score;
          if (e.course_par != null) agg.gross_to_par_sum += e.gross_score - e.course_par;
        }
        // Playoff-resolved ties keep position=1 for every tied player
        if (((e as any).playoff_final_position ?? e.position) === 1) {
          const ev = eventMap.get(e.event_id);
          agg.won_events.push({
            event_id: e.event_id,
            event_name: ev?.name ?? "Unknown",
            event_date: ev?.event_date ?? null,
          });
        }
        strokeMap.set(e.profile_id, agg);
      }
    }

    const enriched = (standings ?? []).map((s: any) => {
      const agg = strokeMap.get(s.profile_id);
      return {
        ...s,
        // Rename group_season_id → season_id for compatibility with SeasonStandingEntry shape
        season_id: s.group_season_id,
        total_gross: agg && agg.stroke_events > 0 ? agg.total_gross : null,
        total_net: agg && agg.stroke_events > 0 ? agg.total_net : null,
        total_gross_to_par: agg && agg.stroke_events > 0 ? agg.gross_to_par_sum : null,
        total_net_to_par: agg && agg.stroke_events > 0 ? agg.net_to_par_sum : null,
        avg_gross_to_par:
          agg && agg.total_rounds > 0
            ? Math.round((agg.gross_to_par_sum / agg.total_rounds) * 10) / 10
            : null,
        avg_net_to_par:
          agg && agg.total_rounds > 0
            ? Math.round((agg.net_to_par_sum / agg.total_rounds) * 10) / 10
            : null,
        won_events: agg?.won_events ?? [],
      };
    });

    return NextResponse.json({ standings: enriched }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/group-seasons/[id]/standings — recompute
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data: gs } = await supabaseAdmin
      .from("group_seasons")
      .select("id, group_id")
      .eq("id", id)
      .maybeSingle();

    if (!gs) return NextResponse.json({ error: "Season not found" }, { status: 404 });

    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", (gs as any).group_id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only group owner or admin can recompute standings" }, { status: 403 });
    }

    await refreshGroupSeasonStandings(id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
