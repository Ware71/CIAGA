import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// Refreshes competition leaderboard entries for any live competitions in the season,
// then recomputes season standings so the result always includes current in-progress scores.
async function refreshSeasonStandings(seasonId: string) {
  const { data: liveComps } = await supabaseAdmin
    .from("competitions")
    .select("id")
    .eq("season_id", seasonId)
    .eq("majors_status", "live")
    .in("standings_contribution", ["season", "both"]);

  // Refresh each live competition's leaderboard (reads live round_score_events);
  // the DB function already cascades to season standings, but we call it explicitly below too.
  await Promise.all(
    (liveComps ?? []).map((comp: any) =>
      supabaseAdmin.rpc("ciaga_compute_competition_leaderboard", { p_competition_id: comp.id })
    )
  );

  // Explicit season standings recompute ensures seasons with no live competitions
  // (only completed/official) are also aggregated correctly.
  await supabaseAdmin.rpc("ciaga_compute_season_standings", { p_season_id: seasonId });
}

// GET /api/majors/seasons/[id]/standings — refresh then return season standings
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

    return NextResponse.json(
      { standings: standings ?? [] },
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

    // Auth: must be owner/admin of parent group
    const { data: season } = await supabaseAdmin
      .from("series_seasons")
      .select("series:competition_series(group_id)")
      .eq("id", id)
      .maybeSingle();

    if (!season) return NextResponse.json({ error: "Season not found" }, { status: 404 });

    const groupId = (season as any).series?.group_id;
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
