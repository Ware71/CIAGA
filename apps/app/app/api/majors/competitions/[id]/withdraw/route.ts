import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// DELETE /api/majors/competitions/[id]/withdraw
// Withdraws the authenticated user from a competition, cleaning up their tee time if assigned.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const competition = await getCompetitionById(id);
    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    // Check the competition allows self-withdrawal
    if ((competition as any).allow_self_withdrawal === false) {
      return NextResponse.json(
        { error: "Self-withdrawal is not enabled for this competition. Contact the organiser to withdraw." },
        { status: 403 }
      );
    }

    // Cannot withdraw from a live or completed competition
    if (competition.majors_status === "live" || competition.majors_status === "completed") {
      return NextResponse.json(
        { error: "You cannot withdraw from a competition that is live or completed." },
        { status: 400 }
      );
    }

    // Confirm the user is actually entered
    const { data: entry } = await supabaseAdmin
      .from("competition_entries")
      .select("id")
      .eq("competition_id", id)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (!entry) {
      return NextResponse.json({ error: "You are not entered in this competition." }, { status: 404 });
    }

    // Find any tee time the player is in for this competition
    const { data: teeTimePlayers } = await supabaseAdmin
      .from("competition_tee_times")
      .select("id, round_id")
      .eq("competition_id", id);

    let roundToDelete: string | null = null;
    let teeTimeToDelete: string | null = null;

    if (teeTimePlayers && teeTimePlayers.length > 0) {
      const roundIds = teeTimePlayers.map((t: any) => t.round_id).filter(Boolean) as string[];

      if (roundIds.length > 0) {
        // Check if this player is a participant in any of these rounds
        const { data: myParticipation } = await supabaseAdmin
          .from("round_participants")
          .select("round_id, role")
          .eq("profile_id", profileId)
          .in("round_id", roundIds)
          .maybeSingle();

        if (myParticipation) {
          const teeTime = teeTimePlayers.find((t: any) => t.round_id === myParticipation.round_id);

          if (teeTime) {
            // If they're the round owner (sole creator), delete the whole round.
            // If they're just a player in someone else's group, remove only their participant row.
            if (myParticipation.role === "owner") {
              roundToDelete = myParticipation.round_id;
              teeTimeToDelete = teeTime.id;
            } else {
              // Remove only this player from the round
              await supabaseAdmin
                .from("round_participants")
                .delete()
                .eq("round_id", myParticipation.round_id)
                .eq("profile_id", profileId);
            }
          }
        }
      }
    }

    // If we need to delete an entire tee-time round, cascade carefully
    if (roundToDelete) {
      await supabaseAdmin.from("round_score_events").delete().eq("round_id", roundToDelete);
      await supabaseAdmin.from("round_current_scores").delete().eq("round_id", roundToDelete);

      const { data: courseSnaps } = await supabaseAdmin
        .from("round_course_snapshots")
        .select("id")
        .eq("round_id", roundToDelete);

      const courseSnapIds = (courseSnaps ?? []).map((r: any) => r.id).filter(Boolean) as string[];

      if (courseSnapIds.length) {
        const { data: teeSnaps } = await supabaseAdmin
          .from("round_tee_snapshots")
          .select("id")
          .in("round_course_snapshot_id", courseSnapIds);

        const teeSnapIds = (teeSnaps ?? []).map((r: any) => r.id).filter(Boolean) as string[];

        if (teeSnapIds.length) {
          await supabaseAdmin.from("round_hole_snapshots").delete().in("round_tee_snapshot_id", teeSnapIds);
          await supabaseAdmin.from("round_tee_snapshots").delete().in("round_course_snapshot_id", courseSnapIds);
        }

        await supabaseAdmin.from("round_course_snapshots").delete().eq("round_id", roundToDelete);
      }

      await supabaseAdmin.from("round_participants").delete().eq("round_id", roundToDelete);
      await supabaseAdmin.from("competition_tee_times").delete().eq("id", teeTimeToDelete!);
      await supabaseAdmin.from("rounds").delete().eq("id", roundToDelete);
    }

    // Remove the competition entry
    await supabaseAdmin
      .from("competition_entries")
      .delete()
      .eq("competition_id", id)
      .eq("profile_id", profileId);

    // Remove any entry_fee transaction so the ledger is clean (only for non-locked entries)
    if (competition.group_id) {
      await supabaseAdmin
        .from("group_balance_transactions")
        .delete()
        .eq("group_id", competition.group_id)
        .eq("profile_id", profileId)
        .eq("competition_id", id)
        .eq("type", "entry_fee");
    }

    // Promote next waitlist entrant if waitlist is enabled
    if ((competition as any).waitlist_enabled) {
      const { data: nextWaiting } = await supabaseAdmin
        .from("competition_waitlist")
        .select("id, profile_id")
        .eq("competition_id", id)
        .eq("status", "waiting")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (nextWaiting) {
        const offerExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

        await supabaseAdmin
          .from("competition_waitlist")
          .update({ status: "offered", offered_at: new Date().toISOString() })
          .eq("id", nextWaiting.id);

        // Notify the promoted player
        await supabaseAdmin.from("user_notifications").insert({
          profile_id: nextWaiting.profile_id,
          type: "waitlist_offered",
          payload: {
            competition_id: id,
            competition_name: competition.name,
            offer_expires_at: offerExpiresAt,
          },
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
