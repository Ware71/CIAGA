import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseFeedPayload } from "@/lib/feed/schemas";
import type { FeedItemVM, FeedPageResponse } from "@/lib/feed/types";
import { strokesReceivedOnHole, netDoubleBogeyGross } from "@/lib/rounds/handicapUtils";
import { computeFormatSummaryFromData } from "@/lib/feed/helpers/formatSummary";
import type { Participant, Hole, Score, HoleState, Team, SideGame } from "@/lib/rounds/hooks/useRoundDetail";

/**
 * NOTE:
 * - This file intentionally uses supabaseAdmin (service role) so we can enforce visibility rules in code.
 * - Viewer-specific distribution for the MAIN FEED is handled via feed_item_targets.
 */

export function normalizeActor(profile: any) {
  if (!profile) return null;
  return {
    profile_id: profile.id,
    display_name: profile.name ?? "Player",
    avatar_url: profile.avatar_url ?? null,
  };
}

export function buildReactionSummary(reactionCounts: Record<string, number>, topN = 3) {
  const entries = Object.entries(reactionCounts ?? {});
  entries.sort((a, b) => {
    const diff = (b[1] ?? 0) - (a[1] ?? 0);
    if (diff !== 0) return diff;
    return String(a[0]).localeCompare(String(b[0]));
  });
  return entries.slice(0, topN).map(([emoji, count]) => ({ emoji, count }));
}

export async function getFeedPage(params: {
  viewerProfileId: string;
  limit: number;
  cursor?: { occurred_at: string; id: string } | null;
}): Promise<FeedPageResponse> {
  const { viewerProfileId, limit, cursor } = params;

  // IMPORTANT:
  // Query FROM feed_items and INNER JOIN feed_item_targets,
  // so pagination/filtering applies to base columns (occurred_at/id)
  // and PostgREST does not 400 on embedded column filters.
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
      actor:actor_profile_id ( id, name, avatar_url ),
      feed_item_targets!inner(viewer_profile_id)
    `
    )
    .eq("feed_item_targets.viewer_profile_id", viewerProfileId)
    // 'visible' only, not just "not removed": a moderator hiding an item should
    // take it out of the feed while leaving it resolvable by direct link (see
    // getFeedItemById below, which keeps the looser filter on purpose).
    .eq("visibility", "visible")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  // Cursor (occurred_at desc, id desc), exclusive
  if (cursor?.occurred_at && cursor?.id) {
    query = query.or(
      `occurred_at.lt.${cursor.occurred_at},and(occurred_at.eq.${cursor.occurred_at},id.lt.${cursor.id})`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  // No need to sort in JS now — DB ordering is correct/stable.
  const rawItems = (data ?? []) as any[];

  const trimmed = rawItems.slice(0, limit);
  const hasMore = rawItems.length > limit;

  const items = await enrichFeedItems(trimmed, viewerProfileId);

  const next_cursor =
    hasMore && trimmed.length
      ? {
          occurred_at: trimmed[trimmed.length - 1].occurred_at ?? trimmed[trimmed.length - 1].created_at,
          id: trimmed[trimmed.length - 1].id,
        }
      : null;

  return { items, next_cursor };
}

/**
 * Enrich raw feed_items rows into FeedItemVMs (actor, subjects, reactions,
 * comments, top comment). Shared by getFeedPage and getFeedItemById.
 */
/**
 * Fetch and order the subjects for a page of feed items.
 *
 * Ordering is deterministic — role 'primary' first, then display name — so the
 * same round renders its players in the same order on every load.
 */
async function getSubjects(feedItemIds: string[]): Promise<Map<string, any[]>> {
  const subjectMap = new Map<string, any[]>();
  if (!feedItemIds.length) return subjectMap;

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
    .in("feed_item_id", feedItemIds);

  if (sErr) throw sErr;

  for (const row of subjRows ?? []) {
    const fid = (row as any).feed_item_id as string | undefined;
    const prof = (row as any).profiles;
    if (!fid || !prof?.id) continue;

    const cur = subjectMap.get(fid) ?? [];
    cur.push({
      profile_id: prof.id,
      display_name: prof.name ?? "Player",
      avatar_url: prof.avatar_url ?? null,
      role: (row as any).role ?? null,
    });
    subjectMap.set(fid, cur);
  }

  for (const arr of subjectMap.values()) {
    arr.sort((a, b) => {
      const ap = a.role === "primary" ? 0 : 1;
      const bp = b.role === "primary" ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return String(a.display_name).localeCompare(String(b.display_name));
    });
  }

  return subjectMap;
}

/**
 * Enrich raw feed_items rows into FeedItemVMs.
 *
 * This used to be eight sequential round trips — actors, then subjects, then a
 * batch of three aggregate queries, then top comments (gated on the comment
 * counts), then top-comment authors, then two more for the PB "circle best"
 * flag. At a ~40ms hop to Supabase that was ~320ms of latency before any of the
 * queries did work, and it blocked the server render of /social.
 *
 * Every one of those dependencies was false:
 *
 *   the actor now rides along on the page query's own select;
 *   the top-comment gate spent a full round trip to avoid asking about a
 *     handful of ids that would have returned nothing;
 *   computeFriendBestForPbs's two queries never used each other's results —
 *     the circle filter happens in JS;
 *   the four aggregate queries are now one RPC.
 *
 * So: one wave for the page, one for everything else.
 */
export async function enrichFeedItems(rows: any[], viewerProfileId: string): Promise<FeedItemVM[]> {
  if (!rows.length) return [];

  const feedItemIds = rows.map((i: any) => i.id).filter(Boolean);

  const [subjectMap, aggregates, friendBestIds] = await Promise.all([
    getSubjects(feedItemIds),
    getFeedAggregates(feedItemIds, viewerProfileId),
    computeFriendBestForPbs(rows, viewerProfileId),
  ]);

  return rows.map((i: any) => {
    // `actor` is embedded by the page query. Rows from callers that don't embed
    // it fall back to null, which is the same as an item with no actor.
    const actor = normalizeActor(i.actor ?? null);

    const agg = aggregates.get(i.id);
    const reaction_counts = agg?.reaction_counts ?? {};
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
        comment_count: agg?.comment_count ?? 0,
        my_reaction: agg?.my_reaction ?? null,
        top_comment: agg?.top_comment ?? null,
        friend_best: friendBestIds.has(i.id),
      },
    } as FeedItemVM;
  });
}

/**
 * Returns the set of PB feed-item ids whose gross is the best among the people
 * the viewer follows (incl. self) at that course+tee — i.e. "best of your circle".
 */
async function computeFriendBestForPbs(rows: any[], viewerProfileId: string): Promise<Set<string>> {
  const result = new Set<string>();

  const pbRows = rows.filter(
    (i) => i.type === "pb" && i.payload?.course_id && typeof i.payload?.gross_total === "number",
  );
  if (!pbRows.length) return result;

  const courseIds = Array.from(new Set(pbRows.map((i) => i.payload.course_id as string)));

  // These two look sequential but aren't: the course-record query filters on
  // course only, and the circle is applied in JS below. Awaiting them in turn
  // cost a whole round trip for nothing.
  const [{ data: followRows }, { data: crRows }] = await Promise.all([
    supabaseAdmin.from("follows").select("following_id").eq("follower_id", viewerProfileId),
    supabaseAdmin
      .from("v_course_record_rounds")
      .select("profile_id, course_id, tee_name, gross_score, is_complete")
      .in("course_id", courseIds)
      .eq("is_complete", true),
  ]);

  // Followed profiles (+ self) define "your circle".
  const circle = new Set<string>([viewerProfileId, ...(followRows ?? []).map((r: any) => r.following_id)]);

  // min gross per (course_id, tee_name) among the circle
  const minByKey = new Map<string, number>();
  for (const r of (crRows ?? []) as any[]) {
    if (!circle.has(r.profile_id)) continue;
    const gross = typeof r.gross_score === "number" ? r.gross_score : null;
    if (gross === null) continue;
    const key = `${r.course_id}::${r.tee_name ?? "null"}`;
    const cur = minByKey.get(key);
    if (cur === undefined || gross < cur) minByKey.set(key, gross);
  }

  for (const i of pbRows) {
    const key = `${i.payload.course_id}::${i.payload.tee_name ?? "null"}`;
    const min = minByKey.get(key);
    if (min !== undefined && i.payload.gross_total <= min) result.add(i.id);
  }

  return result;
}

/**
 * Fetch a single feed item by id for the viewer (respects feed_item_targets
 * visibility). Returns null if not found or not visible to the viewer.
 * Live items (id prefixed "live:") are not stored and return null.
 */
export async function getFeedItemById(id: string, viewerProfileId: string): Promise<FeedItemVM | null> {
  if (!id || id.startsWith("live:")) return null;

  const { data, error } = await supabaseAdmin
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
      actor:actor_profile_id ( id, name, avatar_url ),
      feed_item_targets!inner(viewer_profile_id)
    `
    )
    .eq("id", id)
    .eq("feed_item_targets.viewer_profile_id", viewerProfileId)
    .neq("visibility", "removed")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const items = await enrichFeedItems([data], viewerProfileId);
  return items[0] ?? null;
}

export type FeedAggregate = {
  reaction_counts: Record<string, number>;
  comment_count: number;
  my_reaction: string | null;
  top_comment: any | null;
};

/**
 * Reaction counts, comment count, the viewer's own reaction and the top comment
 * for a page of feed items — in one round trip.
 *
 * Replaces four separate queries that each pulled whole tables back to count
 * them in JS; see migration 20260903000001_feed_aggregates.sql for why that
 * mattered more than the round-trip count did.
 *
 * The RPC is service-role-only and does no authorization of its own: callers
 * must already have narrowed `feedItemIds` to items the viewer may see.
 */
export async function getFeedAggregates(
  feedItemIds: string[],
  viewerProfileId: string,
): Promise<Map<string, FeedAggregate>> {
  const map = new Map<string, FeedAggregate>();
  if (!feedItemIds.length) return map;

  const { data, error } = await supabaseAdmin.rpc("get_feed_aggregates", {
    _feed_item_ids: feedItemIds,
    _viewer_profile_id: viewerProfileId,
  });

  if (error) throw error;

  for (const [feedItemId, raw] of Object.entries((data ?? {}) as Record<string, any>)) {
    map.set(feedItemId, {
      reaction_counts: (raw?.reaction_counts ?? {}) as Record<string, number>,
      comment_count: typeof raw?.comment_count === "number" ? raw.comment_count : 0,
      my_reaction: typeof raw?.my_reaction === "string" ? raw.my_reaction : null,
      top_comment: raw?.top_comment ?? null,
    });
  }

  return map;
}

/**
 * Live rounds for the main feed.
 * Returned as FEED-SHAPED items so they can use the normal FeedCard UI.
 */
export async function getLiveRoundsAsFeedItems(params: { viewerProfileId: string }) {
  const { viewerProfileId } = params;

  // 1. Follows
  const { data: followingRows, error: fErr } = await supabaseAdmin
    .from("follows")
    .select("following_id")
    .eq("follower_id", viewerProfileId);

  if (fErr) throw fErr;

  const followingIds = (followingRows ?? []).map((r: any) => r.following_id as string).filter(Boolean);
  const candidateProfileIds = Array.from(new Set([viewerProfileId, ...followingIds]));

  // 2. Round participants for candidates
  const { data: participantRows, error: pErr } = await supabaseAdmin
    .from("round_participants")
    .select("round_id, profile_id")
    .in("profile_id", candidateProfileIds);

  if (pErr) throw pErr;

  const roundIds = Array.from(new Set((participantRows ?? []).map((r: any) => r.round_id as string).filter(Boolean)));
  if (!roundIds.length) return [];

  // 3. Filter to live rounds only
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

  // 4. Single batch RPC call for all live round data
  const { data: batchData, error: batchErr } = await supabaseAdmin
    .rpc("get_live_rounds_feed_data", { _round_ids: liveRoundIds });

  if (batchErr) throw batchErr;

  const roundDataArr = (batchData as any[]) ?? [];

  // 5. Build feed items from batch data
  return roundDataArr.map((rd: any) => {
    const rid = rd.round_id as string;
    const course_name = rd.course_name ?? "Live round";
    const startedAt = rd.started_at ?? new Date().toISOString();

    // Build profile lookup
    const profMap = new Map<string, any>();
    for (const p of (rd.profiles ?? []) as any[]) profMap.set(p.id, p);

    // Build tee meta for CH computation
    const teeMeta = rd.tee_snapshot ?? null;
    const slope = teeMeta?.slope != null ? Number(teeMeta.slope) : null;
    const rating = teeMeta?.rating != null ? Number(teeMeta.rating) : null;
    const parTot = teeMeta?.par_total != null ? Number(teeMeta.par_total) : null;

    // Build hole lookup: holeNumber → { par, stroke_index }
    const holeMap = new Map<number, { par: number | null; stroke_index: number | null }>();
    for (const h of (rd.holes ?? []) as any[]) {
      holeMap.set(h.hole_number, { par: h.par ?? null, stroke_index: h.stroke_index ?? null });
    }

    // Build score lookup: participantId → Map<holeNumber, strokes>
    const scoresByParticipant = new Map<string, Map<number, number>>();
    for (const s of (rd.scores ?? []) as any[]) {
      const pid = s.participant_id as string;
      const hn = s.hole_number as number;
      const strokes = s.strokes;
      if (!pid || !hn || typeof strokes !== "number") continue;
      if (!scoresByParticipant.has(pid)) scoresByParticipant.set(pid, new Map());
      scoresByParticipant.get(pid)!.set(hn, strokes);
    }

    // Parse participants for format summary
    const participants: Participant[] = ((rd.participants ?? []) as any[]).map((rp: any) => ({
      id: rp.id,
      profile_id: rp.profile_id ?? null,
      is_guest: !!rp.is_guest,
      display_name: rp.display_name ?? null,
      role: rp.role ?? "player",
      tee_snapshot_id: rp.tee_snapshot_id ?? null,
      team_id: rp.team_id ?? null,
      playing_handicap_used: typeof rp.playing_handicap_used === "number" ? rp.playing_handicap_used : null,
      course_handicap_used: typeof rp.course_handicap_used === "number" ? rp.course_handicap_used : null,
    }));

    const teams: Team[] = ((rd.teams ?? []) as any[]).map((t: any) => ({
      id: t.id,
      round_id: t.round_id,
      name: t.name ?? `Team ${t.team_number}`,
      team_number: t.team_number,
    }));

    const holes: Hole[] = ((rd.holes ?? []) as any[]).map((h: any) => ({
      hole_number: h.hole_number,
      par: h.par ?? null,
      yardage: h.yardage ?? null,
      stroke_index: h.stroke_index ?? null,
    }));

    // Build scoresByKey and holeStatesByKey for format computation
    const scoresByKey: Record<string, Score> = {};
    for (const s of (rd.scores ?? []) as any[]) {
      const key = `${s.participant_id}:${s.hole_number}`;
      scoresByKey[key] = {
        participant_id: s.participant_id,
        hole_number: s.hole_number,
        strokes: typeof s.strokes === "number" ? s.strokes : null,
        created_at: s.created_at ?? "",
      };
    }

    const holeStatesByKey: Record<string, HoleState> = {};
    // A picked-up hole should have no numeric strokes row, so scoreMap alone
    // underreports gross/net/holes-completed. Track them separately per
    // participant so the totals below can credit the WHS NDB penalty.
    // The totals do NOT assume that invariant holds — markPickedUp can commit the
    // 'picked_up' state and then fail to clear the score — so each loop below
    // skips a picked-up hole that already carries a score, counting it once.
    const pickedUpHolesByParticipant = new Map<string, Set<number>>();
    for (const hs of (rd.hole_states ?? []) as any[]) {
      const key = `${hs.participant_id}:${hs.hole_number}`;
      const status = hs.status as string;
      if (status === "completed" || status === "picked_up" || status === "not_started") {
        holeStatesByKey[key] = status;
      }
      if (status === "picked_up") {
        const pid = hs.participant_id as string;
        if (!pickedUpHolesByParticipant.has(pid)) pickedUpHolesByParticipant.set(pid, new Set());
        pickedUpHolesByParticipant.get(pid)!.add(hs.hole_number as number);
      }
    }

    // Compute format summary from pre-fetched data (no extra DB queries)
    const formatConfig: Record<string, any> =
      typeof rd.format_config === "object" && rd.format_config ? rd.format_config : {};
    const sideGames: SideGame[] = Array.isArray(rd.side_games) ? rd.side_games : [];

    let formatSummary: ReturnType<typeof computeFormatSummaryFromData> = null;
    try {
      formatSummary = computeFormatSummaryFromData({
        format_type: rd.format_type ?? null,
        format_config: formatConfig,
        side_games: sideGames,
        participants,
        teams,
        holes,
        scoresByKey,
        holeStatesByKey,
        starting_hole: typeof rd.starting_hole === "number" ? rd.starting_hole : 1,
      });
    } catch {
      // best-effort
    }

    const SINGLE_BALL_FORMATS = ["scramble", "greensomes", "foursomes"];
    const isSingleBall = typeof rd.format_type === "string" && SINGLE_BALL_FORMATS.includes(rd.format_type);

    // For single-ball team formats, build team rows instead of individual player rows
    const buildTeamPlayers = () => {
      return teams.map((t) => {
        const members = participants.filter((p) => p.team_id === t.id);
        const firstMember = members[0];
        const scoreMap = firstMember ? scoresByParticipant.get(firstMember.id) : undefined;

        let grossTotal = 0;
        let holesCompleted = 0;
        let parPlayed = 0;

        if (scoreMap) {
          for (const [holeNum, strokes] of scoreMap) {
            grossTotal += strokes;
            holesCompleted++;
            const hole = holeMap.get(holeNum);
            if (hole?.par != null) parPlayed += hole.par;
          }
        }

        for (const holeNum of (firstMember && pickedUpHolesByParticipant.get(firstMember.id)) || []) {
          const hole = holeMap.get(holeNum);
          if (hole?.par == null) continue;
          if (scoreMap?.has(holeNum)) continue; // already counted above
          grossTotal += netDoubleBogeyGross(hole.par, null, hole.stroke_index);
          holesCompleted++;
          parPlayed += hole.par;
        }

        const hasScores = holesCompleted > 0;
        const gross_total = hasScores ? grossTotal : null;
        const gross_to_par = gross_total != null && parPlayed > 0 ? grossTotal - parPlayed : null;

        return {
          profile_id: null,
          name: t.name,
          avatar_url: null,
          gross_total,
          net_total: null,
          gross_to_par,
          net_to_par: null,
          par_total: hasScores && parPlayed > 0 ? parPlayed : null,
          holes_completed: hasScores ? holesCompleted : null,
          format_score: formatSummary?.player_scores.get(t.id) ?? null,
        };
      });
    };

    // Build player data
    const players = isSingleBall && teams.length > 0 ? buildTeamPlayers() : participants.map((rp) => {
      const prof = rp.profile_id ? profMap.get(rp.profile_id) : null;
      const scoreMap = scoresByParticipant.get(rp.id);

      // Prefer the course handicap locked in at round start. The slope/rating
      // computation below is only a fallback: the participant mapper above does
      // not carry handicap_index, so it alone left net blank on every live card.
      const hi = rp.handicap_index != null ? Number(rp.handicap_index) : null;
      const courseHcp =
        rp.course_handicap_used != null
          ? rp.course_handicap_used
          : hi != null && slope != null && rating != null && parTot != null
            ? Math.round(hi * (slope / 113) + (rating - parTot))
            : null;

      let grossTotal = 0;
      let netAdjustment = 0;
      let holesCompleted = 0;
      let parPlayed = 0;

      if (scoreMap) {
        for (const [holeNum, strokes] of scoreMap) {
          grossTotal += strokes;
          holesCompleted++;
          const hole = holeMap.get(holeNum);
          if (hole?.par != null) parPlayed += hole.par;
          if (courseHcp != null) {
            netAdjustment += strokesReceivedOnHole(courseHcp, hole?.stroke_index ?? null, holeMap.size || 18);
          }
        }
      }

      for (const holeNum of pickedUpHolesByParticipant.get(rp.id) || []) {
        const hole = holeMap.get(holeNum);
        if (hole?.par == null) continue;
        if (scoreMap?.has(holeNum)) continue; // already counted above
        const recv = strokesReceivedOnHole(courseHcp, hole.stroke_index, holeMap.size || 18);
        grossTotal += netDoubleBogeyGross(hole.par, courseHcp, hole.stroke_index, holeMap.size || 18);
        holesCompleted++;
        parPlayed += hole.par;
        if (courseHcp != null) netAdjustment += recv;
      }

      const hasScores = holesCompleted > 0;
      const gross_total = hasScores ? grossTotal : null;
      const net_total = hasScores && courseHcp != null ? grossTotal - netAdjustment : null;
      const gross_to_par = gross_total != null && parPlayed > 0 ? grossTotal - parPlayed : null;
      const net_to_par = net_total != null && parPlayed > 0 ? net_total - parPlayed : null;
      const par_total = hasScores && parPlayed > 0 ? parPlayed : null;

      const name =
        (prof?.name && String(prof.name)) ||
        (typeof rp.display_name === "string" && rp.display_name) ||
        "Player";

      return {
        profile_id: rp.profile_id ?? null,
        name,
        avatar_url: prof?.avatar_url ?? null,
        gross_total,
        net_total,
        gross_to_par,
        net_to_par,
        par_total,
        holes_completed: hasScores ? holesCompleted : null,
        format_score: formatSummary?.player_scores.get(rp.id) ?? null,
      };
    });

    return {
      id: `live:${rid}`,
      type: "round_played" as const,
      occurred_at: startedAt,
      created_at: startedAt,
      actor: null,
      subject: players?.[0]?.profile_id
        ? { profile_id: players[0].profile_id, display_name: players[0].name, avatar_url: players[0].avatar_url }
        : null,
      subjects: players.map((p: any) => ({ profile_id: p.profile_id, display_name: p.name, avatar_url: p.avatar_url })),
      audience: "followers" as const,
      visibility: "visible" as const,
      payload: {
        round_id: rid,
        course_name,
        tee_name: null,
        format_type: formatSummary?.format_type ?? null,
        format_label: formatSummary?.format_label ?? null,
        format_winner: formatSummary?.format_winner ?? null,
        side_game_results: formatSummary?.side_game_results ?? null,
        players: players.map((p: any) => ({
          profile_id: p.profile_id,
          name: p.name,
          avatar_url: p.avatar_url,
          gross_total: p.gross_total,
          net_total: p.net_total,
          gross_to_par: p.gross_to_par,
          net_to_par: p.net_to_par,
          par_total: p.par_total,
          holes_completed: p.holes_completed,
          format_score: p.format_score,
        })),
        date: null,
      },
      aggregates: {
        reaction_counts: {},
        reaction_summary: [],
        comment_count: 0,
        my_reaction: null,
        top_comment: null,
      },
    };
  });
}
