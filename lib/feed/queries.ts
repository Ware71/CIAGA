import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  FeedCursor,
  FeedItemRow,
  FeedItemVM,
  FeedPageResponse,
} from "@/lib/feed/types";
import { isSupportedFeedType, parseFeedPayload } from "@/lib/feed/schemas";

/**
 * Feed read path:
 * - uses feed_item_targets fan-out table for “based on who you follow”
 * - cursor pagination by (occurred_at desc, id desc)
 * - batch-loads actor profiles + reactions/comments aggregates
 */

function makeCursorOrFilter(cursor: FeedCursor) {
  // For DESC ordering:
  // occurred_at < cursor.occurred_at OR (occurred_at = cursor.occurred_at AND id < cursor.id)
  // PostgREST `or()` syntax:
  // or("occurred_at.lt.<ts>,and(occurred_at.eq.<ts>,id.lt.<id>)")
  const ts = cursor.occurred_at;
  const id = cursor.id;
  return `occurred_at.lt.${ts},and(occurred_at.eq.${ts},id.lt.${id})`;
}

export async function getFeedPage(params: {
  viewerProfileId: string;
  cursor?: FeedCursor | null;
  limit: number;
}): Promise<FeedPageResponse> {
  const { viewerProfileId, cursor, limit } = params;

  const pageSize = Math.max(1, Math.min(limit || 20, 50));
  const fetchSize = pageSize + 1; // fetch one extra to compute next_cursor

  let q = supabaseAdmin
    .from("feed_items")
    // inner join through targets so viewer only sees targeted items
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
      group_key,
      feed_item_targets!inner(viewer_profile_id)
    `
    )
    .eq("feed_item_targets.viewer_profile_id", viewerProfileId)
    .neq("visibility", "removed")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(fetchSize);

  if (cursor?.occurred_at && cursor?.id) {
    q = q.or(makeCursorOrFilter(cursor));
  }

  const { data: rows, error } = await q;
  if (error) throw error;

  const rawItems = (rows || []) as unknown as FeedItemRow[];

  // Normalize + validate types/payloads
  const normalized: Array<FeedItemVM> = [];
  for (const r of rawItems) {
    if (!r?.id || typeof (r as any).type !== "string") continue;
    const typeStr = (r as any).type as string;
    if (!isSupportedFeedType(typeStr)) continue;

    const payload = parseFeedPayload(typeStr, (r as any).payload);
    if (!payload) continue;

    normalized.push({
      id: r.id,
      type: typeStr,
      occurred_at: r.occurred_at,
      created_at: r.created_at,
      actor: null, // filled below
      audience: (r as any).audience,
      visibility: (r as any).visibility,
      payload: payload as any,
      aggregates: {
        reaction_counts: {},
        comment_count: 0,
        my_reaction: null,
      },
    });
  }

  // Compute next_cursor
  let next_cursor: FeedCursor | null = null;
  let pageItems = normalized;

  if (normalized.length > pageSize) {
    pageItems = normalized.slice(0, pageSize);
    const last = pageItems[pageItems.length - 1];
    next_cursor = { occurred_at: last.occurred_at, id: last.id };
  }

  const itemIds = pageItems.map((x) => x.id);

  // --- Actor profile embeds (batch) ---
  const actorIds = Array.from(
    new Set(pageItems.map((x) => x.actor?.profile_id).filter(Boolean) as string[])
  );

  // actor_profile_id isn't in VM actor yet; derive from original rows for the page
  const actorIdsFromRows = Array.from(
    new Set(
      rawItems
        .filter((r) => itemIds.includes(r.id))
        .map((r: any) => r.actor_profile_id)
        .filter((x: any) => typeof x === "string" && x.length > 0)
    )
  ) as string[];

  if (actorIdsFromRows.length) {
    const { data: profiles, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", actorIdsFromRows);

    if (pErr) throw pErr;

    const profileMap = new Map<
      string,
      { profile_id: string; display_name: string; avatar_url?: string | null }
    >();

    for (const p of profiles || []) {
      profileMap.set(p.id, {
        profile_id: p.id,
        display_name: (p as any).name ?? "Player",
        avatar_url: (p as any).avatar_url ?? null,
      });
    }

    // attach actors to VMs
    const actorByItemId = new Map<string, string | null>();
    for (const r of rawItems) {
      if (!itemIds.includes(r.id)) continue;
      actorByItemId.set(r.id, (r as any).actor_profile_id ?? null);
    }

    for (const vm of pageItems) {
      const actorId = actorByItemId.get(vm.id) ?? null;
      vm.actor = actorId ? profileMap.get(actorId) ?? null : null;
    }
  }

  // --- Aggregates: reactions (counts + my_reaction) ---
  if (itemIds.length) {
    const { data: reactions, error: rErr } = await supabaseAdmin
      .from("feed_reactions")
      .select("feed_item_id, profile_id, emoji")
      .in("feed_item_id", itemIds);

    if (rErr) throw rErr;

    const countsByItem = new Map<string, Record<string, number>>();
    const myReactionByItem = new Map<string, string>();

    for (const r of reactions || []) {
      const feed_item_id = (r as any).feed_item_id as string;
      const emoji = (r as any).emoji as string;
      const profile_id = (r as any).profile_id as string;

      if (!feed_item_id || !emoji) continue;

      const current = countsByItem.get(feed_item_id) ?? {};
      current[emoji] = (current[emoji] ?? 0) + 1;
      countsByItem.set(feed_item_id, current);

      if (profile_id === viewerProfileId) {
        // one-reaction-per-user model: last one wins
        myReactionByItem.set(feed_item_id, emoji);
      }
    }

    for (const vm of pageItems) {
      vm.aggregates.reaction_counts = countsByItem.get(vm.id) ?? {};
      vm.aggregates.my_reaction = myReactionByItem.get(vm.id) ?? null;
    }
  }

  // --- Aggregates: comment count (simple MVP approach) ---
  if (itemIds.length) {
    const { data: comments, error: cErr } = await supabaseAdmin
      .from("feed_comments")
      .select("feed_item_id")
      .in("feed_item_id", itemIds)
      .neq("visibility", "removed");

    if (cErr) throw cErr;

    const counts = new Map<string, number>();
    for (const c of comments || []) {
      const fid = (c as any).feed_item_id as string;
      if (!fid) continue;
      counts.set(fid, (counts.get(fid) ?? 0) + 1);
    }

    for (const vm of pageItems) {
      vm.aggregates.comment_count = counts.get(vm.id) ?? 0;
    }
  }

  return { items: pageItems, next_cursor };
}

/**
 * Live matches pinned strip.
 * This is intentionally a thin placeholder for now.
 *
 * In your DB layer we’ll implement a view/function like:
 * v_live_matches_for_profile(profile_id)
 *
 * For MVP: return [] if not implemented yet.
 */
export async function getLiveMatches(params: { viewerProfileId: string }) {
  const { viewerProfileId } = params;

  // 1) Get followed profiles (viewer -> following)
  const { data: followingRows, error: fErr } = await supabaseAdmin
    .from("follows")
    .select("following_id")
    .eq("follower_id", viewerProfileId);

  if (fErr) throw fErr;

  const followingIds = (followingRows ?? [])
    .map((r: any) => r.following_id as string)
    .filter(Boolean);

  const candidateProfileIds = Array.from(new Set([viewerProfileId, ...followingIds]));

  // 2) Find live rounds that involve viewer or followed profiles (via round_participants)
  const { data: participantRows, error: pErr } = await supabaseAdmin
    .from("round_participants")
    .select("round_id, profile_id")
    .in("profile_id", candidateProfileIds);

  if (pErr) throw pErr;

  const roundIds = Array.from(
    new Set((participantRows ?? []).map((r: any) => r.round_id as string).filter(Boolean))
  );

  if (!roundIds.length) return [];

  // 3) Filter to rounds.status = 'live'
  const { data: rounds, error: rErr } = await supabaseAdmin
    .from("rounds")
    .select("id, status, started_at")
    .in("id", roundIds)
    .eq("status", "live")
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(20);

  if (rErr) throw rErr;

  const liveRoundIds = (rounds ?? []).map((r: any) => r.id).filter(Boolean);
  if (!liveRoundIds.length) return [];

  // 4) Course name from round_course_snapshots (latest per round)
  const { data: snaps, error: sErr } = await supabaseAdmin
    .from("round_course_snapshots")
    .select("round_id, course_name, created_at")
    .in("round_id", liveRoundIds)
    .order("created_at", { ascending: false });

  if (sErr) throw sErr;

  const courseByRound = new Map<string, string>();
  for (const s of snaps ?? []) {
    const rid = (s as any).round_id as string;
    const cn = (s as any).course_name as string;
    if (rid && cn && !courseByRound.has(rid)) courseByRound.set(rid, cn);
  }

  // 5) Participants for each live round (for a nice title/summary)
  const { data: liveParticipants, error: lpErr } = await supabaseAdmin
    .from("round_participants")
    .select("round_id, profile_id")
    .in("round_id", liveRoundIds);

  if (lpErr) throw lpErr;

  const participantIds = Array.from(
    new Set((liveParticipants ?? []).map((r: any) => r.profile_id as string).filter(Boolean))
  );

  const { data: profiles, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("id, name, avatar_url")
    .in("id", participantIds);

  if (profErr) throw profErr;

  const profileMap = new Map<string, { id: string; name: string; avatar_url: string | null }>();
  for (const p of profiles ?? []) {
    profileMap.set(p.id, {
      id: p.id,
      name: (p as any).name ?? "Player",
      avatar_url: (p as any).avatar_url ?? null,
    });
  }

  const participantsByRound = new Map<string, Array<{ id: string; name: string; avatar_url: string | null }>>();
  for (const rp of liveParticipants ?? []) {
    const rid = (rp as any).round_id as string;
    const pid = (rp as any).profile_id as string;
    if (!rid || !pid) continue;

    const p = profileMap.get(pid) ?? { id: pid, name: "Player", avatar_url: null };
    const arr = participantsByRound.get(rid) ?? [];
    arr.push(p);
    participantsByRound.set(rid, arr);
  }

  // 6) Shape payload for the UI strip
  return (rounds ?? []).map((r: any) => {
    const rid = r.id as string;
    const course_name = courseByRound.get(rid) ?? "Course";
    const participants = participantsByRound.get(rid) ?? [];

    const names = participants.map((p) => p.name).slice(0, 3);
    const title =
      participants.length <= 1
        ? `${names[0] ?? "Player"} is playing`
        : `${names.join(" · ")}${participants.length > 3 ? "…" : ""}`;

    return {
      round_id: rid,
      course_name,
      started_at: r.started_at ?? null,
      title,
      summary: `Live round at ${course_name}`,
      participants,
    };
  });
}
