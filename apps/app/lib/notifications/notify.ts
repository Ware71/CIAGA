import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendPushToProfiles } from "@/lib/push/sendPush";
import {
  renderNotification,
  type NotificationActor,
  type NotificationType,
} from "@/lib/notifications/render";
import { categoryForType, priorityForType } from "@/lib/notifications/preferences";
import { APP_TIME_ZONE } from "@/lib/notifications/render";

/**
 * Central notification writer. Inserts an in-app notification row and fires a
 * Web Push to the recipient. Best-effort by default — callers (API routes,
 * feed emitters) should not have their primary action fail because a
 * notification could not be written.
 *
 * Grouping: pass `groupKey` to aggregate. If an unread row with the same
 * (profile_id, group_key) exists, its payload is merged (actors deduped, count
 * recomputed) and it is bumped back to unread instead of inserting a new row.
 *
 * THE IN-APP ROW IS ALWAYS WRITTEN. Everything below only decides whether the
 * device buzzes. A suppressed push is never dropped — it is picked up by the
 * 08:00 catch-up digest (see catchUpDigest.ts). See docs/notifications.md §7.
 *
 * The push decision runs four gates, short-circuiting on the first refusal:
 *
 *   1. Category mute      — all types. The user's own choice; always wins.
 *   2. Per-group cooldown — ALL types, no exceptions. An anti-spam floor: a
 *                           group that buzzed within PUSH_COOLDOWN_MS merges
 *                           silently. This is what stops 40 reactions being 40
 *                           buzzes, even for a high-priority direct reply.
 *   3. Quiet hours        — all but `urgent`. 22:00–08:00 UK is held for the
 *                           digest. Ends at 08:00, not 07:00, because the daily
 *                           cron is what releases them.
 *   4. Rolling-hour cap   — all but `urgent` and `high`.
 */

/** Per-(profile, group) push cooldown. */
const PUSH_COOLDOWN_MS = 15 * 60 * 1000;
/** Max individual pushes per profile per rolling hour, for throttleable types. */
const PUSH_BUDGET_PER_HOUR = 5;
const BUDGET_WINDOW_MS = 60 * 60 * 1000;
/** Quiet hours in UK local time — [start, end). */
const QUIET_START_HOUR = 22;
const QUIET_END_HOUR = 8;

/** The hour of day (0–23) in UK local time at the given instant. */
function ukHour(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: APP_TIME_ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(at)
  );
}

/** True during 22:00–08:00 Europe/London, when only `urgent` may buzz. */
export function isQuietHours(at: Date = new Date()): boolean {
  const h = ukHour(at);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/**
 * Gate 1 — of the given recipients, which have NOT muted this type's category.
 * One query for the whole set; fan-out callers resolve it once and pass the
 * per-recipient answer into createNotification to avoid an N+1.
 *
 * Fails open: on error, or for a type with no category, everyone is allowed.
 * Note this is the OPPOSITE asymmetry to priorityForType, which fails closed to
 * `normal` — a new type stays pushable but throttleable.
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

/**
 * Gate 2 — has this (profile, group) buzzed within the cooldown?
 * Applies to every type including `urgent`: it is an anti-spam floor, not a
 * preference. Fails open (allows the push) so a query error never silences.
 */
async function isGroupInCooldown(
  profileId: string,
  groupKey: string
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - PUSH_COOLDOWN_MS).toISOString();
    const { count } = await supabaseAdmin
      .from("user_notifications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .eq("group_key", groupKey)
      .gt("last_pushed_at", since);
    return (count ?? 0) > 0;
  } catch (e: any) {
    console.error("[notify] cooldown check failed:", e?.message);
    return false;
  }
}

/**
 * Gate 4 — has this profile exhausted its rolling-hour push budget?
 * Counts genuine individual pushes only; digest coverage is stamped on
 * `digested_at` precisely so it does not consume the budget.
 * Fails open.
 */
async function isOverPushBudget(profileId: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - BUDGET_WINDOW_MS).toISOString();
    const { count } = await supabaseAdmin
      .from("user_notifications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .gt("last_pushed_at", since);
    return (count ?? 0) >= PUSH_BUDGET_PER_HOUR;
  } catch (e: any) {
    console.error("[notify] budget check failed:", e?.message);
    return false;
  }
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

/**
 * Cap on actors stored in a grouped payload. Without it a post with 500
 * reactions stores 500 actor objects in jsonb on EVERY recipient's row. The
 * copy only ever names two, so we keep a few for headroom and carry the true
 * figure in `total_count`, which formatActorNames uses for "and N others".
 */
const MAX_STORED_ACTORS = 10;

function seedGroupedPayload(payload: Record<string, any>): Record<string, any> {
  const actors: NotificationActor[] = Array.isArray(payload.actors) ? payload.actors : [];
  return {
    ...payload,
    actors: actors.slice(0, MAX_STORED_ACTORS),
    count: actors.length,
    total_count: actors.length,
  };
}

function mergeGroupedPayload(
  existing: Record<string, any>,
  incoming: Record<string, any>
): Record<string, any> {
  const merged = mergeActors(existing.actors, incoming.actors);

  // The true total can exceed what we store, so it cannot be derived from the
  // array length once capped: track how many NEW actors this write introduced.
  const previousTotal = Math.max(
    Number(existing.total_count ?? 0),
    Array.isArray(existing.actors) ? existing.actors.length : 0
  );
  const previouslyKnown = new Set(
    (Array.isArray(existing.actors) ? existing.actors : []).map((a: any) => a?.profile_id)
  );
  const added = (Array.isArray(incoming.actors) ? incoming.actors : []).filter(
    (a: any) => a?.profile_id && !previouslyKnown.has(a.profile_id)
  ).length;
  const totalCount = previousTotal + added;

  return {
    ...existing,
    ...incoming,
    actors: merged.slice(0, MAX_STORED_ACTORS),
    count: totalCount,
    total_count: totalCount,
  };
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
  // The row this write landed on — needed to stamp last_pushed_at if we push.
  let rowId: string | null = null;

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
        rowId = (existing as any).id;
        await supabaseAdmin
          .from("user_notifications")
          .update({
            payload: finalPayload,
            updated_at: new Date().toISOString(),
            read: false,
          })
          .eq("id", rowId);
      } else {
        finalPayload = seedGroupedPayload(payload ?? {});
        const { data: inserted } = await supabaseAdmin
          .from("user_notifications")
          .insert({
            profile_id: recipientProfileId,
            type,
            payload: finalPayload,
            group_key: groupKey,
          })
          .select("id")
          .single();
        rowId = (inserted as any)?.id ?? null;
      }
    } else {
      const { data: inserted } = await supabaseAdmin
        .from("user_notifications")
        .insert({
          profile_id: recipientProfileId,
          type,
          payload: finalPayload,
        })
        .select("id")
        .single();
      rowId = (inserted as any)?.id ?? null;
    }
  } catch (e: any) {
    console.error("[notify] failed to write notification:", e?.message);
    return;
  }

  // ── Push decision ────────────────────────────────────────────────────────
  // The in-app row above is written regardless. Everything below only decides
  // whether the device buzzes; a suppressed push is collected by the 08:00
  // catch-up digest. See docs/notifications.md §7.3.

  // Gate 1 — the user's own choice. Always wins, even over `urgent`.
  const mayPush =
    pushAllowed ?? (await resolvePushRecipients([recipientProfileId], type)).has(recipientProfileId);
  if (!mayPush) return;

  const priority = priorityForType(type);

  // Gate 2 — per-group cooldown. No exceptions: forty replies must never be
  // forty buzzes, however personal each one is.
  if (groupKey && (await isGroupInCooldown(recipientProfileId, groupKey))) return;

  // Gate 3 — quiet hours. Held for the digest rather than dropped.
  if (priority !== "urgent" && isQuietHours()) return;

  // Gate 4 — rolling-hour budget.
  if (priority === "normal" && (await isOverPushBudget(recipientProfileId))) return;

  try {
    // Current unread count for this recipient — stamped into the push so the
    // service worker can set the app-icon badge while the app is closed.
    const { count: unread } = await supabaseAdmin
      .from("user_notifications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", recipientProfileId)
      .eq("read", false);

    const rendered = renderNotification(type, finalPayload);
    const result = await sendPushToProfiles([recipientProfileId], {
      title: rendered.title,
      body: rendered.body,
      url: rendered.url,
      // NOTE: rendered.icon is a lucide key ("door-open") for the bell UI, not a
      // URL — passing it here resolved to a 404 and killed the push icon. Leave
      // it unset so the service worker falls back to /icons/icon-192.png.
      tag: groupKey ?? undefined,
      badgeCount: unread ?? undefined,
    });

    // Stamp only on a push that actually reached a device. A row that reached
    // zero devices stays digest-eligible and does not consume the budget —
    // otherwise a user with no working subscription would be throttled on the
    // strength of pushes they never received.
    if (rowId && result.sent > 0) {
      await supabaseAdmin
        .from("user_notifications")
        .update({ last_pushed_at: new Date().toISOString() })
        .eq("id", rowId);
    }

    // The result carries the only evidence of why a push didn't arrive; it used
    // to be discarded, which made "bell row but no buzz" undiagnosable.
    if (!result.configured) {
      console.error(
        `[notify] push not configured for ${type} → ${recipientProfileId} (missing: ${(result.missingEnv ?? []).join(", ") || "?"})`
      );
    } else if (result.sent === 0) {
      console.warn(
        `[notify] push delivered to 0 devices for ${type} → ${recipientProfileId} (subscriptions=${result.total}, failed=${result.failed})`
      );
    }
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
