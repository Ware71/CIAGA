import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createNotification } from "@/lib/notifications/notify";
import type { NotificationActor } from "@/lib/notifications/render";

/**
 * Notify the followers of a round's players that the round has started or
 * completed. Grouped per recipient per day so that:
 *  - multiple followed players in the SAME round → one notification listing all,
 *  - the same recipient seeing several rounds in a day → one merged card.
 *
 * For completed rounds, any player who set a new course record (detected by the
 * existing achievement emitter, which writes a `course_record` feed item keyed
 * to this round) is flagged so the copy reads "🏆 New course record".
 *
 * Best-effort: never throws — the round start/finish must not fail on this.
 */
export async function notifyFollowersOfRoundActivity(params: {
  roundId: string;
  kind: "started" | "completed";
}): Promise<void> {
  const { roundId, kind } = params;
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
    const groupKey = `follow_${kind}:${date}`;

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

        return createNotification({
          recipientProfileId: recipientId,
          type,
          payload: { actors, date, round_id: roundId },
          groupKey,
        });
      })
    );
  } catch (e: any) {
    console.error("[notify] notifyFollowersOfRoundActivity failed:", e?.message);
  }
}
