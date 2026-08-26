/**
 * When is an event round finished, and when is the whole event finished?
 *
 * Pure so it can be tested — `reconcileEventStatus` fetches the rows and calls
 * in here for the decision.
 *
 * The rule that matters: completion belongs to ONE event round. It needs its
 * own tee times, and every round played off them must have finished. The old
 * event-wide test ("are all linked rounds finished?") went true as soon as the
 * rounds that HAD tee times were done — so a two-round event completed the
 * moment round 1's last card was signed, before round 2 had been drawn. That
 * settled the fantasy book irreversibly and published season standings on half
 * an event.
 */

export type EventRoundRow = { id: string; status: string };

/** A tee-time slot plus the status of the round linked to it (null if none). */
export type TeeSlotRow = { event_round_id: string | null; roundStatus: string | null };

export type RoundCompletion = { id: string; status: string; complete: boolean };

/** Rounds and linked rounds in these states are disregarded entirely. */
const CANCELLED = "cancelled";

export function activeEventRounds(eventRounds: EventRoundRow[]): EventRoundRow[] {
  return eventRounds.filter((r) => r.status !== CANCELLED);
}

/**
 * Per-round completion. A round with no tee times has not been played, so it is
 * never complete — which is exactly what keeps a deferred round-2 draw from
 * completing the event.
 */
export function computeRoundCompletion(
  eventRounds: EventRoundRow[],
  slots: TeeSlotRow[],
): RoundCompletion[] {
  const active = activeEventRounds(eventRounds);
  const usable = slots.filter((s) => s.roundStatus !== CANCELLED);

  return active.map((er) => {
    const own = usable.filter(
      (s) =>
        s.event_round_id === er.id ||
        // Tee times created before event_round_id existed. Attribute them only
        // when there is a single round, where it cannot be ambiguous.
        (s.event_round_id === null && active.length === 1),
    );
    const linked = own.filter((s) => s.roundStatus != null);

    return {
      id: er.id,
      status: er.status,
      complete: linked.length > 0 && linked.every((s) => s.roundStatus === "finished"),
    };
  });
}

/**
 * The event is done only when every non-cancelled round is — either just
 * finished, or already marked completed by an earlier pass.
 */
export function isEventComplete(completion: RoundCompletion[]): boolean {
  return (
    completion.length > 0 &&
    completion.every((r) => r.complete || r.status === "completed")
  );
}

/** Rounds that finished this pass and need their status persisting. */
export function newlyCompletedRoundIds(completion: RoundCompletion[]): string[] {
  return completion
    .filter((r) => r.complete && r.status !== "completed" && r.status !== CANCELLED)
    .map((r) => r.id);
}
