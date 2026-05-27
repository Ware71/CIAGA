import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { reconcileCompetitionStatus } from "@/lib/majors/reconcileStatus";

/**
 * Checks whether all tee times for a given competition round have their
 * linked rounds finished, and if so marks the competition_round as
 * 'completed' and reconciles the parent competition's status.
 *
 * Safe to call after every individual round finish — it's a no-op unless
 * the finishing round was the last one in the competition round.
 *
 * Rules:
 * - Tee time slots with no linked round (round_id IS NULL) are ignored —
 *   they don't block completion (player no-shows).
 * - At least one tee time must have a linked round before auto-completing.
 * - Already-completed / cancelled competition rounds are left alone (idempotent).
 */
export async function tryCompleteCompetitionRound(
  competitionRoundId: string,
  competitionId: string
): Promise<void> {
  // Fetch all tee times for this competition round
  const { data: teeTimes } = await supabaseAdmin
    .from("competition_tee_times")
    .select("round_id")
    .eq("competition_round_id", competitionRoundId);

  if (!teeTimes || teeTimes.length === 0) return;

  // Need at least one started (round linked) tee time slot
  const withRound = teeTimes.filter((tt) => tt.round_id != null);
  if (withRound.length === 0) return;

  // If any linked round is not yet finished, bail out
  const { data: unfinished } = await supabaseAdmin
    .from("rounds")
    .select("id")
    .in(
      "id",
      withRound.map((tt) => tt.round_id as string)
    )
    .neq("status", "finished")
    .limit(1);

  if (unfinished && unfinished.length > 0) return;

  // Guard: skip if competition round is already in a terminal state
  const { data: cr } = await supabaseAdmin
    .from("competition_rounds")
    .select("status")
    .eq("id", competitionRoundId)
    .maybeSingle();

  if (!cr) return;

  if (cr.status !== "completed" && cr.status !== "cancelled") {
    await supabaseAdmin
      .from("competition_rounds")
      .update({ status: "completed" })
      .eq("id", competitionRoundId);
  }

  // Always reconcile the parent competition status — even if the competition
  // round was already marked complete (handles re-runs / restarts).
  await reconcileCompetitionStatus(competitionId);
}
