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
  // Stroke aggregates
  total_gross: number | null;
  total_net: number | null;
  avg_gross_to_par: number | null;
  avg_net_to_par: number | null;
  won_events: { event_id: string; event_name: string; event_date: string | null }[];
};

// Refreshes event leaderboard entries for any live events in the season,
// then recomputes season standings so the result always includes current in-progress scores.
async function refreshSeasonStandings(seasonId: string) {
  const { data: liveEvents } = await supabaseAdmin
    .from("events")
    .select("id")
    .eq("season_id", seasonId)
    .eq("majors_status", "live")
    .in("standings_contribution", ["season", "both"]);

  await Promise.all(
    (liveEvents ?? []).map((evt: any) =>
      supabaseAdmin.rpc("ciaga_compute_event_leaderboard", { p_event_id: evt.id })
    )
  );

  await supabaseAdmin.rpc("ciaga_compute_season_standings", { p_season_id: seasonId });
}

// GET /api/majors/seasons/[id]/standings — refresh then return season standings with stroke aggregates
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    await refreshSeasonStandings(id);

    const { data: standings, error } = await supabaseAdmin
      .from("season_standings_entries")
      .select(`
        season_id, profile_id, position, season_points,
        events_played, wins, top_3s, best_finish, last_computed_at,
        profile:profiles(id, name, avatar_url)
      `)
      .eq("season_id", id)
      .order("position", { ascending: true });

    if (error) throw error;

    // Fetch stroke aggregates from event_leaderboard_entries for this season
    const { data: seasonEvents } = await supabaseAdmin
      .from("events")
      .select("id, name, event_date")
      .eq("season_id", id)
      .in("majors_status", ["completed", "official"]);

    const eventIds = (seasonEvents ?? []).map((e: any) => e.id as string);
    const eventMap = new Map((seasonEvents ?? []).map((e: any) => [e.id as string, e]));

    type StrokeAgg = {
      total_gross: number;
      total_net: number;
      gross_to_par_sum: number;
      net_to_par_sum: number;
      stroke_events: number;
      won_events: { event_id: string; event_name: string; event_date: string | null }[];
    };

    const strokeMap = new Map<string, StrokeAgg>();

    if (eventIds.length > 0) {
      const { data: leaderEntries } = await supabaseAdmin
        .from("event_leaderboard_entries")
        .select("profile_id, event_id, position, net_score, gross_score, to_par, course_par")
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
          won_events: [],
        };
        if (e.net_score != null) {
          agg.total_net += e.net_score;
          agg.net_to_par_sum += e.to_par ?? 0;
          agg.stroke_events += 1;
        }
        if (e.gross_score != null) {
          agg.total_gross += e.gross_score;
          if (e.course_par != null) agg.gross_to_par_sum += e.gross_score - e.course_par;
        }
        if (e.position === 1) {
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

    const enriched: SeasonStandingEntry[] = (standings ?? []).map((s: any) => {
      const agg = strokeMap.get(s.profile_id);
      return {
        ...s,
        total_gross: agg && agg.stroke_events > 0 ? agg.total_gross : null,
        total_net: agg && agg.stroke_events > 0 ? agg.total_net : null,
        avg_gross_to_par:
          agg && agg.stroke_events > 0
            ? Math.round((agg.gross_to_par_sum / agg.stroke_events) * 10) / 10
            : null,
        avg_net_to_par:
          agg && agg.stroke_events > 0
            ? Math.round((agg.net_to_par_sum / agg.stroke_events) * 10) / 10
            : null,
        won_events: agg?.won_events ?? [],
      };
    });

    return NextResponse.json(
      { standings: enriched },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/seasons/[id]/standings — recompute standings for this season
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data: season } = await supabaseAdmin
      .from("competition_seasons")
      .select("competition:competitions(group_id)")
      .eq("id", id)
      .maybeSingle();

    if (!season) return NextResponse.json({ error: "Season not found" }, { status: 404 });

    const groupId = (season as any).competition?.group_id;
    if (groupId) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", groupId)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can recompute standings" }, { status: 403 });
      }
    }

    await refreshSeasonStandings(id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
