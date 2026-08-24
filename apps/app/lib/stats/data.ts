// src/lib/stats/data.ts

import { supabase } from "@/lib/supabaseClient";
import { fetchWithCache, setCacheScope } from "@/lib/cache/clientCache";
import type { HiPoint } from "@/lib/stats/chartMath";

export type HiRow = { profile_id: string; as_of_date: string; handicap_index: number };
export type FollowProfile = { id: string; name: string | null; avatar_url: string | null };

/** PostgREST truncates at 1000 rows and drops the OLDEST, so every read pages explicitly. */
const PAGE = 1000;

const HISTORY_CACHE_OPTS = { ttl: 24 * 60 * 60_000, staleTime: 5 * 60_000 };
const historyCacheKey = (profileId: string) => `stats:hiHistory:v1:${profileId}`;

function toPoints(rows: HiRow[]): HiPoint[] {
  return rows
    .filter((r) => typeof r.handicap_index === "number" && Number.isFinite(r.handicap_index))
    .map((r) => ({ date: String(r.as_of_date), hi: Number(r.handicap_index) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Handicap index history for a set of profiles in ONE query.
 *
 * The compare-all modals used to issue a query per followed player on every
 * open. Batching also makes the 1000-row ceiling matter more, hence the explicit
 * paging: a silently truncated history would drop the oldest points and tilt
 * every fit.
 */
export async function getHandicapHistoryPointsBatch(
  profileIds: string[]
): Promise<Map<string, HiPoint[]>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  const out = new Map<string, HiPoint[]>();
  if (!ids.length) return out;

  const rowsById = new Map<string, HiRow[]>();
  for (const id of ids) rowsById.set(id, []);

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("handicap_index_history")
      .select("profile_id, as_of_date, handicap_index")
      .in("profile_id", ids)
      .not("handicap_index", "is", null)
      .order("as_of_date", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw error;

    const chunk = (data ?? []) as unknown as HiRow[];
    for (const r of chunk) rowsById.get(r.profile_id)?.push(r);
    if (chunk.length < PAGE) break;
  }

  for (const id of ids) out.set(id, toPoints(rowsById.get(id) ?? []));
  return out;
}

export async function getHandicapHistoryPoints(profileId: string): Promise<HiPoint[]> {
  const byId = await getHandicapHistoryPointsBatch([profileId]);
  return byId.get(profileId) ?? [];
}

/**
 * Stale-while-revalidate history for one profile, sharing the client cache the
 * other stats pages use. Handicap history only changes when a round finishes,
 * which already invalidates the `stats` prefix.
 */
export async function getHandicapHistoryPointsCached(
  viewerProfileId: string,
  profileId: string,
  onFresh?: (points: HiPoint[]) => void
): Promise<HiPoint[]> {
  setCacheScope(viewerProfileId);
  return fetchWithCache<HiPoint[]>(
    historyCacheKey(profileId),
    () => getHandicapHistoryPoints(profileId),
    { ...HISTORY_CACHE_OPTS, onFresh }
  );
}

export async function getFollowedProfiles(myProfileId: string): Promise<FollowProfile[]> {
  const { data: follows, error: followsErr } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", myProfileId);

  if (followsErr) throw followsErr;

  const followingIds = (follows ?? []).map((r: any) => r.following_id as string).filter(Boolean);
  if (!followingIds.length) return [];

  // Public-safe resolver (must exist in DB as an RPC)
  const { data: profs, error: profErr } = await supabase.rpc("get_profiles_public", {
    ids: followingIds,
  });

  if (profErr) throw profErr;

  const out = ((profs ?? []) as FollowProfile[]).slice();
  out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return out;
}
