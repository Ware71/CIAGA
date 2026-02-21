import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getFeedPage, getLiveRoundsAsFeedItems } from "@/lib/feed/queries";
import type { FeedItemVM } from "@/lib/feed/types";
import {
  safeNum,
  sortByOccurredAtDesc,
  isLiveItem,
  occurredAtMs,
  scoreNonLiveItems,
  selectWithDiversity,
  enforceAtLeastOneAchievement,
} from "@/lib/feed/feedItemUtils";

export type HomeSummary = {
  live_round_id: string | null;
  handicap: { current: number | null; delta_30d: number };
  rounds_played: number | null;
  last_round: {
    course: string | null;
    tee: string | null;
    gross: number | null;
    net: number | null;
    diff: number | null;
    played_at: string | null;
  } | null;
  mini_feed: FeedItemVM[];
};

export async function detectLiveRound(profileId: string): Promise<string | null> {
  const partRes = await supabaseAdmin
    .from("round_participants")
    .select("round_id")
    .eq("profile_id", profileId);
  if (partRes.error) throw partRes.error;

  const roundIds = (partRes.data ?? []).map((r: any) => r.round_id as string).filter(Boolean);
  if (!roundIds.length) return null;

  const roundsRes = await supabaseAdmin
    .from("rounds")
    .select("id")
    .in("id", roundIds)
    .eq("status", "live")
    .order("started_at", { ascending: false })
    .limit(1);
  if (roundsRes.error) throw roundsRes.error;

  return (roundsRes.data?.[0]?.id as string) ?? null;
}

export async function fetchHandicapSnapshot(profileId: string) {
  const today = new Date();
  const since = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sinceDate = since.toISOString().slice(0, 10);

  const [curRes, baseRes] = await Promise.all([
    supabaseAdmin
      .from("handicap_index_history")
      .select("handicap_index")
      .eq("profile_id", profileId)
      .order("as_of_date", { ascending: false })
      .limit(1),
    supabaseAdmin
      .from("handicap_index_history")
      .select("handicap_index")
      .eq("profile_id", profileId)
      .gte("as_of_date", sinceDate)
      .order("as_of_date", { ascending: true })
      .limit(1),
  ]);

  const current = safeNum((curRes.data as any)?.[0]?.handicap_index);
  const baseline = safeNum((baseRes.data as any)?.[0]?.handicap_index);
  const delta_30d =
    typeof current === "number" && typeof baseline === "number" ? current - baseline : 0;

  return { current, delta_30d };
}

export async function fetchRoundsPlayed(profileId: string): Promise<number | null> {
  const res = await supabaseAdmin
    .from("handicap_round_results")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("accepted", true);
  if (res.error) throw res.error;
  return typeof res.count === "number" ? res.count : null;
}

export async function fetchLastRound(profileId: string) {
  const rrRes = await supabaseAdmin
    .from("handicap_round_results")
    .select("played_at,adjusted_gross_score,course_handicap_used,score_differential,tee_snapshot_id")
    .eq("profile_id", profileId)
    .eq("accepted", true)
    .order("played_at", { ascending: false })
    .limit(1);
  if (rrRes.error) throw rrRes.error;

  const rr: any = rrRes.data?.[0] ?? null;
  if (!rr) return null;

  const gross = safeNum(rr.adjusted_gross_score);
  const ch = safeNum(rr.course_handicap_used);
  const net = typeof gross === "number" && typeof ch === "number" ? gross - ch : null;
  const diff = safeNum(rr.score_differential);
  const teeSnapshotId = typeof rr.tee_snapshot_id === "string" ? rr.tee_snapshot_id : null;

  let tee: string | null = null;
  let course: string | null = null;

  if (teeSnapshotId) {
    const teeRes = await supabaseAdmin
      .from("round_tee_snapshots")
      .select("name,round_course_snapshot_id")
      .eq("id", teeSnapshotId)
      .maybeSingle();

    if (!teeRes.error && teeRes.data) {
      tee = typeof (teeRes.data as any).name === "string" ? (teeRes.data as any).name : null;
      const courseSnapId = (teeRes.data as any).round_course_snapshot_id as string | undefined;

      if (courseSnapId) {
        const courseRes = await supabaseAdmin
          .from("round_course_snapshots")
          .select("course_name")
          .eq("id", courseSnapId)
          .maybeSingle();

        if (!courseRes.error && courseRes.data) {
          course =
            typeof (courseRes.data as any).course_name === "string"
              ? (courseRes.data as any).course_name
              : null;
        }
      }
    }
  }

  return {
    course,
    tee,
    gross,
    net,
    diff,
    played_at: typeof rr.played_at === "string" ? rr.played_at : null,
  };
}

export function curateMiniFeed(liveItemsRaw: FeedItemVM[], feedItemsRaw: FeedItemVM[]): FeedItemVM[] {
  const now = Date.now();

  const liveItems = [...liveItemsRaw].sort(sortByOccurredAtDesc).slice(0, 3);

  const liveRoundIds = new Set<string>();
  for (const li of liveItems) {
    if (li.type === "round_played") {
      const rid = (li.payload as any)?.round_id as string | undefined;
      if (rid) liveRoundIds.add(rid);
    }
  }

  const filteredFeed = feedItemsRaw.filter((it) => {
    if (isLiveItem(it)) return false;
    if (it.type !== "round_played") return true;
    const rid = (it.payload as any)?.round_id as string | undefined;
    if (!rid) return true;
    return !liveRoundIds.has(rid);
  });

  const candidateNonLive = [...filteredFeed].sort(sortByOccurredAtDesc);
  const scored = scoreNonLiveItems(candidateNonLive, now);
  const remainingSlots = Math.max(0, 5 - liveItems.length);

  const scoredSorted = scored.sort((a, b) => {
    if (b.baseScore !== a.baseScore) return b.baseScore - a.baseScore;
    return occurredAtMs(b.it) - occurredAtMs(a.it);
  });

  let pickedNonLive = selectWithDiversity(scoredSorted, remainingSlots);
  pickedNonLive = enforceAtLeastOneAchievement(pickedNonLive, candidateNonLive, now);

  return [...liveItems, ...pickedNonLive].slice(0, 5);
}

export async function getHomeSummary(profileId: string): Promise<HomeSummary> {
  const [liveRoundId, handicap, roundsPlayed, lastRound, liveItems, feedPage] =
    await Promise.all([
      detectLiveRound(profileId),
      fetchHandicapSnapshot(profileId),
      fetchRoundsPlayed(profileId),
      fetchLastRound(profileId),
      getLiveRoundsAsFeedItems({ viewerProfileId: profileId }),
      getFeedPage({ viewerProfileId: profileId, limit: 60 }),
    ]);

  const mini_feed = curateMiniFeed(liveItems, feedPage.items);

  return {
    live_round_id: liveRoundId,
    handicap,
    rounds_played: roundsPlayed,
    last_round: lastRound,
    mini_feed,
  };
}
