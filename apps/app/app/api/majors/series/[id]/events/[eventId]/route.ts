import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

async function requireAdminOfEventTemplate(profileId: string, eventId: string) {
  const { data: tmpl } = await supabaseAdmin
    .from("series_event_templates")
    .select("series_id, series:competition_series(group_id)")
    .eq("id", eventId)
    .maybeSingle();

  if (!tmpl) return null;
  const groupId = (tmpl as any).series?.group_id;
  if (!groupId) return tmpl;

  const { data: membership } = await supabaseAdmin
    .from("major_group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();

  if (!membership || !["owner", "admin"].includes((membership as any).role)) return null;
  return tmpl;
}

// PATCH /api/majors/series/[id]/events/[eventId] — update event template
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { eventId } = await params;

    const tmpl = await requireAdminOfEventTemplate(profileId, eventId);
    if (!tmpl) return NextResponse.json({ error: "Not found or insufficient permissions" }, { status: 403 });

    const body = await req.json();
    const allowed = [
      "name", "description", "sort_order", "typical_month",
      "template_competition_type", "template_scoring_model",
      "template_points_model", "template_rules_text", "template_settings",
    ];
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    const { data: updated, error } = await supabaseAdmin
      .from("series_event_templates")
      .update(updates)
      .eq("id", eventId)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ event_template: updated });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/majors/series/[id]/events/[eventId] — remove event template
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { eventId } = await params;

    const tmpl = await requireAdminOfEventTemplate(profileId, eventId);
    if (!tmpl) return NextResponse.json({ error: "Not found or insufficient permissions" }, { status: 403 });

    const { error } = await supabaseAdmin
      .from("series_event_templates")
      .delete()
      .eq("id", eventId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
