import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// PATCH /api/majors/competitions/[id]/tee-times/[tee_time_id]
// Body: { tee_time?: string, group_number?: number | null, notes?: string | null, players?: Array<{profile_id?: string, is_guest?: boolean, display_name?: string}> }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; tee_time_id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id, tee_time_id } = await params;

    const competition = await getCompetitionById(id);
    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    // Must be group owner or admin
    if (!competition.group_id) {
      return NextResponse.json({ error: "Competition is not linked to a group" }, { status: 400 });
    }
    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", competition.group_id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();
    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only group owner or admin can edit tee times" }, { status: 403 });
    }

    const { data: teeTime } = await supabaseAdmin
      .from("competition_tee_times")
      .select("*, round:rounds(id, status)")
      .eq("id", tee_time_id)
      .eq("competition_id", id)
      .maybeSingle();
    if (!teeTime) return NextResponse.json({ error: "Tee time not found" }, { status: 404 });

    // Prevent editing a tee time whose round is already live or finished
    const roundStatus = (teeTime as any).round?.status;
    if (roundStatus === "live" || roundStatus === "finished") {
      return NextResponse.json({ error: "Cannot edit a tee time that is already in progress or finished" }, { status: 400 });
    }

    const body = await req.json();
    const { tee_time, group_number, notes, players } = body as {
      tee_time?: string;
      group_number?: number | null;
      notes?: string | null;
      players?: Array<{ profile_id?: string; is_guest?: boolean; display_name?: string; tee_box_id?: string | null }>;
    };

    // Update competition_tee_times fields
    const ttUpdates: Record<string, unknown> = {};
    if (tee_time !== undefined) ttUpdates.tee_time = tee_time;
    if (group_number !== undefined) ttUpdates.group_number = group_number;
    if (notes !== undefined) ttUpdates.notes = notes;

    if (Object.keys(ttUpdates).length > 0) {
      const { error: ttErr } = await supabaseAdmin
        .from("competition_tee_times")
        .update(ttUpdates)
        .eq("id", tee_time_id);
      if (ttErr) throw ttErr;
    }

    // Sync scheduled_at on the linked round when tee_time changes
    const roundId = (teeTime as any).round_id as string | null;
    if (tee_time !== undefined && roundId) {
      const { error: rErr } = await supabaseAdmin
        .from("rounds")
        .update({ scheduled_at: tee_time })
        .eq("id", roundId);
      if (rErr) throw rErr;
    }

    // Reconcile player list if provided
    if (players !== undefined && roundId) {
      const newList = players ?? [];
      if (newList.length > 4) {
        return NextResponse.json({ error: "Maximum 4 players per tee time" }, { status: 400 });
      }

      const { data: existingParticipants } = await supabaseAdmin
        .from("round_participants")
        .select("id, profile_id, role, is_guest")
        .eq("round_id", roundId);

      const existing = existingParticipants ?? [];
      const ownerRow = existing.find((p) => (p as any).role === "owner");
      const ownerProfileId = ownerRow ? (ownerRow as any).profile_id : null;

      // Profile IDs requested in the new list
      const newProfileIds = newList
        .filter((p) => p.profile_id && !p.is_guest)
        .map((p) => p.profile_id as string);

      // Remove participants no longer in the list (never remove the round owner)
      const toRemove = existing.filter((p) => {
        if ((p as any).role === "owner") return false;
        if ((p as any).is_guest) return true; // guests always re-inserted from new list
        return !newProfileIds.includes((p as any).profile_id);
      });
      if (toRemove.length > 0) {
        await supabaseAdmin
          .from("round_participants")
          .delete()
          .in("id", toRemove.map((p) => (p as any).id));
      }

      // Add participants not already present
      const existingProfileIds = existing.map((p) => (p as any).profile_id).filter(Boolean);
      const toAdd = newList.filter((p) => {
        if (p.is_guest) return true;
        return p.profile_id && !existingProfileIds.includes(p.profile_id) && p.profile_id !== ownerProfileId;
      });
      if (toAdd.length > 0) {
        await supabaseAdmin.from("round_participants").insert(
          toAdd.map((p) => ({
            round_id: roundId,
            profile_id: p.profile_id ?? null,
            is_guest: p.is_guest ?? false,
            display_name: p.display_name ?? null,
            role: "player",
            pending_tee_box_id: p.tee_box_id ?? null,
          }))
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

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
