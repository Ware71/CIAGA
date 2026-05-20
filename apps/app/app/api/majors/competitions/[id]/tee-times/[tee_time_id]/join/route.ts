import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// POST /api/majors/competitions/[id]/tee-times/[tee_time_id]/join
// Allows an entered player to claim an available slot when tee_time_mode = 'self_select'.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; tee_time_id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id, tee_time_id } = await params;

    const competition = await getCompetitionById(id);
    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    if ((competition as any).tee_time_mode !== "self_select") {
      return NextResponse.json(
        { error: "Tee times for this competition are assigned by the organiser." },
        { status: 403 }
      );
    }

    // Confirm the player is entered
    const { data: entry } = await supabaseAdmin
      .from("competition_entries")
      .select("id")
      .eq("competition_id", id)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (!entry) {
      return NextResponse.json({ error: "You must be entered in this competition to join a tee time." }, { status: 403 });
    }

    // Fetch the tee time (including competition_round_id for default tee lookup)
    const { data: teeTime } = await supabaseAdmin
      .from("competition_tee_times")
      .select("id, round_id, competition_id, competition_round_id")
      .eq("id", tee_time_id)
      .eq("competition_id", id)
      .maybeSingle();

    if (!teeTime) return NextResponse.json({ error: "Tee time not found." }, { status: 404 });
    if (!teeTime.round_id) return NextResponse.json({ error: "Tee time has no linked round." }, { status: 400 });

    // Ensure player is not already in another tee time for this competition
    const { data: allTeeTimes } = await supabaseAdmin
      .from("competition_tee_times")
      .select("round_id")
      .eq("competition_id", id);

    const allRoundIds = (allTeeTimes ?? []).map((t: any) => t.round_id).filter(Boolean) as string[];

    if (allRoundIds.length > 0) {
      const { data: existing } = await supabaseAdmin
        .from("round_participants")
        .select("round_id")
        .eq("profile_id", profileId)
        .in("round_id", allRoundIds)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ error: "You are already in a tee time for this competition." }, { status: 409 });
      }
    }

    // Check the slot isn't full (max 4 players)
    const { count } = await supabaseAdmin
      .from("round_participants")
      .select("id", { count: "exact", head: true })
      .eq("round_id", teeTime.round_id);

    if ((count ?? 0) >= 4) {
      return NextResponse.json({ error: "This tee time is full." }, { status: 409 });
    }

    // Resolve gender-appropriate default tee box from the competition round
    let defaultTeeBoxId: string | null = null;
    if ((teeTime as any).competition_round_id) {
      const { data: compRound } = await supabaseAdmin
        .from("competition_rounds")
        .select("default_tee_box_id_male, default_tee_box_id_female")
        .eq("id", (teeTime as any).competition_round_id)
        .maybeSingle();
      if (compRound) {
        const { data: playerProfile } = await supabaseAdmin
          .from("profiles")
          .select("gender")
          .eq("id", profileId)
          .maybeSingle();
        const isFemale = (playerProfile as any)?.gender === "female";
        defaultTeeBoxId = isFemale
          ? ((compRound as any).default_tee_box_id_female ?? null)
          : ((compRound as any).default_tee_box_id_male ?? null);
      }
    }

    // Add player to round_participants
    const { error: insertErr } = await supabaseAdmin
      .from("round_participants")
      .insert({
        round_id: teeTime.round_id,
        profile_id: profileId,
        role: "player",
        is_guest: false,
        pending_tee_box_id: defaultTeeBoxId,
      });

    if (insertErr) throw insertErr;

    // If the round is already live, assign the tee snapshot now.
    // The start API sets tee_snapshot_id only for participants present at start time.
    const { data: roundStatus } = await supabaseAdmin
      .from("rounds")
      .select("status, pending_tee_box_id")
      .eq("id", teeTime.round_id)
      .maybeSingle();

    if (roundStatus?.status === "live") {
      const teeBoxId = defaultTeeBoxId ?? (roundStatus as any).pending_tee_box_id as string | null;
      if (teeBoxId) {
        const { data: courseSnap } = await supabaseAdmin
          .from("round_course_snapshots")
          .select("id")
          .eq("round_id", teeTime.round_id)
          .maybeSingle();

        if (courseSnap) {
          const { data: rts } = await supabaseAdmin
            .from("round_tee_snapshots")
            .select("id")
            .eq("round_course_snapshot_id", courseSnap.id)
            .eq("source_tee_box_id", teeBoxId)
            .maybeSingle();

          if (rts) {
            await supabaseAdmin
              .from("round_participants")
              .update({ tee_snapshot_id: rts.id })
              .eq("round_id", teeTime.round_id)
              .eq("profile_id", profileId);
          }
        }
      }
    }

    // Send notification confirming the slot
    await supabaseAdmin.from("user_notifications").insert({
      profile_id: profileId,
      type: "tee_time_assigned",
      payload: {
        competition_id: id,
        competition_name: competition.name,
        tee_time_id,
        round_id: teeTime.round_id,
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
