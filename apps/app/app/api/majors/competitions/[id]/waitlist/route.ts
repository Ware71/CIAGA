import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]/waitlist
// Returns the waitlist. All members can see position; admin/owner sees full list.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const competition = await getCompetitionById(id);
    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    let isAdmin = false;
    if (competition.group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", competition.group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();
      isAdmin = !!(membership && ["owner", "admin"].includes((membership as any).role));
    }

    const query = supabaseAdmin
      .from("competition_waitlist")
      .select(`
        id, competition_id, profile_id, status, offered_at, joined_at, created_at,
        profile:profiles!profile_id(id, name, avatar_url)
      `)
      .eq("competition_id", id)
      .order("created_at", { ascending: true });

    const { data, error } = isAdmin
      ? await query
      : await query.eq("profile_id", profileId);

    if (error) throw error;
    return NextResponse.json({ waitlist: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/competitions/[id]/waitlist
// Join the competition waitlist.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const competition = await getCompetitionById(id);
    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    if (!(competition as any).waitlist_enabled) {
      return NextResponse.json({ error: "This competition does not have a waitlist." }, { status: 400 });
    }

    // Confirm not already entered
    const { data: existing } = await supabaseAdmin
      .from("competition_entries")
      .select("id")
      .eq("competition_id", id)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "You are already entered in this competition." }, { status: 409 });
    }

    // Confirm not already on waitlist
    const { data: onWaitlist } = await supabaseAdmin
      .from("competition_waitlist")
      .select("id, status")
      .eq("competition_id", id)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (onWaitlist) {
      return NextResponse.json(
        { error: "You are already on the waitlist.", status: (onWaitlist as any).status },
        { status: 409 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("competition_waitlist")
      .insert({ competition_id: id, profile_id: profileId, status: "waiting" })
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/majors/competitions/[id]/waitlist
// Leave the competition waitlist.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { error } = await supabaseAdmin
      .from("competition_waitlist")
      .delete()
      .eq("competition_id", id)
      .eq("profile_id", profileId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
