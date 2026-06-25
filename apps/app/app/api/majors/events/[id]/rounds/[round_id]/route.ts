import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { reconcileEventStatus } from "@/lib/majors/reconcileStatus";

export const runtime = "nodejs";

// PATCH /api/majors/competitions/[id]/rounds/[round_id] — update an event round
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; round_id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id, round_id } = await params;

    const { data: evt } = await supabaseAdmin
      .from("events")
      .select("group_id")
      .eq("id", id)
      .maybeSingle();

    if (!evt) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const groupId = (evt as any).group_id;
    if (groupId) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", groupId)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can edit rounds" }, { status: 403 });
      }
    }

    const body = await req.json();
    const allowed: Record<string, unknown> = {};
    if (body.name !== undefined) allowed.name = body.name;
    if (body.scheduled_date !== undefined) allowed.scheduled_date = body.scheduled_date ?? null;
    if (body.course_id !== undefined) allowed.course_id = body.course_id ?? null;
    if (body.status !== undefined) allowed.status = body.status;
    if (body.default_tee_box_id_male !== undefined) allowed.default_tee_box_id_male = body.default_tee_box_id_male ?? null;
    if (body.default_tee_box_id_female !== undefined) allowed.default_tee_box_id_female = body.default_tee_box_id_female ?? null;

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data: round, error } = await supabaseAdmin
      .from("event_rounds")
      .update(allowed)
      .eq("id", round_id)
      .eq("event_id", id)
      .select("*")
      .single();

    if (error) throw error;
    if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

    reconcileEventStatus(id).catch(() => {});

    return NextResponse.json({ round });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/majors/events/[id]/rounds/[round_id]
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; round_id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id, round_id } = await params;

    const { data: evt } = await supabaseAdmin
      .from("events")
      .select("group_id")
      .eq("id", id)
      .maybeSingle();

    if (!evt) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const groupId = (evt as any).group_id;
    if (groupId) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", groupId)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can delete rounds" }, { status: 403 });
      }
    }

    // Guard: check tee times
    const { count: ttCount } = await supabaseAdmin
      .from("event_tee_times")
      .select("id", { count: "exact", head: true })
      .eq("event_round_id", round_id);
    if ((ttCount ?? 0) > 0) {
      return NextResponse.json({ error: "Remove tee times from this round before deleting it" }, { status: 409 });
    }

    // Guard: check accepted submissions
    const { count: subCount } = await supabaseAdmin
      .from("event_round_submissions")
      .select("id", { count: "exact", head: true })
      .eq("event_round_id", round_id)
      .eq("accepted", true);
    if ((subCount ?? 0) > 0) {
      return NextResponse.json({ error: "Round has accepted score submissions and cannot be deleted" }, { status: 409 });
    }

    // Guard: check round-specific charges
    const { count: chargeCount } = await supabaseAdmin
      .from("event_charges")
      .select("id", { count: "exact", head: true })
      .eq("round_id", round_id);
    if ((chargeCount ?? 0) > 0) {
      return NextResponse.json({ error: "Remove charges assigned to this round before deleting it" }, { status: 409 });
    }

    const { error } = await supabaseAdmin
      .from("event_rounds")
      .delete()
      .eq("id", round_id)
      .eq("event_id", id);

    if (error) throw error;

    // Keep events.num_rounds in sync
    const { count: remaining } = await supabaseAdmin
      .from("event_rounds")
      .select("id", { count: "exact", head: true })
      .eq("event_id", id);

    await supabaseAdmin
      .from("events")
      .update({ num_rounds: remaining ?? 0 })
      .eq("id", id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
