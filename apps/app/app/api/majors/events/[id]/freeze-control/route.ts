import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// POST /api/majors/competitions/[id]/freeze-control
// Body: { action: 'freeze' | 'reveal' }
// Allowed for group owner/admin. Transitions leaderboard_freeze_state.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await getEventById(id);
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Check owner/admin permission
    if (event.group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", event.group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can control the freeze" }, { status: 403 });
      }
    } else if (event.created_by_profile_id !== profileId) {
      return NextResponse.json({ error: "Only the creator can control the freeze" }, { status: 403 });
    }

    const body = await req.json();
    const { action } = body as { action: string };

    if (action !== "freeze" && action !== "reveal") {
      return NextResponse.json({ error: "action must be 'freeze' or 'reveal'" }, { status: 400 });
    }

    const currentState = (event as any).leaderboard_freeze_state ?? "live";

    // Validate state transitions
    if (action === "freeze" && currentState !== "live") {
      return NextResponse.json(
        { error: `Cannot freeze a leaderboard that is already '${currentState}'` },
        { status: 400 }
      );
    }
    if (action === "reveal" && currentState === "revealed") {
      return NextResponse.json(
        { error: "Leaderboard is already revealed" },
        { status: 400 }
      );
    }

    const newState = action === "freeze" ? "frozen" : "revealed";

    const { data, error } = await supabaseAdmin
      .from("events")
      .update({ leaderboard_freeze_state: newState })
      .eq("id", id)
      .select("id, leaderboard_freeze_state")
      .single();

    if (error) throw error;

    // Emit audit log
    await supabaseAdmin.from("event_audit_log").insert({
      event_id: id,
      actor_profile_id: profileId,
      action_type: action === "freeze" ? "leaderboard_frozen" : "leaderboard_revealed",
      payload: { previous_state: currentState, new_state: newState },
    });

    return NextResponse.json({ ok: true, freeze_state: (data as any).leaderboard_freeze_state });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
