import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { emitCompetitionRoundFeedItems } from "@/lib/feed/generators/competitionRound";

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
  const [eventResult, roundsResult, teeTimesResult] = await Promise.all([
    supabaseAdmin
      .from("events")
      .select("majors_status, event_date")
      .eq("id", eventId)
      .maybeSingle(),
    supabaseAdmin
      .from("event_rounds")
      .select("status")
      .eq("event_id", eventId),
    supabaseAdmin
      .from("event_tee_times")
      .select("id, round_id, rounds(id, status)")
      .eq("event_id", eventId),
  ]);

  const evt = eventResult.data as { majors_status: EventStatus; event_date: string | null } | null;
  if (!evt) return;

  const rounds = (roundsResult.data ?? []) as { status: string }[];

  // Derive tee-time-linked round statuses (actual rounds players are playing)
  const teeTimeRows = (teeTimesResult.data ?? []) as unknown as Array<{
    id: string;
    round_id: string | null;
    rounds: { id: string; status: string } | null;
  }>;

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
  // All active linked rounds finished (cancelled ones disregarded)
  const allActiveLinkedRoundsFinished =
    activeLinkedRounds.length > 0 &&
    activeLinkedRounds.every((r) => r.status === "finished");

  // If all active tee-time rounds are done, propagate to event_rounds so later
  // calls see event_rounds.status = 'completed' consistently
  if (allActiveLinkedRoundsFinished) {
    await supabaseAdmin
      .from("event_rounds")
      .update({ status: "completed" })
      .eq("event_id", eventId)
      .not("status", "in", '("completed","cancelled")');
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

    const allRoundsCompleted =
      (activeEventRounds.length > 0 && activeEventRounds.every((r) => r.status === "completed")) ||
      allActiveLinkedRoundsFinished;

    const anyRoundLive =
      activeEventRounds.some((r) => r.status === "live") || anyLinkedRoundLive;

    if (activeTeeTimeCount > 0 && allRoundsCompleted) {
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
  }
}
