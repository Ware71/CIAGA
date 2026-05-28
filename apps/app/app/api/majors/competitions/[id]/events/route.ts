import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// POST /api/majors/competitions/[id]/events — add an event template to a competition
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: competitionId } = await params;
    const body = await req.json();

    // Fetch competition and check admin/owner
    const { data: competition } = await supabaseAdmin
      .from("competitions")
      .select("group_id")
      .eq("id", competitionId)
      .maybeSingle();

    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    const groupId = (competition as any).group_id;
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
      template_event_type,
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
        .from("competition_event_templates")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", competitionId);
      resolvedSortOrder = (count ?? 0);
    }

    const { data: eventTemplate, error } = await supabaseAdmin
      .from("competition_event_templates")
      .insert({
        competition_id: competitionId,
        name: name.trim(),
        description: description ?? null,
        sort_order: resolvedSortOrder,
        typical_month: typical_month ?? null,
        template_event_type: template_event_type ?? null,
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
