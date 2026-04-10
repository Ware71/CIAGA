import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]/rounds — list competition rounds
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data, error } = await supabaseAdmin
      .from("competition_rounds")
      .select("*")
      .eq("competition_id", id)
      .order("round_number", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ rounds: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/competitions/[id]/rounds — create a competition round
// Body: { round_number: number, name?: string, scheduled_date?: string, course_id?: string }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;
    const body = await req.json();

    if (!body.round_number || typeof body.round_number !== "number") {
      return NextResponse.json({ error: "round_number is required" }, { status: 400 });
    }

    // Auth: must be owner/admin
    const { data: comp } = await supabaseAdmin
      .from("competitions")
      .select("group_id")
      .eq("id", id)
      .maybeSingle();

    if (!comp) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    const groupId = (comp as any).group_id;
    if (groupId) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", groupId)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can manage rounds" }, { status: 403 });
      }
    }

    const { data: round, error } = await supabaseAdmin
      .from("competition_rounds")
      .insert({
        competition_id: id,
        round_number: body.round_number,
        name: body.name ?? `Round ${body.round_number}`,
        scheduled_date: body.scheduled_date ?? null,
        course_id: body.course_id ?? null,
        status: "scheduled",
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ round }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "A round with that number already exists" }, { status: 409 });
    }
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
