import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/groups/[id]/seasons — list group seasons
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data: seasons, error } = await supabaseAdmin
      .from("group_seasons")
      .select("id, name, start_date, end_date, status, season_type, season_year, season_label, standings_model")
      .eq("group_id", id)
      .order("start_date", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ seasons: seasons ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/groups/[id]/seasons — create a group season
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: groupId } = await params;

    // Only owner/admin can create seasons
    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", groupId)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only group owner or admin can create seasons." }, { status: 403 });
    }

    const body = await req.json();
    const {
      name,
      season_type = "calendar_year",
      year,
      start_date,
      end_date,
      standings_model = "none",
    } = body as Record<string, unknown>;

    if (season_type === "calendar_year") {
      const yr = Number(year);
      if (!yr || isNaN(yr)) {
        return NextResponse.json({ error: "year is required for calendar_year seasons." }, { status: 400 });
      }

      const { data: existing } = await supabaseAdmin
        .from("group_seasons")
        .select("id")
        .eq("group_id", groupId)
        .eq("season_year", yr)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ error: `A ${yr} season already exists for this group.` }, { status: 409 });
      }

      const resolvedName = String(name ?? "").trim() || `${yr} Season`;
      const { data, error } = await supabaseAdmin
        .from("group_seasons")
        .insert({
          group_id: groupId,
          name: resolvedName,
          season_type: "calendar_year",
          season_year: yr,
          start_date: `${yr}-01-01`,
          end_date: `${yr}-12-31`,
          standings_model,
          status: "upcoming",
        })
        .select("*")
        .single();

      if (error) throw error;
      return NextResponse.json({ season: data }, { status: 201 });
    }

    // custom season
    if (!start_date || !end_date) {
      return NextResponse.json({ error: "start_date and end_date are required for custom seasons." }, { status: 400 });
    }
    const resolvedName = String(name ?? "").trim();
    if (!resolvedName) {
      return NextResponse.json({ error: "name is required for custom seasons." }, { status: 400 });
    }

    const { data: existingCustom } = await supabaseAdmin
      .from("group_seasons")
      .select("id")
      .eq("group_id", groupId)
      .ilike("name", resolvedName)
      .maybeSingle();
    if (existingCustom) {
      return NextResponse.json({ error: `A season named "${resolvedName}" already exists for this group.` }, { status: 409 });
    }

    const { data, error } = await supabaseAdmin
      .from("group_seasons")
      .insert({
        group_id: groupId,
        name: resolvedName,
        season_type: "custom",
        start_date: String(start_date),
        end_date: String(end_date),
        standings_model,
        status: "upcoming",
      })
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ season: data }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
