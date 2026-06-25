import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendPushToProfiles } from "@/lib/push/sendPush";
import {
  renderNotification,
  type NotificationActor,
  type NotificationType,
} from "@/lib/notifications/render";

/**
 * Central notification writer. Inserts an in-app notification row and fires a
 * Web Push to the recipient. Best-effort by default — callers (API routes,
 * feed emitters) should not have their primary action fail because a
 * notification could not be written.
 *
 * Grouping: pass `groupKey` to aggregate. If an unread row with the same
 * (profile_id, group_key) exists, its payload is merged (actors deduped, count
 * recomputed) and it is bumped back to unread instead of inserting a new row.
 * One device push is sent per write, tagged with the groupKey so the OS
 * coalesces repeats.
 */

function mergeActors(
  a: NotificationActor[] | undefined,
  b: NotificationActor[] | undefined
): NotificationActor[] {
  const map = new Map<string, NotificationActor>();
  for (const x of [...(a ?? []), ...(b ?? [])]) {
    if (x && x.profile_id) map.set(x.profile_id, { ...map.get(x.profile_id), ...x });
  }
  return Array.from(map.values());
}

function seedGroupedPayload(payload: Record<string, any>): Record<string, any> {
  const actors: NotificationActor[] = Array.isArray(payload.actors) ? payload.actors : [];
  return { ...payload, actors, count: actors.length };
}

function mergeGroupedPayload(
  existing: Record<string, any>,
  incoming: Record<string, any>
): Record<string, any> {
  const actors = mergeActors(existing.actors, incoming.actors);
  return { ...existing, ...incoming, actors, count: actors.length };
}

export async function createNotification(params: {
  recipientProfileId: string;
  type: NotificationType | string;
  payload: Record<string, any>;
  groupKey?: string | null;
}): Promise<void> {
  const { recipientProfileId, type, payload, groupKey } = params;
  if (!recipientProfileId) return;

  let finalPayload: Record<string, any> = payload ?? {};

  try {
    if (groupKey) {
      const { data: existing } = await supabaseAdmin
        .from("user_notifications")
        .select("id, payload")
        .eq("profile_id", recipientProfileId)
        .eq("group_key", groupKey)
        .eq("read", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if ((existing as any)?.id) {
        finalPayload = mergeGroupedPayload((existing as any).payload ?? {}, payload ?? {});
        await supabaseAdmin
          .from("user_notifications")
          .update({
            payload: finalPayload,
            updated_at: new Date().toISOString(),
            read: false,
          })
          .eq("id", (existing as any).id);
      } else {
        finalPayload = seedGroupedPayload(payload ?? {});
        await supabaseAdmin.from("user_notifications").insert({
          profile_id: recipientProfileId,
          type,
          payload: finalPayload,
          group_key: groupKey,
        });
      }
    } else {
      await supabaseAdmin.from("user_notifications").insert({
        profile_id: recipientProfileId,
        type,
        payload: finalPayload,
      });
    }
  } catch (e: any) {
    console.error("[notify] failed to write notification:", e?.message);
    return;
  }

  // Push delivery (best-effort).
  try {
    const rendered = renderNotification(type, finalPayload);
    await sendPushToProfiles([recipientProfileId], {
      title: rendered.title,
      body: rendered.body,
      url: rendered.url,
      icon: rendered.icon,
      tag: groupKey ?? undefined,
    });
  } catch (e: any) {
    console.error("[notify] push failed:", e?.message);
  }
}

/** Send the same (non-grouped) notification to many recipients. */
export async function createNotificationsForMany(
  recipientProfileIds: string[],
  type: NotificationType | string,
  payload: Record<string, any>
): Promise<void> {
  const ids = Array.from(new Set(recipientProfileIds.filter(Boolean)));
  if (ids.length === 0) return;
  await Promise.allSettled(
    ids.map((recipientProfileId) =>
      createNotification({ recipientProfileId, type, payload })
    )
  );
}
