import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// DELETE /api/majors/events/[id]/charges/[chargeId]
// Only allowed when no player assignments exist for this charge.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; chargeId: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id, chargeId } = await params;

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

    if (event.group_id) {
      const { data: m } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", event.group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();
      if (!m || !["owner", "admin"].includes((m as any).role)) {
        return NextResponse.json({ error: "Not authorised." }, { status: 403 });
      }
    }

    // Block deletion if player charges are assigned to this charge
    const { count } = await supabaseAdmin
      .from("event_player_charges")
      .select("id", { count: "exact", head: true })
      .eq("charge_id", chargeId);

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Cannot delete a charge that has been assigned to players. Remove assignments first." },
        { status: 409 }
      );
    }

    const { error } = await supabaseAdmin.from("event_charges").delete().eq("id", chargeId).eq("event_id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
