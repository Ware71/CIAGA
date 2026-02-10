import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { FeedAudience, FeedItemType } from "@/lib/feed/types";
import { parseFeedPayload } from "@/lib/feed/schemas";
import { fanOutFeedItemToFollowers } from "@/lib/feed/fanout";

/**
 * Writes for Social Feed:
 * - Create manual post (user_post)
 * - Set/toggle reaction (one-reaction-per-user model)
 * - Create comment
 * - Report content
 *
 * IMPORTANT:
 * We use supabaseAdmin for writes, which bypasses RLS.
 * Therefore we MUST enforce access rules in code (via feed_item_targets).
 */

async function assertViewerCanReadFeedItem(feedItemId: string, viewerProfileId: string) {
  if (!feedItemId || !viewerProfileId) throw new Error("Missing ids");

  const { data, error } = await supabaseAdmin
    .from("feed_item_targets")
    .select("id")
    .eq("feed_item_id", feedItemId)
    .eq("viewer_profile_id", viewerProfileId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error("Forbidden");
}

export async function createUserPost(params: {
  actorProfileId: string;
  audience: FeedAudience;
  payload: {
    text?: string | null;
    image_urls?: string[] | null;
    tagged_profiles?: Array<{ profile_id: string; name: string }> | null;
    tagged_round_id?: string | null;
    tagged_course_id?: string | null;
    tagged_course_name?: string | null;
    created_from?: "web" | "mobile" | "system";
  };
}): Promise<{ feed_item_id: string }> {
  const { actorProfileId, audience, payload } = params;

  const parsed = parseFeedPayload("user_post", payload);
  if (!parsed) throw new Error("Invalid post payload");

  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("feed_items")
    .insert({
      type: "user_post" satisfies FeedItemType,
      actor_profile_id: actorProfileId,
      audience,
      visibility: "visible",
      occurred_at: now,
      payload: parsed,
    })
    .select("id")
    .single();

  if (error) throw error;
  if (!data?.id) throw new Error("Failed to create post");

  // Fan-out targets for followers (and include self)
  await fanOutFeedItemToFollowers({
    feedItemId: data.id,
    actorProfileId,
    audience,
  });

  return { feed_item_id: data.id };
}

/**
 * One-reaction-per-user model:
 * - Upsert on (feed_item_id, profile_id)
 * - If emoji matches existing, remove (toggle off)
 * - Otherwise set to new emoji
 */
export async function setReaction(params: {
  feedItemId: string;
  profileId: string;
  emoji: string;
}): Promise<{ status: "set" | "removed"; emoji: string | null }> {
  const { feedItemId, profileId, emoji } = params;

  if (!feedItemId || !profileId) throw new Error("Missing ids");
  if (typeof emoji !== "string" || emoji.trim().length === 0) throw new Error("Invalid emoji");
  if (emoji.length > 16) throw new Error("Emoji too long");

  // IMPORTANT: service role bypasses RLS, so we enforce access here.
  await assertViewerCanReadFeedItem(feedItemId, profileId);

  // Check existing
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("feed_reactions")
    .select("id, emoji")
    .eq("feed_item_id", feedItemId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (exErr) throw exErr;

  if (existing?.id) {
    if (existing.emoji === emoji) {
      // Toggle off
      const { error: delErr } = await supabaseAdmin.from("feed_reactions").delete().eq("id", existing.id);
      if (delErr) throw delErr;
      return { status: "removed", emoji: null };
    }

    // Update to new emoji
    const { error: upErr } = await supabaseAdmin.from("feed_reactions").update({ emoji }).eq("id", existing.id);
    if (upErr) throw upErr;
    return { status: "set", emoji };
  }

  // Insert new
  const { error: insErr } = await supabaseAdmin.from("feed_reactions").insert({
    feed_item_id: feedItemId,
    profile_id: profileId,
    emoji,
  });

  if (insErr) throw insErr;
  return { status: "set", emoji };
}

export async function createComment(params: {
  feedItemId: string;
  profileId: string;
  body: string;
  parentCommentId?: string | null;
}): Promise<{ comment_id: string }> {
  const { feedItemId, profileId, body, parentCommentId } = params;

  if (!feedItemId || !profileId) throw new Error("Missing ids");
  if (typeof body !== "string") throw new Error("Invalid body");
  const trimmed = body.trim();
  if (trimmed.length < 1) throw new Error("Comment cannot be empty");
  if (trimmed.length > 2000) throw new Error("Comment too long");

  // IMPORTANT: service role bypasses RLS, so we enforce access here.
  await assertViewerCanReadFeedItem(feedItemId, profileId);

  const { data, error } = await supabaseAdmin
    .from("feed_comments")
    .insert({
      feed_item_id: feedItemId,
      profile_id: profileId,
      parent_comment_id: parentCommentId ?? null,
      body: trimmed,
      visibility: "visible",
    })
    .select("id")
    .single();

  if (error) throw error;
  if (!data?.id) throw new Error("Failed to create comment");

  return { comment_id: data.id };
}

export async function reportContent(params: {
  reporterProfileId: string;
  targetType: "feed_item" | "comment";
  targetId: string;
  reason: string;
}): Promise<{ report_id: string }> {
  const { reporterProfileId, targetType, targetId, reason } = params;

  if (!reporterProfileId || !targetId) throw new Error("Missing ids");
  if (targetType !== "feed_item" && targetType !== "comment") throw new Error("Invalid target type");

  const r = (reason ?? "").trim();
  if (r.length < 1) throw new Error("Reason required");
  if (r.length > 500) throw new Error("Reason too long");

  // Optional hardening:
  // - If reporting a feed_item, ensure reporter can see it
  if (targetType === "feed_item") {
    await assertViewerCanReadFeedItem(targetId, reporterProfileId);
  }

  const { data, error } = await supabaseAdmin
    .from("feed_reports")
    .insert({
      reporter_profile_id: reporterProfileId,
      target_type: targetType,
      target_id: targetId,
      reason: r,
    })
    .select("id")
    .single();

  if (error) throw error;
  if (!data?.id) throw new Error("Failed to create report");

  return { report_id: data.id };
}
