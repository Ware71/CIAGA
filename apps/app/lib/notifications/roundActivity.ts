import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createNotification } from "@/lib/notifications/notify";
import type { NotificationActor } from "@/lib/notifications/render";

/** Best-effort round result, supplied at finish for the completion copy. */
export type RoundResult = {
  winner_name?: string | null;
  winner_profile_id?: string | null;
  /** Match play only */
  loser_name?: string | null;
  /** Match play only — e.g. "3&2", "2 up" */
  margin?: string | null;
  /** Match play only — true when all square */
  match_halved?: boolean;
};

/**
 * Notify the followers of a round's players that the round has started or
 * completed. Grouped per recipient PER ROUND so that:
 *  - multiple followed players in the SAME round → one notification listing all,
 *  - the winner/result copy stays unambiguous (one card per round, not per day).
 *
 * Recipients who are themselves participants of the round are flagged
 * (`co_player`) so the copy reads "… your round". For completed rounds the body
 * states the result (winner, or who-beat-who + margin for match play), plus a
 * "🏆 New course record" callout when a player set one.
 *
 * Best-effort: never throws — the round start/finish must not fail on this.
 */
export async function notifyFollowersOfRoundActivity(params: {
  roundId: string;
  kind: "started" | "completed";
  result?: RoundResult;
}): Promise<void> {
  const { roundId, kind, result } = params;
  if (!roundId) return;

  try {
    // 1. Round players (non-guest, with a profile) — these are the "subjects".
    const { data: parts } = await supabaseAdmin
      .from("round_participants")
      .select("profile_id")
      .eq("round_id", roundId)
      .eq("is_guest", false)
      .not("profile_id", "is", null);

    const subjectIds = Array.from(
      new Set((parts ?? []).map((p: any) => p.profile_id).filter(Boolean))
    ) as string[];
    if (subjectIds.length === 0) return;

    // 2. Display names for the subjects.
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, name")
      .in("id", subjectIds);
    const nameById = new Map<string, string>(
      (profs ?? []).map((p: any) => [p.id, p.name ?? "A golfer"])
    );

    // 3. Followers of any subject: follows(follower_id -> following_id).
    const { data: followRows } = await supabaseAdmin
      .from("follows")
      .select("follower_id, following_id")
      .in("following_id", subjectIds);

    if (!followRows || followRows.length === 0) return;

    // 4. Course-record holders for this round (completed only).
    const crCourseByProfile = new Map<string, string | null>();
    if (kind === "completed") {
      const { data: crRows } = await supabaseAdmin
        .from("feed_items")
        .select("payload")
        .eq("type", "course_record")
        .eq("payload->>round_id", roundId);
      for (const r of (crRows ?? []) as any[]) {
        const pid = r?.payload?.profile_id as string | undefined;
        if (pid) crCourseByProfile.set(pid, r?.payload?.course_name ?? null);
      }
    }

    // 5. Build per-follower actor lists (only the subjects THEY follow).
    const followedByRecipient = new Map<string, Set<string>>();
    for (const row of followRows as any[]) {
      const follower = row.follower_id as string;
      const subject = row.following_id as string;
      if (!follower || !subject) continue;
      if (follower === subject) continue; // safety; constraint should prevent
      const set = followedByRecipient.get(follower) ?? new Set<string>();
      set.add(subject);
      followedByRecipient.set(follower, set);
    }

    const type = kind === "started" ? "follow_round_started" : "follow_round_completed";
    const date = new Date().toISOString().slice(0, 10);
    // Per-round grouping: one card per round (collapses multiple followed
    // co-players in the same round) and keeps the winner copy unambiguous.
    const groupKey = `follow_${kind}:${roundId}`;
    const subjectIdSet = new Set(subjectIds);

    const resultPayload =
      kind === "completed" && result
        ? {
            winner_name: result.winner_name ?? null,
            winner_profile_id: result.winner_profile_id ?? null,
            loser_name: result.loser_name ?? null,
            margin: result.margin ?? null,
            match_halved: !!result.match_halved,
          }
        : {};

    await Promise.allSettled(
      Array.from(followedByRecipient.entries()).map(([recipientId, subjects]) => {
        const actors: NotificationActor[] = Array.from(subjects).map((sid) => {
          const actor: NotificationActor = { profile_id: sid, name: nameById.get(sid) ?? "A golfer" };
          if (kind === "completed" && crCourseByProfile.has(sid)) {
            actor.course_record = true;
            actor.course_name = crCourseByProfile.get(sid) ?? null;
          }
          return actor;
        });

        // The recipient is also playing in this round → "… your round".
        const coPlayer = subjectIdSet.has(recipientId);

        return createNotification({
          recipientProfileId: recipientId,
          type,
          payload: { actors, date, round_id: roundId, co_player: coPlayer, ...resultPayload },
          groupKey,
        });
      })
    );
  } catch (e: any) {
    console.error("[notify] notifyFollowersOfRoundActivity failed:", e?.message);
  }
}
