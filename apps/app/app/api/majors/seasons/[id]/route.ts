import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/seasons/[id] — season detail with events
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data: season, error: seasonErr } = await supabaseAdmin
      .from("competition_seasons")
      .select(`
        *,
        competition:competitions(id, name, group_id, competition_type)
      `)
      .eq("id", id)
      .maybeSingle();

    if (seasonErr) throw seasonErr;
    if (!season) return NextResponse.json({ error: "Season not found" }, { status: 404 });

    // Fetch events in this season with leaderboard winners
    const { data: events, error: eventsErr } = await supabaseAdmin
      .from("events")
      .select(`
        id, name, event_date, majors_status, event_type,
        scoring_model, competition_event_template_id, course_id,
        leaderboard:event_leaderboard_entries(
          profile_id, position, net_score, gross_score, points_earned
        )
      `)
      .eq("season_id", id)
      .order("event_date", { ascending: true });

    if (eventsErr) throw eventsErr;

    return NextResponse.json(
      { season, events: events ?? [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// PATCH /api/majors/seasons/[id] — update season metadata
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;
    const body = await req.json();

    // Fetch season to get competition → group for auth
    const { data: existing } = await supabaseAdmin
      .from("competition_seasons")
      .select("competition_id, competition:competitions(group_id)")
      .eq("id", id)
      .maybeSingle();

    if (!existing) return NextResponse.json({ error: "Season not found" }, { status: 404 });

    const groupId = (existing as any).competition?.group_id;
    if (groupId) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", groupId)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can update a season" }, { status: 403 });
      }
    }

    const allowed = ["name", "status", "start_date", "end_date", "standings_model"];
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    const { data: season, error } = await supabaseAdmin
      .from("competition_seasons")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ season });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
