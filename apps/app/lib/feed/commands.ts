import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { FeedAudience, FeedItemType, FeedMedia } from "@/lib/feed/types";
import { parseFeedPayload } from "@/lib/feed/schemas";
import { fanOutFeedItemToFollowers } from "@/lib/feed/fanout";
import { createNotification } from "@/lib/notifications/notify";
import { notifyPostReaction, notifyThreadActivity } from "@/lib/notifications/socialActivity";

/** Look up a profile's display name (for "X tagged you" copy). */
async function getProfileName(profileId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("name")
    .eq("id", profileId)
    .maybeSingle();
  return (data as any)?.name ?? "Someone";
}

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

export async function assertViewerCanReadFeedItem(feedItemId: string, viewerProfileId: string) {
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
    media?: FeedMedia[] | null;
    /** Derived from `media` by parseFeedPayload; callers need not send it. */
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

  // Notify tagged users (excluding the author). Best-effort.
  const tagged = Array.isArray(parsed.tagged_profiles) ? parsed.tagged_profiles : [];
  const mentionIds = Array.from(
    new Set(tagged.map((t) => t.profile_id).filter((id) => id && id !== actorProfileId))
  );
  if (mentionIds.length > 0) {
    const actorName = await getProfileName(actorProfileId);
    const excerpt = typeof parsed.text === "string" ? parsed.text : "";
    await Promise.allSettled(
      mentionIds.map(async (recipientProfileId) => {
        // Same visibility gate createComment applies to comment mentions. Without
        // it, tagging a non-follower in a followers-audience post notified them
        // about an item they cannot open.
        try {
          await assertViewerCanReadFeedItem(data.id, recipientProfileId);
        } catch {
          return;
        }
        await createNotification({
          recipientProfileId,
          type: "mention_post",
          payload: {
            feed_item_id: data.id,
            actor_profile_id: actorProfileId,
            actor_name: actorName,
            excerpt,
          },
        });
      })
    );
  }

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

    // Update to new emoji. Deliberately NOT notified: the author was already
    // told when this person first reacted, and swapping 👍 for 🎉 is not news.
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

  await notifyPostReaction({ feedItemId, actorProfileId: profileId, emoji });

  return { status: "set", emoji };
}

export async function createComment(params: {
  feedItemId: string;
  profileId: string;
  body: string;
  parentCommentId?: string | null;
  mentionedProfileIds?: string[] | null;
}): Promise<{ comment_id: string }> {
  const { feedItemId, profileId, body, parentCommentId, mentionedProfileIds } = params;

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

  // Persist the full mention set on the comment so it can be colorized on read.
  // Best-effort: tolerate environments where the column hasn't been migrated yet.
  const allMentionIds = Array.from(new Set((mentionedProfileIds ?? []).filter(Boolean)));
  if (allMentionIds.length > 0) {
    try {
      await supabaseAdmin
        .from("feed_comments")
        .update({ mentioned_profile_ids: allMentionIds })
        .eq("id", data.id);
    } catch {
      // column not present yet — coloring degrades gracefully
    }
  }

  // Notify mentioned users (excluding the commenter). Best-effort. Only notify
  // mentions that can actually see the feed item (RLS via feed_item_targets).
  const mentionIds = Array.from(
    new Set((mentionedProfileIds ?? []).filter((id) => id && id !== profileId))
  );
  // Top rung of the precedence ladder — a mention outranks a reply, which
  // outranks thread activity, so one comment is never three notifications.
  // notifiedIds accumulates who has been claimed by a higher rung.
  const notifiedIds: string[] = [];
  if (mentionIds.length > 0) {
    const actorName = await getProfileName(profileId);
    await Promise.allSettled(
      mentionIds.map(async (recipientProfileId) => {
        try {
          await assertViewerCanReadFeedItem(feedItemId, recipientProfileId);
        } catch {
          return; // mentioned user can't see this item — skip
        }
        notifiedIds.push(recipientProfileId);
        await createNotification({
          recipientProfileId,
          type: "mention_comment",
          payload: {
            feed_item_id: feedItemId,
            comment_id: data.id,
            actor_profile_id: profileId,
            actor_name: actorName,
            excerpt: trimmed,
          },
        });
      })
    );
  }

  // Lower rungs: the parent commenter, then the post author + prior commenters.
  await notifyThreadActivity({
    feedItemId,
    commentId: data.id,
    actorProfileId: profileId,
    excerpt: trimmed,
    parentCommentId: parentCommentId ?? null,
    alreadyNotified: notifiedIds,
  });

  return { comment_id: data.id };
}

export const REPORT_REASON_CODES = [
  "spam",
  "harassment",
  "hate",
  "violence",
  "sexual",
  "self_harm",
  "illegal",
  "impersonation",
  "copyright",
  "other",
] as const;

export type ReportReasonCode = (typeof REPORT_REASON_CODES)[number];

export async function reportContent(params: {
  reporterProfileId: string;
  targetType: "feed_item" | "comment";
  targetId: string;
  reasonCode?: string | null;
  reason?: string | null;
}): Promise<{ report_id: string }> {
  const { reporterProfileId, targetType, targetId } = params;

  if (!reporterProfileId || !targetId) throw new Error("Missing ids");
  if (targetType !== "feed_item" && targetType !== "comment") throw new Error("Invalid target type");

  const reasonCode = REPORT_REASON_CODES.includes(params.reasonCode as ReportReasonCode)
    ? (params.reasonCode as ReportReasonCode)
    : null;

  // feed_reports.reason is NOT NULL and a picked category is a complete report
  // on its own, so fall back to the code when the reporter didn't add a note.
  // Requiring free text here would mean asking someone to type out the abuse
  // they're reporting before we'd accept it.
  const note = (params.reason ?? "").trim();
  const r = note || reasonCode;

  if (!r) throw new Error("Reason required");
  if (r.length > 500) throw new Error("Reason too long");

  // If reporting a feed_item, ensure reporter can see it
  if (targetType === "feed_item") {
    await assertViewerCanReadFeedItem(targetId, reporterProfileId);
  }

  const { data, error } = await supabaseAdmin
    .from("feed_reports")
    .upsert(
      {
        reporter_profile_id: reporterProfileId,
        target_type: targetType,
        target_id: targetId,
        reason: r,
        reason_code: reasonCode,
      },
      { onConflict: "reporter_profile_id,target_type,target_id" },
    )
    .select("id")
    .single();

  if (error) throw error;
  if (!data?.id) throw new Error("Failed to create report");

  return { report_id: data.id };
}

/**
 * Hide, remove or restore a feed item or comment.
 *
 * `visibility` has been read by every feed query since the beginning and
 * written by nothing. This is the other half.
 *
 *   hide     drops out of the feed, still reachable by direct link
 *   remove   gone from both
 *   restore  back to visible
 *
 * Authorization is the caller's job — the admin routes check profiles.is_admin,
 * and the self-delete route checks authorship.
 */
export async function setContentVisibility(params: {
  actorProfileId: string;
  targetType: "feed_item" | "comment";
  targetId: string;
  action: "hide" | "remove" | "restore";
  reason?: string | null;
  reportId?: string | null;
}): Promise<{ ok: true }> {
  const { actorProfileId, targetType, targetId, action, reason, reportId } = params;

  const visibility =
    action === "restore" ? "visible" : action === "hide" ? "hidden" : "removed";

  const table = targetType === "feed_item" ? "feed_items" : "feed_comments";

  const { error: updErr } = await supabaseAdmin
    .from(table)
    .update({ visibility })
    .eq("id", targetId);

  if (updErr) throw updErr;

  const { error: logErr } = await supabaseAdmin.from("feed_moderation_actions").insert({
    actor_profile_id: actorProfileId,
    target_type: targetType,
    target_id: targetId,
    action,
    reason: reason ?? null,
    report_id: reportId ?? null,
  });

  if (logErr) throw logErr;

  // Acting on the content closes the reports about it — otherwise the queue
  // keeps showing work that's already done.
  if (action !== "restore") {
    await supabaseAdmin
      .from("feed_reports")
      .update({
        status: "actioned",
        resolved_by: actorProfileId,
        resolved_at: new Date().toISOString(),
      })
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .in("status", ["open", "reviewing"]);
  }

  return { ok: true };
}
