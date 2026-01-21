import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { FeedAudience } from "@/lib/feed/types";

/**
 * Fan-out on write:
 * - Always target the actor themself
 * - If audience = followers, target all accepted followers (or all followers if no status yet)
 * - If audience = private, target only actor
 *
 * Later:
 * - match_participants -> target match participants
 * - public -> either create broad targets or rely on a different read path
 * - custom_list -> target members of list
 */

export async function fanOutFeedItemToFollowers(params: {
  feedItemId: string;
  actorProfileId: string;
  audience: FeedAudience;
}): Promise<void> {
  const { feedItemId, actorProfileId, audience } = params;

  if (!feedItemId || !actorProfileId) throw new Error("Missing ids");

  // Always include actor
  const targets: Array<{
    feed_item_id: string;
    viewer_profile_id: string;
    reason: "self" | "follow";
  }> = [
    { feed_item_id: feedItemId, viewer_profile_id: actorProfileId, reason: "self" },
  ];

  if (audience === "private") {
    await insertTargets(targets);
    return;
  }

  if (audience !== "followers") {
    // For MVP, only implement followers + private.
    // Other audiences can be implemented when needed.
    await insertTargets(targets);
    return;
  }

  // Fetch followers: rows where follower_profile_id follows actorProfileId
  // In spec naming: follows(follower_profile_id, followed_profile_id)
  // Optional privacy extension: status pending/accepted
  const { data: followers, error } = await supabaseAdmin
    .from("follows")
    .select("follower_profile_id, status")
    .eq("followed_profile_id", actorProfileId);

  if (error) throw error;

  for (const f of followers || []) {
    const followerId = (f as any).follower_profile_id as string | undefined;
    const status = (f as any).status as string | undefined;

    // If you add private accounts later, only accepted followers get targets.
    if (status && status !== "accepted") continue;

    if (followerId && followerId !== actorProfileId) {
      targets.push({
        feed_item_id: feedItemId,
        viewer_profile_id: followerId,
        reason: "follow",
      });
    }
  }

  await insertTargets(targets);
}

async function insertTargets(
  targets: Array<{ feed_item_id: string; viewer_profile_id: string; reason: string }>
) {
  if (!targets.length) return;

  // De-dup just in case
  const seen = new Set<string>();
  const unique = targets.filter((t) => {
    const key = `${t.feed_item_id}:${t.viewer_profile_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const { error } = await supabaseAdmin.from("feed_item_targets").insert(unique);
  if (error) {
    // If unique constraint exists, conflicts might happen in retries.
    // If you add an upsert constraint later, switch to upsert.
    throw error;
  }
}
