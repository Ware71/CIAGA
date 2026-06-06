import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
  const teeTimeRows = (teeTimesResult.data ?? []) as Array<{
    id: string;
    round_id: string | null;
    rounds: { id: string; status: string } | null;
  }>;
  const teeTimeCount = teeTimeRows.length;
  const linkedRounds = teeTimeRows
    .map((tt) => tt.rounds)
    .filter(Boolean) as { id: string; status: string }[];

  // 'live' or 'starting' means players have begun their round
  const anyLinkedRoundLive = linkedRounds.some(
    (r) => r.status === "live" || r.status === "starting"
  );
  // 'finished' is the terminal status for a completed round
  const allLinkedRoundsFinished =
    linkedRounds.length > 0 &&
    linkedRounds.every((r) => r.status === "finished" || r.status === "cancelled");

  // If all tee-time rounds are done, propagate to event_rounds so later
  // calls see event_rounds.status = 'completed' consistently
  if (allLinkedRoundsFinished && linkedRounds.some((r) => r.status === "finished")) {
    await supabaseAdmin
      .from("event_rounds")
      .update({ status: "completed" })
      .eq("event_id", eventId)
      .not("status", "in", '("completed","cancelled")');
  }

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
      (rounds.length > 0 && rounds.every((r) => r.status === "completed")) ||
      allLinkedRoundsFinished;

    const anyRoundLive =
      rounds.some((r) => r.status === "live") || anyLinkedRoundLive;

    if (daysDiff >= 1 && teeTimeCount > 0 && allRoundsCompleted) {
      target = "completed";
    } else if (daysDiff >= 0 || anyRoundLive) {
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
  }
}
