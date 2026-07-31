import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createNotification, resolvePushRecipients } from "@/lib/notifications/notify";
import type { NotificationActor, NotificationType } from "@/lib/notifications/render";

/**
 * Social fan-out — thread following, reactions and follows.
 * See docs/notifications.md §7.7.
 *
 * These are the highest-volume notification types in the app, so two rules
 * apply throughout:
 *
 *  1. EVERY recipient set is filtered through feed_item_targets. supabaseAdmin
 *     bypasses RLS, so visibility is enforced here or not at all. The filter is
 *     BATCHED — one query for the whole set, never one per recipient.
 *  2. EVERY type here is grouped, so the in-app card collapses ("Alice, Bob and
 *     4 others commented") and the per-group push cooldown in notify.ts turns a
 *     busy thread into one buzz.
 *
 * Best-effort throughout: a comment must never fail because a notification did.
 */

async function getProfileName(profileId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("name")
    .eq("id", profileId)
    .maybeSingle();
  return (data as any)?.name ?? "Someone";
}

/**
 * Batched visibility filter — of `profileIds`, which may actually see this feed
 * item. One query, mirroring how resolvePushRecipients batches preferences.
 *
 * Fails CLOSED (returns empty): unlike the push-preference lookup, a failure
 * here would leak a post's existence to people outside its audience.
 */
export async function filterViewersWhoCanReadFeedItem(
  feedItemId: string,
  profileIds: string[]
): Promise<Set<string>> {
  const ids = Array.from(new Set(profileIds.filter(Boolean)));
  if (!feedItemId || ids.length === 0) return new Set();

  try {
    const { data, error } = await supabaseAdmin
      .from("feed_item_targets")
      .select("viewer_profile_id")
      .eq("feed_item_id", feedItemId)
      .in("viewer_profile_id", ids);

    if (error) {
      console.error("[notify] visibility filter failed:", error.message);
      return new Set();
    }
    return new Set((data ?? []).map((r: any) => r.viewer_profile_id as string));
  } catch (e: any) {
    console.error("[notify] visibility filter failed:", e?.message);
    return new Set();
  }
}

/**
 * Everyone who has commented on a feed item. Note feed_comments has no index on
 * profile_id — the (feed_item_id, created_at) index covers the lookup, and we
 * dedupe in JS rather than asking Postgres for DISTINCT.
 */
export async function getThreadParticipantIds(feedItemId: string): Promise<string[]> {
  if (!feedItemId) return [];
  try {
    const { data } = await supabaseAdmin
      .from("feed_comments")
      .select("profile_id")
      .eq("feed_item_id", feedItemId)
      .neq("visibility", "removed");
    return Array.from(
      new Set((data ?? []).map((r: any) => r.profile_id as string).filter(Boolean))
    );
  } catch (e: any) {
    console.error("[notify] getThreadParticipantIds failed:", e?.message);
    return [];
  }
}

/**
 * Who a feed item belongs to. `actor_profile_id` is the author for user_post
 * but is NULLABLE, so system-generated cards (round_played, course_record …)
 * fall back to their subjects.
 */
export async function getFeedItemOwnerIds(feedItemId: string): Promise<string[]> {
  if (!feedItemId) return [];
  try {
    const { data: item } = await supabaseAdmin
      .from("feed_items")
      .select("actor_profile_id")
      .eq("id", feedItemId)
      .maybeSingle();

    const actorId = (item as any)?.actor_profile_id as string | null;
    if (actorId) return [actorId];

    const { data: subjects } = await supabaseAdmin
      .from("feed_item_subjects")
      .select("subject_profile_id")
      .eq("feed_item_id", feedItemId);
    return Array.from(
      new Set((subjects ?? []).map((s: any) => s.subject_profile_id as string).filter(Boolean))
    );
  } catch (e: any) {
    console.error("[notify] getFeedItemOwnerIds failed:", e?.message);
    return [];
  }
}

/** Shared grouped fan-out: resolve push permission once, then merge per recipient. */
async function fanOutGrouped(
  recipientIds: string[],
  type: NotificationType,
  payload: Record<string, any>,
  groupKey: string
): Promise<void> {
  if (recipientIds.length === 0) return;
  const pushable = await resolvePushRecipients(recipientIds, type);
  await Promise.allSettled(
    recipientIds.map((recipientProfileId) =>
      createNotification({
        recipientProfileId,
        type,
        payload,
        groupKey,
        pushAllowed: pushable.has(recipientProfileId),
      })
    )
  );
}

/**
 * Someone commented on a post you wrote or replied to.
 *
 * PRECEDENCE LADDER — one comment produces at most ONE notification per person:
 *
 *     mention_comment  >  comment_reply  >  comment_on_post
 *
 * Without this, being @-named in a reply to your own comment on your own post
 * fires three separate notifications for a single event. `alreadyNotified`
 * carries the mention recipients the caller has already handled.
 */
export async function notifyThreadActivity(params: {
  feedItemId: string;
  commentId: string;
  actorProfileId: string;
  excerpt: string;
  parentCommentId?: string | null;
  /** Profiles already notified for this comment (mentions) — never notified twice. */
  alreadyNotified?: string[];
}): Promise<void> {
  const { feedItemId, commentId, actorProfileId, excerpt, parentCommentId, alreadyNotified } =
    params;
  if (!feedItemId || !actorProfileId) return;

  try {
    const claimed = new Set([actorProfileId, ...(alreadyNotified ?? [])]);
    const actorName = await getProfileName(actorProfileId);
    const actors: NotificationActor[] = [{ profile_id: actorProfileId, name: actorName }];

    // ── Rung 2: a direct reply to someone's comment ────────────────────────
    let parentAuthorId: string | null = null;
    if (parentCommentId) {
      const { data: parent } = await supabaseAdmin
        .from("feed_comments")
        .select("profile_id")
        .eq("id", parentCommentId)
        .maybeSingle();
      const candidate = (parent as any)?.profile_id as string | null;
      if (candidate && !claimed.has(candidate)) parentAuthorId = candidate;
    }

    // ── Rung 3: the post author + everyone else in the thread ──────────────
    const [ownerIds, participantIds] = await Promise.all([
      getFeedItemOwnerIds(feedItemId),
      getThreadParticipantIds(feedItemId),
    ]);
    const threadIds = Array.from(new Set([...ownerIds, ...participantIds])).filter(
      (id) => !claimed.has(id) && id !== parentAuthorId
    );

    // One visibility query for both rungs.
    const candidates = [...(parentAuthorId ? [parentAuthorId] : []), ...threadIds];
    const visible = await filterViewersWhoCanReadFeedItem(feedItemId, candidates);

    const basePayload = {
      feed_item_id: feedItemId,
      comment_id: commentId,
      actor_profile_id: actorProfileId,
      actor_name: actorName,
      actors,
      excerpt,
    };

    if (parentAuthorId && visible.has(parentAuthorId)) {
      // Not grouped: a direct reply is a conversation, and the cooldown in
      // notify.ts already prevents a reply storm from becoming a buzz storm.
      await createNotification({
        recipientProfileId: parentAuthorId,
        type: "comment_reply",
        payload: basePayload,
      });
    }

    // Split the last rung so the author reads "your post" and a fellow
    // commenter reads "a post you commented on". Group key is scoped per
    // recipient, so the two fan-outs cannot collide.
    const ownerSet = new Set(ownerIds);
    const threadRecipients = threadIds.filter((id) => visible.has(id));
    const groupKey = `comment_on_post:${feedItemId}`;

    await Promise.all([
      fanOutGrouped(
        threadRecipients.filter((id) => ownerSet.has(id)),
        "comment_on_post",
        { ...basePayload, is_author: true },
        groupKey
      ),
      fanOutGrouped(
        threadRecipients.filter((id) => !ownerSet.has(id)),
        "comment_on_post",
        { ...basePayload, is_author: false },
        groupKey
      ),
    ]);
  } catch (e: any) {
    console.error("[notify] notifyThreadActivity failed:", e?.message);
  }
}

/** Someone reacted to your post. Author only — reactions on a thread you merely
 *  commented on would be pure noise. */
export async function notifyPostReaction(params: {
  feedItemId: string;
  actorProfileId: string;
  emoji: string;
}): Promise<void> {
  const { feedItemId, actorProfileId, emoji } = params;
  if (!feedItemId || !actorProfileId) return;

  try {
    const ownerIds = (await getFeedItemOwnerIds(feedItemId)).filter(
      (id) => id !== actorProfileId
    );
    if (ownerIds.length === 0) return;

    const visible = await filterViewersWhoCanReadFeedItem(feedItemId, ownerIds);
    const recipients = ownerIds.filter((id) => visible.has(id));
    if (recipients.length === 0) return;

    const actorName = await getProfileName(actorProfileId);
    await fanOutGrouped(
      recipients,
      "post_reaction",
      {
        feed_item_id: feedItemId,
        actor_profile_id: actorProfileId,
        actor_name: actorName,
        actors: [{ profile_id: actorProfileId, name: actorName }],
        emoji,
      },
      `post_reaction:${feedItemId}`
    );
  } catch (e: any) {
    console.error("[notify] notifyPostReaction failed:", e?.message);
  }
}

/**
 * Someone followed you. Grouped PER RECIPIENT — there is no parent object to
 * group on, and grouping this way is what produces "You have 10 new followers".
 */
export async function notifyNewFollower(params: {
  followerProfileId: string;
  followedProfileId: string;
}): Promise<void> {
  const { followerProfileId, followedProfileId } = params;
  if (!followerProfileId || !followedProfileId) return;
  if (followerProfileId === followedProfileId) return;

  try {
    const actorName = await getProfileName(followerProfileId);
    await fanOutGrouped(
      [followedProfileId],
      "new_follower",
      {
        actor_profile_id: followerProfileId,
        actor_name: actorName,
        actors: [{ profile_id: followerProfileId, name: actorName }],
      },
      `new_follower:${followedProfileId}`
    );
  } catch (e: any) {
    console.error("[notify] notifyNewFollower failed:", e?.message);
  }
}
