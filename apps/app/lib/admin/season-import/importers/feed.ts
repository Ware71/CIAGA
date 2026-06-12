import { emitHoleEventFeedItems } from "@/lib/feed/generators/holeEvents";

/**
 * Backfills feed items for imported rounds.
 *
 * Only hole_event cards (eagle / albatross / hole-in-one) are emitted —
 * event rounds never get a round_played card. Imported rounds carry the same
 * event_tee_time_id link as live ones, so emitRoundPlayedFeedItem's own
 * suppression would also kick in; we simply never call it.
 *
 * The generators are idempotent by group_key and derive occurred_at from the
 * round's (backdated) finished_at, so re-runs are safe and cards read as
 * historical.
 */
export async function backfillFeedForRounds(args: {
  roundIds: string[];
  actorProfileId: string;
  summary: any;
}) {
  const { roundIds, actorProfileId, summary } = args;
  for (const roundId of roundIds) {
    const items = await emitHoleEventFeedItems({ roundId, actorProfileId });
    summary.feed_items_created += items.length;
  }
}
