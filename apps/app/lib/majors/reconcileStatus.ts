import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { emitCompetitionRoundFeedItems } from "@/lib/feed/generators/competitionRound";
import {
  computeRoundCompletion,
  isEventComplete,
  newlyCompletedRoundIds,
} from "@/lib/majors/eventRoundCompletion";

export type EventStatus =
  | "upcoming"
  | "live"
  | "completed"
  | "cancelled"
  | "draft"
  | "published"
  | "entry_open"
  | "entry_closed"
  | "unofficial"
  | "official"
  | "archived";

const NON_AUTO_STATUSES: EventStatus[] = ["cancelled", "archived"];

/**
 * Computes and persists the correct majors_status for an event based on:
 * - event_date vs today
 * - event_rounds statuses (scheduled / live / completed)
 * - actual round statuses from tee-time-linked rounds (live / finished)
 *
 * Called server-side from GET and round PATCH routes so any user activity
 * triggers a transparent status sync — no client-side logic needed.
 */
export async function reconcileEventStatus(
  eventId: string
): Promise<void> {
  // event_tee_times ↔ rounds has FKs in both directions (event_tee_times.round_id
  // and rounds.event_tee_time_id), so a PostgREST embed between them is ambiguous
  // (PGRST201) and silently returns no data — which used to zero the tee-time
  // count and force completed events back to 'live'. Fetch rounds separately.
  const [eventResult, roundsResult, teeTimesResult] = await Promise.all([
    supabaseAdmin
      .from("events")
      .select("majors_status, event_date, leaderboard_freeze_state, num_rounds")
      .eq("id", eventId)
      .maybeSingle(),
    supabaseAdmin
      .from("event_rounds")
      .select("id, status")
      .eq("event_id", eventId),
    supabaseAdmin
      .from("event_tee_times")
      .select("id, round_id, event_round_id")
      .eq("event_id", eventId),
  ]);

  // Never derive a status from incomplete data.
  const queryError = eventResult.error ?? roundsResult.error ?? teeTimesResult.error;
  if (queryError) {
    console.error("[reconcileEventStatus] query failed:", queryError.message);
    return;
  }

  const evt = eventResult.data as {
    majors_status: EventStatus;
    event_date: string | null;
    leaderboard_freeze_state: string | null;
    num_rounds: number | null;
  } | null;
  if (!evt) return;

  // A frozen leaderboard means the ceremony hasn't happened yet. Completing the
  // event here would settle the fantasy book (reconcile fires settleFantasyEvent
  // below) and publish the finished result into season standings — both of which
  // spoil the reveal for everyone watching. Hold at 'live' until the organiser
  // taps Reveal Results, which un-freezes and then calls this function again.
  const isFrozen = evt.leaderboard_freeze_state === "frozen";

  const rounds = (roundsResult.data ?? []) as { id: string; status: string }[];

  const slots = (teeTimesResult.data ?? []) as {
    id: string;
    round_id: string | null;
    event_round_id: string | null;
  }[];
  const linkedRoundIds = slots
    .map((s) => s.round_id)
    .filter((id): id is string => id != null);

  let linkedRoundList: { id: string; status: string }[] = [];
  if (linkedRoundIds.length > 0) {
    const { data: linkedRoundsData, error: linkedRoundsErr } = await supabaseAdmin
      .from("rounds")
      .select("id, status")
      .in("id", linkedRoundIds);
    if (linkedRoundsErr) {
      console.error("[reconcileEventStatus] rounds query failed:", linkedRoundsErr.message);
      return;
    }
    linkedRoundList = (linkedRoundsData ?? []) as { id: string; status: string }[];
  }
  const roundById = new Map(linkedRoundList.map((r) => [r.id, r]));

  // Derive tee-time-linked round statuses (actual rounds players are playing)
  const teeTimeRows: Array<{
    id: string;
    round_id: string | null;
    event_round_id: string | null;
    rounds: { id: string; status: string } | null;
  }> = slots.map((s) => ({
    id: s.id,
    round_id: s.round_id,
    event_round_id: s.event_round_id,
    rounds: s.round_id ? roundById.get(s.round_id) ?? null : null,
  }));

  // Disregard tee times whose linked round is cancelled
  const activeTeeTimeRows = teeTimeRows.filter(
    (tt) => !tt.rounds || tt.rounds.status !== "cancelled"
  );
  const activeTeeTimeCount = activeTeeTimeRows.length;

  const activeLinkedRounds = activeTeeTimeRows
    .map((tt) => tt.rounds)
    .filter(Boolean) as { id: string; status: string }[];

  // Disregard cancelled event_rounds
  const activeEventRounds = rounds.filter((r) => r.status !== "cancelled");

  // 'live' or 'starting' means players are currently playing
  const anyLinkedRoundLive = activeLinkedRounds.some(
    (r) => r.status === "live" || r.status === "starting"
  );
  // Any round ever started (including now-finished) — prevents reverting to upcoming
  const anyLinkedRoundEverStarted = activeLinkedRounds.some(
    (r) => r.status === "live" || r.status === "starting" || r.status === "finished"
  );
  // All active linked rounds finished (cancelled ones disregarded).
  // NOTE: this spans the WHOLE event, so on a multi-round event it goes true as
  // soon as the rounds that HAVE tee times are done. It is only safe to act on
  // for the legacy single-round path below — never as an event-completion test.
  const allActiveLinkedRoundsFinished =
    activeLinkedRounds.length > 0 &&
    activeLinkedRounds.every((r) => r.status === "finished");

  // Completion is decided per event round — see lib/majors/eventRoundCompletion.
  const eventRoundCompletion = computeRoundCompletion(
    rounds,
    teeTimeRows.map((tt) => ({
      event_round_id: tt.event_round_id,
      roundStatus: tt.rounds?.status ?? null,
    })),
  );

  // Persist completion for the rounds that actually finished, and only those.
  const newlyComplete = newlyCompletedRoundIds(eventRoundCompletion);

  if (newlyComplete.length > 0) {
    await supabaseAdmin
      .from("event_rounds")
      .update({ status: "completed" })
      .in("id", newlyComplete);

    // A round finishing may be the cut round. The function is a no-op unless
    // the event has a cut configured and that round is complete, and it is
    // idempotent, so calling it on every round completion is safe.
    const { error: cutErr } = await supabaseAdmin.rpc("ciaga_apply_event_cut", {
      p_event_id: eventId,
    });
    if (cutErr) {
      console.error("[reconcileEventStatus] cut failed:", cutErr.message);
    }
  }

  // Keep original check: if every defined event_round is cancelled, cancel the event
  const allRoundsCancelled =
    rounds.length > 0 && rounds.every((r) => r.status === "cancelled");

  if (allRoundsCancelled) {
    if (evt.majors_status !== "cancelled") {
      await supabaseAdmin
        .from("events")
        .update({ majors_status: "cancelled" })
        .eq("id", eventId);
    }
    return;
  }

  if (NON_AUTO_STATUSES.includes(evt.majors_status)) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let target: EventStatus | null = null;

  if (evt.event_date) {
    const evtDate = new Date(evt.event_date);
    evtDate.setHours(0, 0, 0, 0);

    const daysDiff = (today.getTime() - evtDate.getTime()) / (1000 * 60 * 60 * 24);

    // The event is done only when EVERY non-cancelled round is. A round with no
    // tee times (round 2 of a deferred draw) is not complete, so the event
    // correctly stays live.
    const allRoundsCompleted = isEventComplete(eventRoundCompletion);

    // Legacy events that never had event_rounds rows created. Only trust the
    // event-wide "all linked rounds finished" test when there is a single round
    // to finish; a multi-round event in this state needs its rounds initialising
    // (the event page shows an "Initialise rounds" banner for exactly this).
    const legacySingleRoundComplete =
      activeEventRounds.length === 0 &&
      (evt.num_rounds ?? 1) <= 1 &&
      allActiveLinkedRoundsFinished;

    const anyRoundLive =
      activeEventRounds.some((r) => r.status === "live") || anyLinkedRoundLive;

    if (
      activeTeeTimeCount > 0 &&
      (allRoundsCompleted || legacySingleRoundComplete) &&
      !isFrozen
    ) {
      target = "completed";
    } else if (daysDiff >= 0 || anyRoundLive || anyLinkedRoundEverStarted) {
      target = "live";
    } else {
      target = "upcoming";
    }
  }

  if (target && target !== evt.majors_status) {
    await supabaseAdmin
      .from("events")
      .update({ majors_status: target })
      .eq("id", eventId);

    if (target === "live" || target === "completed") {
      emitCompetitionRoundFeedItems({ eventId, newStatus: target }).catch(() => {});
    }

    if (target === "completed") {
      // Fantasy picks settle when the event completes. Best-effort — the daily
      // cron sweep is the safety net. Dynamic import keeps this hot path free
      // of the fantasy module graph when fantasy isn't in play.
      import("@/lib/fantasy/settlement")
        .then(({ settleFantasyEvent }) => settleFantasyEvent(eventId))
        .catch(() => {});

      // Announce the result — unless the leaderboard was frozen and then
      // revealed, in which case the reveal already announced it and this would
      // be a second buzz for the same moment. See the freeze-control route.
      if (evt.leaderboard_freeze_state !== "revealed") {
        import("@/lib/notifications/majorsActivity")
          .then(async ({ notifyEventAudience, getEventWinnerName }) =>
            notifyEventAudience({
              eventId,
              type: "event_completed",
              extraPayload: { winner_name: await getEventWinnerName(eventId) },
            })
          )
          .catch(() => {});
      }
    }
  }
}
