import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/competitions?group_id=... — list competitions for a group
export async function GET(req: Request) {
  try {
    await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);
    const groupId = url.searchParams.get("group_id");

    if (!groupId) {
      return NextResponse.json({ error: "group_id is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("competitions")
      .select("*, event_templates:competition_event_templates(id)")
      .eq("group_id", groupId)
      .order("name", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ competitions: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/competitions — create a competition
export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = await req.json();

    const {
      group_id,
      name,
      description,
      recur_annually,
      typical_month,
      template_event_type,
      template_event_category,
      template_scoring_model,
      template_points_model,
      template_rules_text,
      template_settings,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Competition name is required" }, { status: 400 });
    }

    // Caller must be owner or admin of the group
    if (group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json(
          { error: "Only group owner or admin can create a competition" },
          { status: 403 }
        );
      }
    }

    const { data: competition, error } = await supabaseAdmin
      .from("competitions")
      .insert({
        group_id: group_id ?? null,
        name: name.trim(),
        description: description ?? null,
        recur_annually: recur_annually ?? true,
        typical_month: typical_month ?? null,
        template_event_type: template_event_type ?? "stroke",
        template_event_category: template_event_category ?? "round_based",
        template_scoring_model: template_scoring_model ?? "net",
        template_points_model: template_points_model ?? "none",
        template_rules_text: template_rules_text ?? null,
        template_settings: template_settings ?? {},
        created_by_profile_id: profileId,
      })
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ competition }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
