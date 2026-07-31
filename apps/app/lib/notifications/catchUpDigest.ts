import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendPushToProfiles } from "@/lib/push/sendPush";
import { categoryForType } from "@/lib/notifications/preferences";

/**
 * The 08:00 catch-up digest — the release valve that makes push throttling
 * acceptable. See docs/notifications.md §7.6.
 *
 * A notification whose push was suppressed (quiet hours, rolling-hour budget,
 * or a group cooldown) is never dropped: its row is written and it sits with
 * `last_pushed_at IS NULL`. This sweep collects those rows per profile,
 * collapses them BY TYPE, and sends ONE push:
 *
 *     You've missed a few things
 *     10 new followers · 3 new events · 6 comments
 *
 * Two deliberate asymmetries with the individual push path:
 *
 *  - It creates NO notification row. The digest is a push over rows that
 *    already exist, so the bell is untouched and nothing double-counts.
 *  - It ignores the rolling-hour budget, because it is the mechanism that makes
 *    the budget survivable. Suppressing the digest would strand notifications.
 *
 * It stamps `digested_at` (not `last_pushed_at`) on every row it covers, so a
 * digest never consumes the budget for the hour that follows it.
 *
 * Category mutes are still honoured: a row whose category the user has muted is
 * excluded, because they asked not to be buzzed about it at all.
 */

/** Rows older than this are considered stale and are stamped without buzzing. */
const MAX_DIGEST_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Safety rail — a single sweep never fans out beyond this many profiles. */
const MAX_PROFILES_PER_RUN = 500;

type PendingRow = {
  id: string;
  profile_id: string;
  type: string;
  created_at: string;
};

/** "10 new followers" — plural-aware summary for one type. */
function summariseType(type: string, count: number): string {
  const plural = count === 1 ? "" : "s";
  switch (type) {
    case "new_follower":
      return `${count} new follower${plural}`;
    case "event_created":
      return `${count} new event${plural}`;
    case "entry_open":
      return `${count} entry window${count === 1 ? "" : "s"} open`;
    case "comment_on_post":
      return `${count} comment${plural}`;
    case "post_reaction":
      return `${count} reaction${plural}`;
    case "follow_round_started":
      return `${count} round${plural} started`;
    case "follow_round_completed":
      return `${count} round${plural} completed`;
    case "event_entry_received":
      return `${count} new entr${count === 1 ? "y" : "ies"}`;
    case "event_withdrawal":
      return `${count} withdrawal${plural}`;
    case "join_request_pending":
      return `${count} join request${plural}`;
    case "payment_recorded":
      return `${count} payment${plural} recorded`;
    default:
      return `${count} update${plural}`;
  }
}

/** Build the digest body, longest-first, capped so the OS doesn't truncate mid-item. */
function buildDigestBody(counts: Map<string, number>): string {
  const parts = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => summariseType(type, count));

  if (parts.length <= 3) return parts.join(" · ");
  const shown = parts.slice(0, 3);
  const remaining = parts.length - 3;
  return `${shown.join(" · ")} · and ${remaining} more`;
}

export async function runCatchUpDigest(): Promise<{
  profiles: number;
  pushed: number;
  rows: number;
}> {
  const now = new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - MAX_DIGEST_AGE_MS).toISOString();

  // Everything suppressed and still unseen. Ordered oldest-first so a large
  // backlog degrades predictably rather than randomly.
  const { data, error } = await supabaseAdmin
    .from("user_notifications")
    .select("id, profile_id, type, created_at")
    .is("last_pushed_at", null)
    .is("digested_at", null)
    .eq("read", false)
    .order("created_at", { ascending: true })
    .limit(5000);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as PendingRow[];
  if (rows.length === 0) return { profiles: 0, pushed: 0, rows: 0 };

  const byProfile = new Map<string, PendingRow[]>();
  for (const row of rows) {
    if (!row.profile_id) continue;
    const list = byProfile.get(row.profile_id) ?? [];
    list.push(row);
    byProfile.set(row.profile_id, list);
  }

  // Honour category mutes — one query for the whole sweep.
  const profileIds = Array.from(byProfile.keys()).slice(0, MAX_PROFILES_PER_RUN);
  const mutedByProfile = new Map<string, Set<string>>();
  try {
    const { data: prefs } = await supabaseAdmin
      .from("notification_preferences")
      .select("profile_id, muted_categories")
      .in("profile_id", profileIds);
    for (const p of (prefs ?? []) as any[]) {
      mutedByProfile.set(p.profile_id, new Set(p.muted_categories ?? []));
    }
  } catch (e: any) {
    console.error("[digest] failed to load preferences:", e?.message);
  }

  let pushed = 0;
  let stamped = 0;

  for (const profileId of profileIds) {
    const profileRows = byProfile.get(profileId) ?? [];
    const muted = mutedByProfile.get(profileId) ?? new Set<string>();

    // Split: what we buzz about, versus what we merely stamp.
    const counts = new Map<string, number>();
    for (const row of profileRows) {
      const category = categoryForType(row.type);
      if (category && muted.has(category)) continue;
      if (row.created_at < staleBefore) continue;
      counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
    }

    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);

    if (total > 0) {
      try {
        const { count: unread } = await supabaseAdmin
          .from("user_notifications")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", profileId)
          .eq("read", false);

        const result = await sendPushToProfiles([profileId], {
          title: "You've missed a few things",
          body: buildDigestBody(counts),
          // Home, not a deep link: a digest spans types so there is no single
          // destination. The bell and its unread badge are on this screen.
          // (A ?notifications=1 param would need useSearchParams in HomeClient,
          // which drags in a Suspense boundary the splash is sensitive to.)
          url: "/home",
          tag: "catch-up-digest",
          badgeCount: unread ?? undefined,
        });
        if (result.sent > 0) pushed++;
      } catch (e: any) {
        console.error(`[digest] push failed for ${profileId}:`, e?.message);
      }
    }

    // Stamp everything we considered — including muted and stale rows, which
    // must not stay candidates and re-surface on tomorrow's run.
    try {
      const ids = profileRows.map((r) => r.id);
      if (ids.length > 0) {
        await supabaseAdmin
          .from("user_notifications")
          .update({ digested_at: nowIso })
          .in("id", ids);
        stamped += ids.length;
      }
    } catch (e: any) {
      console.error(`[digest] failed to stamp rows for ${profileId}:`, e?.message);
    }
  }

  return { profiles: profileIds.length, pushed, rows: stamped };
}
