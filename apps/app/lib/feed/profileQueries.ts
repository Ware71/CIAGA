import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseFeedPayload } from "@/lib/feed/schemas";
import type { FeedItemVM, FeedPageResponse } from "@/lib/feed/types";
import {
  normalizeActor,
  buildReactionSummary,
  getReactionCounts,
  getCommentCounts,
  getMyReactions,
  getTopComments,
} from "@/lib/feed/queries";

export type ProfileFeedSort = "newest" | "oldest" | "most_interacted";

/**
 * Fetch feed items where a given profile is a SUBJECT.
 * This is different from the main feed which uses feed_item_targets for viewer authorization.
 * Here we join feed_item_subjects to find items "about" the profile.
 */
export async function getProfileFeedPage(params: {
  subjectProfileId: string;
  viewerProfileId: string;
  limit: number;
  cursor?: { occurred_at: string; id: string } | null;
  sort?: ProfileFeedSort;
}): Promise<FeedPageResponse> {
  const { subjectProfileId, viewerProfileId, limit, cursor, sort = "newest" } = params;

  const ascending = sort === "oldest";

  // For most_interacted, fetch a larger window and re-sort after enrichment
  const fetchLimit = sort === "most_interacted" ? Math.max(limit * 3, 60) : limit;

  let query = supabaseAdmin
    .from("feed_items")
    .select(
      `
      id,
      type,
      actor_profile_id,
      audience,
      visibility,
      occurred_at,
      created_at,
      payload,
      feed_item_subjects!inner(subject_profile_id)
    `
    )
    .eq("feed_item_subjects.subject_profile_id", subjectProfileId)
    .neq("visibility", "removed")
    .order("occurred_at", { ascending })
    .order("id", { ascending })
    .limit(fetchLimit + 1);

  // Cursor pagination
  if (cursor?.occurred_at && cursor?.id) {
    if (ascending) {
      query = query.or(
        `occurred_at.gt.${cursor.occurred_at},and(occurred_at.eq.${cursor.occurred_at},id.gt.${cursor.id})`
      );
    } else {
      query = query.or(
        `occurred_at.lt.${cursor.occurred_at},and(occurred_at.eq.${cursor.occurred_at},id.lt.${cursor.id})`
      );
    }
  }

  const { data, error } = await query;
  if (error) throw error;

  const rawItems = (data ?? []) as any[];

  let trimmed: any[];
  let hasMore: boolean;

  if (sort === "most_interacted") {
    // We'll sort after enrichment, so take all for now
    trimmed = rawItems.slice(0, fetchLimit);
    hasMore = rawItems.length > fetchLimit;
  } else {
    trimmed = rawItems.slice(0, limit);
    hasMore = rawItems.length > limit;
  }

  // Actor profiles
  const actorIds = Array.from(new Set(trimmed.map((i: any) => i.actor_profile_id).filter(Boolean)));

  const { data: actors, error: aErr } = await supabaseAdmin
    .from("profiles")
    .select("id, name, avatar_url")
    .in("id", actorIds.length ? actorIds : [viewerProfileId]);
  if (aErr) throw aErr;

  const actorMap = new Map<string, any>();
  for (const a of actors ?? []) actorMap.set(a.id, a);

  // Subjects
  const feedItemIdsForSubjects = trimmed.map((i: any) => i.id).filter(Boolean);
  const subjectMap = new Map<string, any[]>();

  if (feedItemIdsForSubjects.length) {
    const { data: subjRows, error: sErr } = await supabaseAdmin
      .from("feed_item_subjects")
      .select(
        `
        feed_item_id,
        role,
        subject_profile_id,
        profiles:subject_profile_id ( id, name, avatar_url )
      `
      )
      .in("feed_item_id", feedItemIdsForSubjects);
    if (sErr) throw sErr;

    for (const row of subjRows ?? []) {
      const fid = (row as any).feed_item_id as string | undefined;
      const prof = (row as any).profiles;
      if (!fid || !prof?.id) continue;

      const entry = {
        profile_id: prof.id,
        display_name: prof.name ?? "Player",
        avatar_url: prof.avatar_url ?? null,
        role: (row as any).role ?? null,
      };

      const cur = subjectMap.get(fid) ?? [];
      cur.push(entry);
      subjectMap.set(fid, cur);
    }

    for (const [, arr] of subjectMap.entries()) {
      arr.sort((a, b) => {
        const ap = a.role === "primary" ? 0 : 1;
        const bp = b.role === "primary" ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return String(a.display_name).localeCompare(String(b.display_name));
      });
    }
  }

  // Aggregates
  const feedItemIds = trimmed.map((i: any) => i.id);

  const [reactionAgg, commentAgg, myReactions] = await Promise.all([
    getReactionCounts(feedItemIds),
    getCommentCounts(feedItemIds),
    getMyReactions(feedItemIds, viewerProfileId),
  ]);

  const feedItemIdsWithComments = feedItemIds.filter((id) => (commentAgg.get(id) ?? 0) > 0);
  const topComments = await getTopComments(feedItemIdsWithComments);

  let items: FeedItemVM[] = trimmed.map((i: any) => {
    const actor = i.actor_profile_id ? normalizeActor(actorMap.get(i.actor_profile_id)) : null;
    const reaction_counts = reactionAgg.get(i.id) ?? {};
    const reaction_summary = buildReactionSummary(reaction_counts, 3);

    return {
      id: i.id,
      type: i.type,
      occurred_at: i.occurred_at,
      created_at: i.created_at,
      actor,
      subject: subjectMap.get(i.id)?.[0]
        ? {
            profile_id: subjectMap.get(i.id)![0].profile_id,
            display_name: subjectMap.get(i.id)![0].display_name,
            avatar_url: subjectMap.get(i.id)![0].avatar_url,
          }
        : actor,
      subjects: (subjectMap.get(i.id) ?? []).map((s: any) => ({
        profile_id: s.profile_id,
        display_name: s.display_name,
        avatar_url: s.avatar_url,
      })),
      audience: i.audience,
      visibility: i.visibility,
      payload: parseFeedPayload(i.type, i.payload) ?? (i.payload as any),
      aggregates: {
        reaction_counts,
        reaction_summary,
        comment_count: commentAgg.get(i.id) ?? 0,
        my_reaction: myReactions.get(i.id) ?? null,
        top_comment: topComments.get(i.id) ?? null,
      },
    } as FeedItemVM;
  });

  // For most_interacted sort, re-sort by interaction score and trim to requested limit
  if (sort === "most_interacted") {
    items.sort((a, b) => {
      const scoreA = interactionScore(a);
      const scoreB = interactionScore(b);
      if (scoreB !== scoreA) return scoreB - scoreA;
      // Tie-break by newest
      return (b.occurred_at ?? "").localeCompare(a.occurred_at ?? "");
    });
    items = items.slice(0, limit);
    // hasMore is approximate for most_interacted — still valid since we fetched a larger window
    hasMore = hasMore || items.length >= limit;
  }

  const next_cursor =
    hasMore && items.length
      ? sort === "most_interacted"
        ? // For most_interacted, cursor is based on the last item's occurred_at for the next fetch window
          {
            occurred_at: trimmed[trimmed.length - 1].occurred_at ?? trimmed[trimmed.length - 1].created_at,
            id: trimmed[trimmed.length - 1].id,
          }
        : {
            occurred_at: items[items.length - 1].occurred_at ?? items[items.length - 1].created_at,
            id: items[items.length - 1].id,
          }
      : null;

  return { items, next_cursor };
}

function interactionScore(item: FeedItemVM): number {
  const reactionTotal = Object.values(item.aggregates.reaction_counts ?? {}).reduce(
    (sum, n) => sum + (n ?? 0),
    0
  );
  return reactionTotal + (item.aggregates.comment_count ?? 0);
}
