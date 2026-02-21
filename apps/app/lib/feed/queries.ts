import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseFeedPayload } from "@/lib/feed/schemas";
import type { FeedItemVM, FeedPageResponse } from "@/lib/feed/types";
import { strokesReceivedOnHole } from "@/lib/rounds/handicapUtils";
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
      feed_item_targets!inner(viewer_profile_id)
    `
    )
    .eq("feed_item_targets.viewer_profile_id", viewerProfileId)
    .neq("visibility", "removed")
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

  // Actor profiles
  const actorIds = Array.from(new Set(trimmed.map((i: any) => i.actor_profile_id).filter(Boolean)));

  const { data: actors, error: aErr } = await supabaseAdmin
    .from("profiles")
    .select("id, name, avatar_url")
    .in("id", actorIds.length ? actorIds : [viewerProfileId]);

  if (aErr) throw aErr;

  const actorMap = new Map<string, any>();
  for (const a of actors ?? []) actorMap.set(a.id, a);

  // Subjects (feed_item_subjects -> profiles)
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

    // Deterministic subject ordering:
    // - role === 'primary' first
    // - then by display_name
    for (const [fid, arr] of subjectMap.entries()) {
      arr.sort((a, b) => {
        const ap = a.role === "primary" ? 0 : 1;
        const bp = b.role === "primary" ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return String(a.display_name).localeCompare(String(b.display_name));
      });
    }
  }

  // Aggregates (reactions/comments + top comment)
  const feedItemIds = trimmed.map((i: any) => i.id);

  const [reactionAgg, commentAgg, myReactions] = await Promise.all([
    getReactionCounts(feedItemIds),
    getCommentCounts(feedItemIds),
    getMyReactions(feedItemIds, viewerProfileId),
  ]);

  // Only fetch top comments for items that have comments
  const feedItemIdsWithComments = feedItemIds.filter((id) => (commentAgg.get(id) ?? 0) > 0);
  const topComments = await getTopComments(feedItemIdsWithComments);


  const items: FeedItemVM[] = trimmed.map((i: any) => {
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

  const next_cursor =
    hasMore && trimmed.length
      ? {
          occurred_at: trimmed[trimmed.length - 1].occurred_at ?? trimmed[trimmed.length - 1].created_at,
          id: trimmed[trimmed.length - 1].id,
        }
      : null;

  return { items, next_cursor };
}

export async function getReactionCounts(feedItemIds: string[]) {
  const map = new Map<string, Record<string, number>>();
  if (!feedItemIds.length) return map;

  const { data, error } = await supabaseAdmin
    .from("feed_reactions")
    .select("feed_item_id, emoji")
    .in("feed_item_id", feedItemIds);
  if (error) throw error;

  for (const row of data ?? []) {
    const fid = (row as any).feed_item_id as string;
    const emoji = (row as any).emoji as string;
    if (!fid || !emoji) continue;
    const cur = map.get(fid) ?? {};
    cur[emoji] = (cur[emoji] ?? 0) + 1;
    map.set(fid, cur);
  }

  return map;
}

export async function getCommentCounts(feedItemIds: string[]) {
  const map = new Map<string, number>();
  if (!feedItemIds.length) return map;

  const { data, error } = await supabaseAdmin
    .from("feed_comments")
    .select("feed_item_id")
    .in("feed_item_id", feedItemIds);
  if (error) throw error;

  for (const row of data ?? []) {
    const fid = (row as any).feed_item_id as string;
    if (!fid) continue;
    map.set(fid, (map.get(fid) ?? 0) + 1);
  }

  return map;
}

export async function getMyReactions(feedItemIds: string[], viewerProfileId: string) {
  const map = new Map<string, string | null>();
  if (!feedItemIds.length) return map;

  const { data, error } = await supabaseAdmin
    .from("feed_reactions")
    .select("feed_item_id, emoji")
    .eq("profile_id", viewerProfileId)
    .in("feed_item_id", feedItemIds);

  if (error) throw error;

  for (const row of data ?? []) {
    const fid = (row as any).feed_item_id as string;
    const emoji = (row as any).emoji as string;
    if (!fid) continue;
    map.set(fid, emoji ?? null);
  }

  return map;
}

/**
 * Get the top comment per feed item:
 * - Highest vote_count first
 * - Tie-breaker: most recent created_at
 *
 * Returns shape compatible with FeedCard:
 * {
 *   id, body, created_at,
 *   vote_count, like_count,
 *   author: { id, name, avatar_url }
 * }
 */
export async function getTopComments(feedItemIds: string[]) {
  const map = new Map<string, any>();
  if (!feedItemIds.length) return map;

  const { data: rows, error } = await supabaseAdmin
    .from("feed_comments")
    .select("id, feed_item_id, profile_id, body, created_at, vote_count")
    .in("feed_item_id", feedItemIds)
    .order("vote_count", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  const authorIds = Array.from(new Set((rows ?? []).map((r: any) => r.profile_id).filter(Boolean)));

  const authorMap = new Map<string, { id: string; name: string; avatar_url: string | null }>();
  if (authorIds.length) {
    const { data: profs, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", authorIds);

    if (pErr) throw pErr;

    for (const p of profs ?? []) {
      authorMap.set((p as any).id, {
        id: (p as any).id,
        name: (p as any).name ?? "Player",
        avatar_url: (p as any).avatar_url ?? null,
      });
    }
  }

  // Since rows are ordered by (vote_count desc, created_at desc),
  // first row per feed_item_id is the winner.
  for (const r of rows ?? []) {
    const fid = (r as any).feed_item_id as string;
    if (!fid) continue;
    if (map.has(fid)) continue;

    const pid = (r as any).profile_id as string | undefined;
    const author = pid ? authorMap.get(pid) : null;

    const voteCount = typeof (r as any).vote_count === "number" ? (r as any).vote_count : 0;
    const body = typeof (r as any).body === "string" ? (r as any).body : "";

    if (!body) continue;

    map.set(fid, {
      id: (r as any).id,
      body,
      created_at: (r as any).created_at,
      vote_count: voteCount,
      like_count: voteCount, // alias for FeedCard
      author: {
        id: pid ?? null,
        name: author?.name ?? "Player",
        avatar_url: author?.avatar_url ?? null,
      },
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
    for (const hs of (rd.hole_states ?? []) as any[]) {
      const key = `${hs.participant_id}:${hs.hole_number}`;
      const status = hs.status as string;
      if (status === "completed" || status === "picked_up" || status === "not_started") {
        holeStatesByKey[key] = status;
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
      });
    } catch {
      // best-effort
    }

    // Build player data
    const players = participants.map((rp) => {
      const prof = rp.profile_id ? profMap.get(rp.profile_id) : null;
      const scoreMap = scoresByParticipant.get(rp.id);

      const hi = rp.handicap_index != null ? Number(rp.handicap_index) : null;
      const courseHcp =
        hi != null && slope != null && rating != null && parTot != null
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
            netAdjustment += strokesReceivedOnHole(courseHcp, hole?.stroke_index ?? null);
          }
        }
      }

      const hasScores = holesCompleted > 0;
      const gross_total = hasScores ? grossTotal : null;
      const net_total = hasScores && courseHcp != null ? grossTotal - netAdjustment : null;
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
