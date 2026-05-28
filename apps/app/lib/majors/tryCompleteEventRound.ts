import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { reconcileEventStatus } from "@/lib/majors/reconcileStatus";

/**
 * Checks whether all tee times for a given event round have their
 * linked rounds finished, and if so marks the event_round as
 * 'completed' and reconciles the parent event's status.
 *
 * Safe to call after every individual round finish — it's a no-op unless
 * the finishing round was the last one in the event round.
 *
 * Rules:
 * - Tee time slots with no linked round (round_id IS NULL) are ignored —
 *   they don't block completion (player no-shows).
 * - At least one tee time must have a linked round before auto-completing.
 * - Already-completed / cancelled event rounds are left alone (idempotent).
 */
export async function tryCompleteEventRound(
  eventRoundId: string,
  eventId: string
): Promise<void> {
  // Fetch all tee times for this event round
  const { data: teeTimes } = await supabaseAdmin
    .from("event_tee_times")
    .select("round_id")
    .eq("event_round_id", eventRoundId);

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

  // Guard: skip if event round is already in a terminal state
  const { data: er } = await supabaseAdmin
    .from("event_rounds")
    .select("status")
    .eq("id", eventRoundId)
    .maybeSingle();

  if (!er) return;

  if (er.status !== "completed" && er.status !== "cancelled") {
    await supabaseAdmin
      .from("event_rounds")
      .update({ status: "completed" })
      .eq("id", eventRoundId);
  }

  // Always reconcile the parent event status — even if the event
  // round was already marked complete (handles re-runs / restarts).
  await reconcileEventStatus(eventId);
}
