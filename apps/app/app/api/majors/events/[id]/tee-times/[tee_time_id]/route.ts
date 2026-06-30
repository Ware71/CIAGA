import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";
import { notifyRoundSchedule } from "@/lib/notifications/roundSchedule";

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

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    // Must be group owner or admin
    if (!event.group_id) {
      return NextResponse.json({ error: "Event is not linked to a group" }, { status: 400 });
    }
    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", event.group_id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();
    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only group owner or admin can edit tee times" }, { status: 403 });
    }

    // No round embed — event_tee_times ↔ rounds has FKs in both directions, which
    // makes a PostgREST embed ambiguous (PGRST201) and the whole select fail.
    const { data: teeTime } = await supabaseAdmin
      .from("event_tee_times")
      .select("*")
      .eq("id", tee_time_id)
      .eq("event_id", id)
      .maybeSingle();
    if (!teeTime) return NextResponse.json({ error: "Tee time not found" }, { status: 404 });

    // Prevent editing a tee time whose round is already live or finished
    let roundStatus: string | null = null;
    if ((teeTime as any).round_id) {
      const { data: linkedRound } = await supabaseAdmin
        .from("rounds")
        .select("status")
        .eq("id", (teeTime as any).round_id)
        .maybeSingle();
      roundStatus = (linkedRound as any)?.status ?? null;
    }
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

    // Update event_tee_times fields
    const ttUpdates: Record<string, unknown> = {};
    if (tee_time !== undefined) ttUpdates.tee_time = tee_time;
    if (group_number !== undefined) ttUpdates.group_number = group_number;
    if (notes !== undefined) ttUpdates.notes = notes;

    if (Object.keys(ttUpdates).length > 0) {
      const { error: ttErr } = await supabaseAdmin
        .from("event_tee_times")
        .update(ttUpdates)
        .eq("id", tee_time_id);
      if (ttErr) throw ttErr;
    }

    // Sync scheduled_at on the linked round when tee_time changes
    const roundId = (teeTime as any).round_id as string | null;
    const teeTimeChanged = tee_time !== undefined && tee_time !== (teeTime as any).tee_time;
    if (tee_time !== undefined && roundId) {
      const { error: rErr } = await supabaseAdmin
        .from("rounds")
        .update({ scheduled_at: tee_time })
        .eq("id", roundId);
      if (rErr) throw rErr;
    }

    // Notification bookkeeping — fired after all mutations succeed.
    let playersReconciled = false;
    let priorRecipientIds: string[] = [];
    let addedProfileIds: string[] = [];

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

      // Players already in the tee time before this reconciliation (for the
      // "time changed" notification — newly added players get "scheduled" instead).
      playersReconciled = true;
      priorRecipientIds = existing
        .filter(
          (p) =>
            (p as any).role !== "owner" &&
            !(p as any).is_guest &&
            (p as any).profile_id &&
            (p as any).profile_id !== profileId
        )
        .map((p) => (p as any).profile_id as string);

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
      addedProfileIds = toAdd
        .filter((p) => !p.is_guest && p.profile_id && p.profile_id !== profileId)
        .map((p) => p.profile_id as string);
      if (toAdd.length > 0) {
        // Remove any newly-added non-guest players from other tee times in this event
        const newNonGuestIds = toAdd.filter((p) => !p.is_guest && p.profile_id).map((p) => p.profile_id as string);
        if (newNonGuestIds.length > 0) {
          const { data: otherTTs } = await supabaseAdmin
            .from("event_tee_times")
            .select("round_id")
            .eq("event_id", id)
            .neq("id", tee_time_id);
          const otherRoundIds = (otherTTs ?? []).map((t) => (t as any).round_id).filter(Boolean) as string[];
          if (otherRoundIds.length > 0) {
            await supabaseAdmin
              .from("round_participants")
              .delete()
              .in("round_id", otherRoundIds)
              .in("profile_id", newNonGuestIds);
          }
        }

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

    // Notify the affected players (best-effort, after all mutations).
    if (roundId) {
      const effectiveTeeTime =
        tee_time !== undefined ? tee_time : ((teeTime as any).tee_time ?? null);

      // Newly added players → "a round was scheduled for you".
      if (addedProfileIds.length > 0) {
        await notifyRoundSchedule({
          roundId,
          actorProfileId: profileId,
          type: "round_scheduled",
          recipientProfileIds: addedProfileIds,
          scheduledAt: effectiveTeeTime,
        });
      }

      // Time moved → tell the players who were already in (excluding new adds).
      if (teeTimeChanged) {
        const changedRecipients = playersReconciled
          ? priorRecipientIds.filter((id) => !addedProfileIds.includes(id))
          : undefined; // undefined → helper derives from current participants
        await notifyRoundSchedule({
          roundId,
          actorProfileId: profileId,
          type: "round_schedule_changed",
          recipientProfileIds: changedRecipients,
          scheduledAt: effectiveTeeTime,
        });
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

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    // Fetch the tee time
    const { data: teeTime } = await supabaseAdmin
      .from("event_tee_times")
      .select("*")
      .eq("id", tee_time_id)
      .eq("event_id", id)
      .maybeSingle();

    if (!teeTime) return NextResponse.json({ error: "Tee time not found" }, { status: 404 });

    // Must be group owner/admin or the creator
    if (event.group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", event.group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      const isAdminOrOwner = membership && ["owner", "admin"].includes((membership as any).role);
      const isCreator = (teeTime as any).created_by === profileId;

      if (!isAdminOrOwner && !isCreator) {
        return NextResponse.json({ error: "Not authorized to delete this tee time" }, { status: 403 });
      }
    }

    // Capture participants BEFORE the cascade delete so we can notify them.
    const deletedRoundId = (teeTime as any).round_id as string | null;
    let cancelRecipients: string[] = [];
    if (deletedRoundId) {
      const { data: capturedParts } = await supabaseAdmin
        .from("round_participants")
        .select("profile_id, role, is_guest")
        .eq("round_id", deletedRoundId)
        .eq("is_guest", false)
        .not("profile_id", "is", null);
      cancelRecipients = (capturedParts ?? [])
        .filter((p: any) => p.role !== "owner" && p.profile_id && p.profile_id !== profileId)
        .map((p: any) => p.profile_id as string);
    }

    // Delete linked round (will cascade-remove participants)
    if (deletedRoundId) {
      const { error: roundErr } = await supabaseAdmin
        .from("rounds")
        .delete()
        .eq("id", deletedRoundId);
      if (roundErr) throw roundErr;
    }

    // Delete tee time record (round_id now null due to ON DELETE SET NULL, or already deleted)
    const { error } = await supabaseAdmin
      .from("event_tee_times")
      .delete()
      .eq("id", tee_time_id);

    if (error) throw error;

    if (deletedRoundId && cancelRecipients.length > 0) {
      await notifyRoundSchedule({
        roundId: deletedRoundId,
        actorProfileId: profileId,
        type: "round_cancelled",
        recipientProfileIds: cancelRecipients,
        courseName: null,
        scheduledAt: (teeTime as any).tee_time ?? null,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
