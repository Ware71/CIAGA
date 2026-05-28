import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// DELETE /api/majors/competitions/[id]/tee-times/[tee_time_id]/leave
// Removes the authenticated player from a self-selected tee time slot.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; tee_time_id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id, tee_time_id } = await params;

    const { data: teeTime } = await supabaseAdmin
      .from("event_tee_times")
      .select("id, round_id, event_id")
      .eq("id", tee_time_id)
      .eq("event_id", id)
      .maybeSingle();

    if (!teeTime || !teeTime.round_id) {
      return NextResponse.json({ error: "Tee time not found." }, { status: 404 });
    }

    // Find the participant row
    const { data: participant } = await supabaseAdmin
      .from("round_participants")
      .select("id, role")
      .eq("round_id", teeTime.round_id)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (!participant) {
      return NextResponse.json({ error: "You are not in this tee time." }, { status: 404 });
    }

    // Owners created the round; they should withdraw from the competition instead
    if (participant.role === "owner") {
      return NextResponse.json(
        { error: "As the tee time owner, withdraw from the competition to remove this slot entirely." },
        { status: 400 }
      );
    }

    await supabaseAdmin
      .from("round_participants")
      .delete()
      .eq("id", participant.id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
