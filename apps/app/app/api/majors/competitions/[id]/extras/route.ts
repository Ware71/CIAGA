import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]/extras
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data, error } = await supabaseAdmin
      .from("competition_extras")
      .select("*")
      .eq("competition_id", id)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ extras: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/majors/competitions/[id]/extras
// Body: { name: string, amount: number, description?: string }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const competition = await getCompetitionById(id);
    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    // Must be group owner or admin
    if (competition.group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", competition.group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can manage extras." }, { status: 403 });
      }
    }

    const body = await req.json();
    const { name, amount, description } = body as {
      name: string;
      amount: number;
      description?: string;
    };

    if (!name || amount == null) {
      return NextResponse.json({ error: "name and amount are required." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("competition_extras")
      .insert({
        competition_id: id,
        name,
        amount,
        description: description ?? null,
        created_by: profileId,
      })
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ extra: data }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
