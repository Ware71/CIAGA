import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// POST /api/majors/competitions/[id]/submit-round
// Body: { round_id: string }
// Validates the round, computes score_used, inserts submission, triggers leaderboard recompute.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: competitionId } = await params;
    const body = await req.json();

    const { round_id } = body;
    if (!round_id) return NextResponse.json({ error: "round_id required" }, { status: 400 });

    // Validate competition
    const competition = await getCompetitionById(competitionId);
    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    if (competition.majors_status === "cancelled") {
      return NextResponse.json({ error: "Competition is cancelled" }, { status: 400 });
    }

    if ((competition as any).competition_category === "aggregate") {
      return NextResponse.json(
        { error: "Aggregate competitions do not accept round submissions" },
        { status: 400 }
      );
    }

    // Check entry window has not closed
    const now = new Date();
    if (competition.entry_window_end && new Date(competition.entry_window_end) < now) {
      return NextResponse.json({ error: "Entry window has closed" }, { status: 400 });
    }

    // Check player has entered this competition
    const { data: entry } = await supabaseAdmin
      .from("competition_entries")
      .select("id")
      .eq("competition_id", competitionId)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (!entry) {
      return NextResponse.json({ error: "You have not entered this competition" }, { status: 403 });
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
      .select("id, course_handicap_used")
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
      const ch = hrrData.course_handicap_used as number | null;

      if (gross != null) {
        if (competition.scoring_model === "gross") {
          score_used = gross;
        } else if (competition.scoring_model === "net" && ch != null) {
          score_used = gross - ch;
        } else {
          score_used = gross;
        }
      }
    }

    // Upsert submission (idempotent — player can resubmit, replaces existing)
    const { data: submission, error: subErr } = await supabaseAdmin
      .from("competition_round_submissions")
      .upsert({
        competition_id: competitionId,
        round_id,
        profile_id: profileId,
        score_used,
        accepted: true,
        rejected_reason: null,
        submitted_at: new Date().toISOString(),
      }, { onConflict: "competition_id,round_id,profile_id" })
      .select("*")
      .single();

    if (subErr) throw subErr;

    // Trigger leaderboard recompute
    await supabaseAdmin.rpc("ciaga_compute_competition_leaderboard", { p_competition_id: competitionId });

    return NextResponse.json({ ok: true, submission });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
