import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Resolves which `event_rounds` row a played round belongs to.
 *
 * Every submission needs this: it is what makes R1 and R2 distinguishable
 * downstream. Without it the frozen leaderboard and countback fall back to
 * ordering by `submitted_at`, which a backfill or an admin re-accept can put
 * out of order.
 *
 * The tee time is the authority — it carries `event_round_id` from the moment
 * the organiser creates it. The "sole event round" fallback exists only for
 * legacy single-round events whose tee times pre-date that column; it is
 * deliberately NOT applied to multi-round events, where guessing round 1 would
 * silently stamp round 2's card as round 1.
 *
 * Returns `null` when the round isn't part of an event, or when the event has
 * several rounds and the tee time doesn't say which.
 */
export async function resolveEventRoundForRound(
  roundId: string
): Promise<{ eventId: string; eventRoundId: string | null } | null> {
  const { data: teeTime } = await supabaseAdmin
    .from("event_tee_times")
    .select("event_id, event_round_id")
    .eq("round_id", roundId)
    .maybeSingle();

  if (!teeTime) return null;

  const eventId = (teeTime as any).event_id as string;
  const explicit = (teeTime as any).event_round_id as string | null;
  if (explicit) return { eventId, eventRoundId: explicit };

  const { data: rounds } = await supabaseAdmin
    .from("event_rounds")
    .select("id")
    .eq("event_id", eventId)
    .not("status", "eq", "cancelled")
    .order("round_number", { ascending: true });

  // Exactly one round: unambiguous, so adopt it. More than one: unknowable
  // from here, and a wrong guess corrupts the round ordering.
  if (rounds && rounds.length === 1) {
    return { eventId, eventRoundId: (rounds[0] as any).id as string };
  }

  return { eventId, eventRoundId: null };
}

/**
 * For each profile, the `round_id` of their FINAL round in the event —
 * the highest `event_rounds.round_number` they have an accepted submission for.
 *
 * Countback is decided on the last round played (R&A convention), and the
 * playing handicap quoted for a playoff should come from that same card. Both
 * used to pick it with `ORDER BY submitted_at DESC LIMIT 1`, which is only
 * usually the final round: an admin re-accepting round 1 after round 2 was in
 * silently switched the countback to round 1.
 *
 * Falls back to `submitted_at` for submissions with no `event_round_id`.
 * Profiles with no accepted submission are absent from the map.
 */
export async function getFinalRoundSubmissions(
  eventId: string,
  profileIds: string[]
): Promise<Record<string, string>> {
  if (profileIds.length === 0) return {};

  const { data } = await supabaseAdmin
    .from("event_round_submissions")
    .select("profile_id, round_id, submitted_at, event_round:event_rounds(round_number)")
    .eq("event_id", eventId)
    .eq("accepted", true)
    .in("profile_id", profileIds);

  return selectFinalRounds(
    ((data ?? []) as any[]).map((row) => ({
      profileId: row.profile_id as string,
      roundId: row.round_id as string | null,
      submittedAt: (row.submitted_at as string | null) ?? "",
      roundNumber: (row.event_round?.round_number as number | undefined) ?? null,
    }))
  );
}

export type SubmissionRow = {
  profileId: string;
  roundId: string | null;
  submittedAt: string;
  /** null for submissions whose event_round_id could not be resolved. */
  roundNumber: number | null;
};

/**
 * Picks each profile's final round: highest `roundNumber`, breaking ties on
 * `submittedAt`. Rows with no round number sort below every numbered one, so a
 * placed round always beats an unplaceable one; among unplaceable rows only,
 * this degrades to the old "latest submitted" behaviour.
 */
export function selectFinalRounds(rows: SubmissionRow[]): Record<string, string> {
  const best: Record<string, { roundNumber: number; submittedAt: string; roundId: string }> = {};

  for (const row of rows) {
    if (!row.roundId) continue;
    const roundNumber = row.roundNumber ?? -1;
    const current = best[row.profileId];
    const wins =
      !current ||
      roundNumber > current.roundNumber ||
      (roundNumber === current.roundNumber && row.submittedAt > current.submittedAt);
    if (wins) {
      best[row.profileId] = {
        roundNumber,
        submittedAt: row.submittedAt,
        roundId: row.roundId,
      };
    }
  }

  return Object.fromEntries(
    Object.entries(best).map(([profileId, v]) => [profileId, v.roundId])
  );
}
