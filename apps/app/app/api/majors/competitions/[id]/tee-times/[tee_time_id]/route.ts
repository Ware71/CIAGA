import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// DELETE /api/majors/competitions/[id]/tee-times/[tee_time_id]
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; tee_time_id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id, tee_time_id } = await params;

    const competition = await getCompetitionById(id);
    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    // Fetch the tee time
    const { data: teeTime } = await supabaseAdmin
      .from("competition_tee_times")
      .select("*")
      .eq("id", tee_time_id)
      .eq("competition_id", id)
      .maybeSingle();

    if (!teeTime) return NextResponse.json({ error: "Tee time not found" }, { status: 404 });

    // Must be group owner/admin or the creator
    if (competition.group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", competition.group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      const isAdminOrOwner = membership && ["owner", "admin"].includes((membership as any).role);
      const isCreator = (teeTime as any).created_by === profileId;

      if (!isAdminOrOwner && !isCreator) {
        return NextResponse.json({ error: "Not authorized to delete this tee time" }, { status: 403 });
      }
    }

    // Delete linked round (will cascade-remove participants)
    if ((teeTime as any).round_id) {
      const { error: roundErr } = await supabaseAdmin
        .from("rounds")
        .delete()
        .eq("id", (teeTime as any).round_id);
      if (roundErr) throw roundErr;
    }

    // Delete tee time record (round_id now null due to ON DELETE SET NULL, or already deleted)
    const { error } = await supabaseAdmin
      .from("competition_tee_times")
      .delete()
      .eq("id", tee_time_id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
