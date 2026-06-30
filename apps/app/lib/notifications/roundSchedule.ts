import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createNotification } from "@/lib/notifications/notify";
import type { NotificationActor } from "@/lib/notifications/render";

type RoundScheduleType =
  | "round_scheduled"
  | "round_schedule_changed"
  | "round_cancelled";

/**
 * Notify the non-owner participants of a round that it was scheduled for them,
 * had its time changed, or was cancelled. Mirrors the Majors tee-time flow.
 *
 * Grouped per round (`groupKey = <type>:<roundId>`) so a player added alongside
 * others — or hit by several edits — collapses into a single card per round.
 *
 * Best-effort: never throws — the primary action (add/update/delete) must not
 * fail because a notification could not be written.
 *
 * Pass `recipientProfileIds` explicitly when the participants must be captured
 * before a delete; otherwise the recipients are derived from the round's
 * current non-owner, non-guest participants (excluding the actor).
 */
export async function notifyRoundSchedule(params: {
  roundId: string;
  actorProfileId: string;
  type: RoundScheduleType;
  recipientProfileIds?: string[];
  courseName?: string | null;
  scheduledAt?: string | null;
}): Promise<void> {
  const { roundId, actorProfileId, type } = params;
  if (!roundId || !actorProfileId) return;

  try {
    // 1. Recipients — explicit list, or derive from current participants.
    let recipients = params.recipientProfileIds;
    if (!recipients) {
      const { data: parts } = await supabaseAdmin
        .from("round_participants")
        .select("profile_id, role, is_guest")
        .eq("round_id", roundId)
        .eq("is_guest", false)
        .not("profile_id", "is", null);
      recipients = (parts ?? [])
        .filter((p: any) => p.role !== "owner" && p.profile_id)
        .map((p: any) => p.profile_id as string);
    }

    const recipientIds = Array.from(
      new Set((recipients ?? []).filter((id) => id && id !== actorProfileId))
    );
    if (recipientIds.length === 0) return;

    // 2. Round context (course + scheduled time) — fetch when not supplied.
    let courseName = params.courseName ?? null;
    let scheduledAt = params.scheduledAt ?? null;
    if (params.courseName === undefined || params.scheduledAt === undefined) {
      const { data: round } = await supabaseAdmin
        .from("rounds")
        .select("scheduled_at, courses(name)")
        .eq("id", roundId)
        .maybeSingle();
      if (round) {
        if (params.scheduledAt === undefined) scheduledAt = (round as any).scheduled_at ?? null;
        if (params.courseName === undefined) courseName = (round as any).courses?.name ?? null;
      }
    }

    // 3. Actor display name.
    const { data: actorProfile } = await supabaseAdmin
      .from("profiles")
      .select("name")
      .eq("id", actorProfileId)
      .maybeSingle();
    const actorName = (actorProfile as any)?.name ?? "Someone";

    const actors: NotificationActor[] = [{ profile_id: actorProfileId, name: actorName }];
    const payload = {
      actors,
      round_id: roundId,
      course_name: courseName,
      scheduled_at: scheduledAt,
    };
    const groupKey = `${type}:${roundId}`;

    await Promise.allSettled(
      recipientIds.map((recipientProfileId) =>
        createNotification({ recipientProfileId, type, payload, groupKey })
      )
    );
  } catch (e: any) {
    console.error("[notify] notifyRoundSchedule failed:", e?.message);
  }
}
