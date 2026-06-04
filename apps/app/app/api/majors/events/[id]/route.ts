import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";
import { reconcileEventStatus } from "@/lib/majors/reconcileStatus";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    await reconcileEventStatus(id);

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    return NextResponse.json({ event }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// PATCH /api/majors/competitions/[id] — update event (owner/admin of parent group)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    // Check edit permission
    if (event.group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", event.group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can update this event" }, { status: 403 });
      }
    } else if (event.created_by_profile_id !== profileId) {
      return NextResponse.json({ error: "Only the creator can update this event" }, { status: 403 });
    }

    const body = await req.json();
    const allowedFields = ["name", "description", "event_type", "format", "course_id",
      "event_date", "entry_window_start", "entry_window_end", "rules_text",
      "scoring_model", "points_model", "points_table", "eligibility_rules", "handicap_rules",
      "num_rounds", "round_rules", "time_rules", "membership_rules", "standings_contribution",
      "majors_status",
      // Upgrade additions
      "allow_self_withdrawal", "tee_time_mode", "waitlist_enabled", "max_entries",
      "prize_table", "entry_fee_amount", "entry_fee_currency", "entry_fee_notes",
      // Leaderboard freeze / ceremony reveal config
      "leaderboard_freeze_last_holes", "leaderboard_freeze_scope", "leaderboard_freeze_top_x",
      "leaderboard_freeze_auto_reveal", "leaderboard_reveal_style", "leaderboard_reveal_top_x"];
    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field];
    }

    if (body.majors_status === "cancelled") {
      await supabaseAdmin
        .from("event_rounds")
        .delete()
        .eq("event_id", id)
        .eq("status", "scheduled");

      await supabaseAdmin
        .from("event_rounds")
        .update({ status: "cancelled" })
        .eq("event_id", id)
        .in("status", ["live", "completed"]);
    }

    const { data, error } = await supabaseAdmin
      .from("events")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ event: data });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/majors/competitions/[id]
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    if (event.created_by_profile_id !== profileId) {
      return NextResponse.json({ error: "Only the creator can delete this event" }, { status: 403 });
    }

    if (event.majors_status === "live") {
      return NextResponse.json({ error: "Cannot delete a live event" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("events").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
