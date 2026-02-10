import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { FeedAudience } from "@/lib/feed/types";

/**
 * Fan-out on write (viewer-specific targets).
 *
 * v1 rules (per CIAGA Social Feed spec):
 * - Targets are computed from SUBJECTS, not solely from actor/creator.
 * - For round_played, subjects are the players.
 * - Targets include:
 *   - all subjects
 *   - followers of any subject
 *   - optionally the actor (if not already a subject)
 *
 * Note: feed_item_targets is used for MAIN FEED and notifications.
 */

export async function fanOutFeedItemToSubjectsAndFollowers(params: {
  feedItemId: string;
  actorProfileId: string;
  audience: FeedAudience;
  subjectProfileIds: string[];
}): Promise<void> {
  const { feedItemId, actorProfileId, audience, subjectProfileIds } = params;

  if (!feedItemId || !actorProfileId) throw new Error("Missing ids");

  const subjects = Array.from(new Set((subjectProfileIds ?? []).filter(Boolean)));

  // Always include all subjects; include actor only if not already a subject.
  const viewerIds = new Set<string>(subjects);
  viewerIds.add(actorProfileId);

  // Private = only subjects + actor.
  if (audience === "private") {
    await insertTargets(
      Array.from(viewerIds).map((vid) => ({
        feed_item_id: feedItemId,
        viewer_profile_id: vid,
        reason: vid === actorProfileId ? "self" : "subject",
      }))
    );
    return;
  }

  // MVP only: followers + private.
  if (audience !== "followers") {
    await insertTargets(
      Array.from(viewerIds).map((vid) => ({
        feed_item_id: feedItemId,
        viewer_profile_id: vid,
        reason: vid === actorProfileId ? "self" : "subject",
      }))
    );
    return;
  }

  // Followers of ANY subject should see the card.
  // follows(follower_id -> following_id)
  if (subjects.length) {
    const { data: followerRows, error } = await supabaseAdmin
      .from("follows")
      .select("follower_id")
      .in("following_id", subjects);

    if (error) throw error;

    for (const r of followerRows ?? []) {
      const fid = (r as any).follower_id as string | undefined;
      if (fid) viewerIds.add(fid);
    }
  }

  const targets = Array.from(viewerIds).map((vid) => ({
    feed_item_id: feedItemId,
    viewer_profile_id: vid,
    reason:
      vid === actorProfileId
        ? "self"
        : subjects.includes(vid)
          ? "subject"
          : "follow",
  }));

  await insertTargets(targets);
}

/**
 * Backwards-compatible wrapper for older emitters:
 * keeps existing call sites working while we migrate item types.
 */
export async function fanOutFeedItemToFollowers(params: {
  feedItemId: string;
  actorProfileId: string;
  audience: FeedAudience;
}): Promise<void> {
  const { feedItemId, actorProfileId, audience } = params;
  return fanOutFeedItemToSubjectsAndFollowers({
    feedItemId,
    actorProfileId,
    audience,
    subjectProfileIds: [actorProfileId],
  });
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

  // Upsert to make retries + idempotent re-runs safe.
  const { error } = await supabaseAdmin
    .from("feed_item_targets")
    .upsert(unique, { onConflict: "feed_item_id,viewer_profile_id" });

  if (error) throw error;
}
