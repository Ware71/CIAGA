import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/series/[id] — get series detail
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data, error } = await supabaseAdmin
      .from("competition_series")
      .select("*, event_templates:series_event_templates(*), competitions(id, name, competition_year, majors_status, competition_date, series_event_template_id)")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Series not found" }, { status: 404 });

    return NextResponse.json({ series: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// PATCH /api/majors/series/[id] — update series metadata / template
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;
    const body = await req.json();

    // Fetch series to get group_id for auth check
    const { data: existing } = await supabaseAdmin
      .from("competition_series")
      .select("group_id")
      .eq("id", id)
      .maybeSingle();

    if (!existing) return NextResponse.json({ error: "Series not found" }, { status: 404 });

    const groupId = (existing as any).group_id;
    if (groupId) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", groupId)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can update a series" }, { status: 403 });
      }
    }

    const allowed = [
      "name", "description", "recur_annually", "typical_month",
      "template_competition_type", "template_competition_category",
      "template_scoring_model", "template_points_model",
      "template_rules_text", "template_settings",
    ];
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    const { data: series, error } = await supabaseAdmin
      .from("competition_series")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ series });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
