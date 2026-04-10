import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// POST /api/majors/series/[id]/events — add an event template to a series
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: seriesId } = await params;
    const body = await req.json();

    // Fetch series and check admin/owner
    const { data: series } = await supabaseAdmin
      .from("competition_series")
      .select("group_id")
      .eq("id", seriesId)
      .maybeSingle();

    if (!series) return NextResponse.json({ error: "Series not found" }, { status: 404 });

    const groupId = (series as any).group_id;
    if (groupId) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", groupId)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can add event templates" }, { status: 403 });
      }
    }

    const {
      name,
      description,
      sort_order,
      typical_month,
      template_competition_type,
      template_scoring_model,
      template_points_model,
      template_rules_text,
      template_settings,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Event name is required" }, { status: 400 });
    }

    // If no sort_order provided, place at the end
    let resolvedSortOrder = sort_order ?? 0;
    if (sort_order == null) {
      const { count } = await supabaseAdmin
        .from("series_event_templates")
        .select("id", { count: "exact", head: true })
        .eq("series_id", seriesId);
      resolvedSortOrder = (count ?? 0);
    }

    const { data: eventTemplate, error } = await supabaseAdmin
      .from("series_event_templates")
      .insert({
        series_id: seriesId,
        name: name.trim(),
        description: description ?? null,
        sort_order: resolvedSortOrder,
        typical_month: typical_month ?? null,
        template_competition_type: template_competition_type ?? null,
        template_scoring_model: template_scoring_model ?? null,
        template_points_model: template_points_model ?? null,
        template_rules_text: template_rules_text ?? null,
        template_settings: template_settings ?? {},
      })
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ event_template: eventTemplate }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
