import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendPushToProfiles } from "@/lib/push/sendPush";
import {
  renderNotification,
  type NotificationActor,
  type NotificationType,
} from "@/lib/notifications/render";
import { categoryForType } from "@/lib/notifications/preferences";

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
 *
 * Preferences: a recipient who has muted this notification's category still
 * gets the in-app row (and the unread badge) — only the device push is skipped.
 * See lib/notifications/preferences.ts.
 */

/**
 * Of the given recipients, which may receive a PUSH for this notification type.
 * One query for the whole set — fan-out callers resolve it once and pass the
 * per-recipient answer into createNotification to avoid an N+1.
 *
 * Fails open: on error, or for a type with no category, everyone is allowed.
 */
export async function resolvePushRecipients(
  profileIds: string[],
  type: NotificationType | string
): Promise<Set<string>> {
  const ids = Array.from(new Set(profileIds.filter(Boolean)));
  const allowed = new Set(ids);
  const category = categoryForType(type);
  if (!category || ids.length === 0) return allowed;

  try {
    const { data, error } = await supabaseAdmin
      .from("notification_preferences")
      .select("profile_id, muted_categories")
      .in("profile_id", ids);

    if (error) {
      console.error("[notify] failed to load notification preferences:", error.message);
      return allowed;
    }

    for (const row of (data ?? []) as {
      profile_id: string;
      muted_categories: string[] | null;
    }[]) {
      if ((row.muted_categories ?? []).includes(category)) allowed.delete(row.profile_id);
    }
  } catch (e: any) {
    console.error("[notify] failed to load notification preferences:", e?.message);
  }

  return allowed;
}

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
  /** Pre-resolved push permission (see resolvePushRecipients). Looked up here
   *  when omitted — pass it from fan-out callers to avoid a query per recipient. */
  pushAllowed?: boolean;
}): Promise<void> {
  const { recipientProfileId, type, payload, groupKey, pushAllowed } = params;
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

  // Push delivery (best-effort). The in-app row above is written regardless —
  // muting a category silences the device, it does not drop the notification.
  const mayPush =
    pushAllowed ?? (await resolvePushRecipients([recipientProfileId], type)).has(recipientProfileId);
  if (!mayPush) return;

  try {
    // Current unread count for this recipient — stamped into the push so the
    // service worker can set the app-icon badge while the app is closed.
    const { count: unread } = await supabaseAdmin
      .from("user_notifications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", recipientProfileId)
      .eq("read", false);

    const rendered = renderNotification(type, finalPayload);
    await sendPushToProfiles([recipientProfileId], {
      title: rendered.title,
      body: rendered.body,
      url: rendered.url,
      // NOTE: rendered.icon is a lucide key ("door-open") for the bell UI, not a
      // URL — passing it here resolved to a 404 and killed the push icon. Leave
      // it unset so the service worker falls back to /icons/icon-192.png.
      tag: groupKey ?? undefined,
      badgeCount: unread ?? undefined,
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
  const pushable = await resolvePushRecipients(ids, type);
  await Promise.allSettled(
    ids.map((recipientProfileId) =>
      createNotification({
        recipientProfileId,
        type,
        payload,
        pushAllowed: pushable.has(recipientProfileId),
      })
    )
  );
}
