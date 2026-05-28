import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id] — get competition detail
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data, error } = await supabaseAdmin
      .from("competitions")
      .select("*, event_templates:competition_event_templates(*), events(id, name, event_year, majors_status, event_date, competition_event_template_id)")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    return NextResponse.json({ competition: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// PATCH /api/majors/competitions/[id] — update competition metadata / template
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;
    const body = await req.json();

    // Fetch competition to get group_id for auth check
    const { data: existing } = await supabaseAdmin
      .from("competitions")
      .select("group_id")
      .eq("id", id)
      .maybeSingle();

    if (!existing) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

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
        return NextResponse.json({ error: "Only group owner or admin can update a competition" }, { status: 403 });
      }
    }

    const allowed = [
      "name", "description", "recur_annually", "typical_month",
      "template_event_type", "template_event_category",
      "template_scoring_model", "template_points_model",
      "template_rules_text", "template_settings",
    ];
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    const { data: competition, error } = await supabaseAdmin
      .from("competitions")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ competition });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
