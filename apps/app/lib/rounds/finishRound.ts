import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { emitRoundPlayedFeedItem } from "@/lib/feed/generators/roundPlayed";
import { emitHoleEventFeedItems } from "@/lib/feed/generators/holeEvents";
import { emitAchievementFeedItems } from "@/lib/feed/generators/achievements";

/**
 * Marks a round as finished and triggers all downstream effects:
 * - Sets rounds.status = 'finished' and finished_at = now()
 * - Auto-submits scores to competition if the round is linked to a tee time
 * - Emits feed items (round played, hole events, achievements)
 *
 * Idempotent: if the round is already finished the DB update is a no-op,
 * and feed emitters use group_key deduplication internally.
 *
 * Called by:
 *   - POST /api/rounds/[round_id]/finish  (user-initiated)
 *   - GET  /api/cron/auto-complete-rounds (system-initiated)
 */
export async function finishRound({
  roundId,
  actorProfileId,
}: {
  roundId: string;
  actorProfileId: string;
}): Promise<void> {
  // Only update if still live — safe to call twice (idempotency guard).
  // Also set finished_at which is used by feed items and achievement detection.
  const { data: roundRow, error: upErr } = await supabaseAdmin
    .from("rounds")
    .update({ status: "finished", finished_at: new Date().toISOString() })
    .eq("id", roundId)
    .eq("status", "live")
    .select("id")
    .maybeSingle();

  if (upErr) throw upErr;

  // If roundRow is null the round was already finished. Skip competition
  // auto-submit (upsert would be safe, but unnecessary). Feed items are
  // always attempted — they are idempotent.
  if (roundRow) {
    // If this round was created via a competition tee time, auto-submit all
    // participant scores. Mirrors the manual submit flow.
    const { data: cttRow } = await supabaseAdmin
      .from("competition_tee_times")
      .select("id")
      .eq("round_id", roundId)
      .maybeSingle();

    if (cttRow?.id) {
      await autoSubmitCompetitionRound(roundId, cttRow.id);
    }
  }

  // Feed items are best-effort — a failure here must not surface as an error
  // to the caller (the round is already finished).
  await emitRoundPlayedFeedItem({ roundId, actorProfileId }).catch(() => {});
  await Promise.allSettled([
    emitHoleEventFeedItems({ roundId, actorProfileId }),
    emitAchievementFeedItems({ roundId, actorProfileId }),
  ]);
}

// ---------------------------------------------------------------------------
// Internal helpers (moved verbatim from /api/rounds/[round_id]/finish/route.ts)
// ---------------------------------------------------------------------------

async function autoSubmitCompetitionRound(roundId: string, teeTimeId: string) {
  // Look up competition and competition round from the tee time
  const { data: teeTime } = await supabaseAdmin
    .from("competition_tee_times")
    .select("competition_id, competition_round_id")
    .eq("id", teeTimeId)
    .maybeSingle();

  if (!teeTime) return;

  // Fetch the competition's scoring model so we know whether to require a score
  const { data: comp } = await supabaseAdmin
    .from("competitions")
    .select("scoring_model")
    .eq("id", (teeTime as any).competition_id)
    .maybeSingle();
  const isStableford = (comp as any)?.scoring_model === "stableford_points";

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

  // Build submission rows — one per participant that has a score.
  // For stableford competitions the stab_pts CTE computes points from
  // round_score_events directly; it only needs the submission to exist
  // (accepted = true) and does not use score_used. So we create the
  // submission even when score_used is null to ensure the player appears
  // on the leaderboard after finishing.
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
    .filter((s) => isStableford || s.score_used != null);

  if (submissions.length === 0) return;

  await supabaseAdmin
    .from("competition_round_submissions")
    .upsert(submissions, { onConflict: "competition_id,round_id,profile_id" });

  // Recompute leaderboard
  await supabaseAdmin.rpc("ciaga_compute_competition_leaderboard", {
    p_competition_id: (teeTime as any).competition_id,
  });
}
