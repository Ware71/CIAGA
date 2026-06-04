import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/group-seasons/[id] — season metadata + all events across all competitions
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data: season, error: seasonErr } = await supabaseAdmin
      .from("group_seasons")
      .select("*, group:major_groups(id, name, type)")
      .eq("id", id)
      .maybeSingle();

    if (seasonErr) throw seasonErr;
    if (!season) return NextResponse.json({ error: "Season not found" }, { status: 404 });

    const { data: events, error: eventsErr } = await supabaseAdmin
      .from("events")
      .select("id, name, event_date, majors_status, competition_id, competition:competitions(id, name)")
      .eq("group_season_id", id)
      .order("event_date", { ascending: true, nullsFirst: false });

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

// PATCH /api/majors/group-seasons/[id] — update name, dates, standings_model, status
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
      return NextResponse.json({ error: "Only group owner or admin can update seasons." }, { status: 403 });
    }

    const body = await req.json();
    const allowed = ["name", "start_date", "end_date", "standings_model", "status", "season_label"] as const;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (key in body) patch[key] = body[key];
    }

    const { data, error } = await supabaseAdmin
      .from("group_seasons")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ season: data });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
