import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// POST /api/majors/competitions/[id]/submit-round
// Body: { round_id: string }
// Validates the round, computes score_used, inserts submission, triggers leaderboard recompute.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: eventId } = await params;
    const body = await req.json();

    const { round_id } = body;
    if (!round_id) return NextResponse.json({ error: "round_id required" }, { status: 400 });

    // Validate event
    const event = await getEventById(eventId);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    // Only owners/admins may submit rounds
    if (event.group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", event.group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();
      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can submit rounds" }, { status: 403 });
      }
    } else if ((event as any).created_by_profile_id !== profileId) {
      return NextResponse.json({ error: "Only the event creator can submit rounds" }, { status: 403 });
    }

    if (event.majors_status === "cancelled") {
      return NextResponse.json({ error: "Event is cancelled" }, { status: 400 });
    }

    if ((event as any).event_category === "aggregate") {
      return NextResponse.json(
        { error: "Aggregate events do not accept round submissions" },
        { status: 400 }
      );
    }

    // Check player has entered this event
    const { data: entry } = await supabaseAdmin
      .from("event_entries")
      .select("id")
      .eq("event_id", eventId)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (!entry) {
      return NextResponse.json({ error: "You have not entered this event" }, { status: 403 });
    }

    // Validate round
    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id, status")
      .eq("id", round_id)
      .maybeSingle();

    if (roundErr || !round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
    if ((round as any).status !== "finished") {
      return NextResponse.json({ error: "Round must be finished before submitting" }, { status: 400 });
    }

    // Validate player was a participant in this round
    const { data: participant } = await supabaseAdmin
      .from("round_participants")
      .select("id, course_handicap_used, playing_handicap_used")
      .eq("round_id", round_id)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (!participant) {
      return NextResponse.json({ error: "You are not a participant in this round" }, { status: 403 });
    }

    // Compute score_used from handicap_round_results
    const { data: hrr } = await supabaseAdmin
      .from("handicap_round_results")
      .select("adjusted_gross_score, course_handicap_used")
      .eq("participant_id", (participant as any).id)
      .maybeSingle();

    let score_used: number | null = null;
    if (hrr) {
      const hrrData = hrr as any;
      const gross = hrrData.adjusted_gross_score as number | null;
      // Use playing_handicap_used (allowance applied) for event scoring.
      // Fall back to course_handicap_used for legacy rounds where playing_handicap_used is null.
      const ch: number | null =
        (participant as any).playing_handicap_used != null
          ? (participant as any).playing_handicap_used as number
          : (hrrData.course_handicap_used as number | null);

      if (gross != null) {
        if (event.scoring_model === "gross") {
          score_used = gross;
        } else if (event.scoring_model === "net" && ch != null) {
          score_used = gross - ch;
        } else {
          score_used = gross;
        }
      }
    }

    // Upsert submission (idempotent — player can resubmit, replaces existing)
    const { data: submission, error: subErr } = await supabaseAdmin
      .from("event_round_submissions")
      .upsert({
        event_id: eventId,
        round_id,
        profile_id: profileId,
        score_used,
        accepted: true,
        rejected_reason: null,
        submitted_at: new Date().toISOString(),
      }, { onConflict: "event_id,round_id,profile_id" })
      .select("*")
      .single();

    if (subErr) throw subErr;

    // Trigger leaderboard recompute
    await supabaseAdmin.rpc("ciaga_compute_event_leaderboard", { p_event_id: eventId });

    return NextResponse.json({ ok: true, submission });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
