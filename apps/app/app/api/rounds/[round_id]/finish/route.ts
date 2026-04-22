import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { emitRoundPlayedFeedItem } from "@/lib/feed/generators/roundPlayed";
import { emitHoleEventFeedItems } from "@/lib/feed/generators/holeEvents";
import { emitAchievementFeedItems } from "@/lib/feed/generators/achievements";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ round_id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { round_id: roundId } = await ctx.params;

    if (!roundId) throw new Error("Missing round_id");

    // Must be owner or scorer for this round
    const { data: rp, error: rpErr } = await supabaseAdmin
      .from("round_participants")
      .select("role")
      .eq("round_id", roundId)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (rpErr) throw rpErr;

    const role = (rp as any)?.role as string | undefined;
    if (!role || (role !== "owner" && role !== "scorer")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Mark round as finished
    const { data: roundRow, error: upErr } = await supabaseAdmin
      .from("rounds")
      .update({ status: "finished" })
      .eq("id", roundId)
      .select("id, competition_tee_time_id")
      .single();

    if (upErr) throw upErr;

    // If this round belongs to a competition (created via a tee time), auto-submit
    // scores for all participants. The round is owned by the competition — there is
    // no separate manual submit step.
    if ((roundRow as any).competition_tee_time_id) {
      await autoSubmitCompetitionRound(roundId, (roundRow as any).competition_tee_time_id);
    }

    // Emit feed items (best effort)
    await emitRoundPlayedFeedItem({
      roundId,
      actorProfileId: profileId,
    });

    // Hole events + achievements in parallel (non-blocking)
    await Promise.allSettled([
      emitHoleEventFeedItems({ roundId, actorProfileId: profileId }),
      emitAchievementFeedItems({ roundId, actorProfileId: profileId }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 400 }
    );
  }
}

async function autoSubmitCompetitionRound(roundId: string, teeTimeId: string) {
  // Look up competition and competition round from the tee time
  const { data: teeTime } = await supabaseAdmin
    .from("competition_tee_times")
    .select("competition_id, competition_round_id")
    .eq("id", teeTimeId)
    .maybeSingle();

  if (!teeTime) return;

  let competitionRoundId: string | null = (teeTime as any).competition_round_id ?? null;

  // For single-round competitions the tee time may not have competition_round_id set yet;
  // fall back to the first (and only) competition round.
  if (!competitionRoundId) {
    const { data: cr } = await supabaseAdmin
      .from("competition_rounds")
      .select("id")
      .eq("competition_id", (teeTime as any).competition_id)
      .order("round_number", { ascending: true })
      .limit(1)
      .maybeSingle();
    competitionRoundId = (cr as any)?.id ?? null;
  }

  // Get all non-guest participants in the round who have profiles
  const { data: participants } = await supabaseAdmin
    .from("round_participants")
    .select("id, profile_id, course_handicap_used")
    .eq("round_id", roundId)
    .eq("is_guest", false)
    .not("profile_id", "is", null);

  if (!participants || participants.length === 0) return;

  // Get handicap results for all participants
  const participantIds = participants.map((p: any) => p.id);
  const { data: hrrRows } = await supabaseAdmin
    .from("handicap_round_results")
    .select("participant_id, adjusted_gross_score, course_handicap_used")
    .in("participant_id", participantIds);

  const hrrMap = new Map(
    (hrrRows ?? []).map((h: any) => [h.participant_id, h])
  );

  // Build submission rows — one per participant that has a score
  const submissions = (participants as any[])
    .map((p) => {
      const hrr = hrrMap.get(p.id) as any | undefined;
      const gross: number | null = hrr?.adjusted_gross_score ?? null;
      const ch: number | null = hrr?.course_handicap_used ?? p.course_handicap_used ?? null;
      const scoreUsed = gross != null ? (ch != null ? gross - ch : gross) : null;

      return {
        competition_id: (teeTime as any).competition_id,
        competition_round_id: competitionRoundId,
        round_id: roundId,
        profile_id: p.profile_id,
        score_used: scoreUsed,
        accepted: true,
        submitted_at: new Date().toISOString(),
      };
    })
    .filter((s) => s.score_used != null);

  if (submissions.length === 0) return;

  await supabaseAdmin
    .from("competition_round_submissions")
    .upsert(submissions, { onConflict: "competition_id,round_id,profile_id" });

  // Recompute leaderboard
  await supabaseAdmin.rpc("ciaga_compute_competition_leaderboard", {
    p_competition_id: (teeTime as any).competition_id,
  });
}
