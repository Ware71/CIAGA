// lib/stats/projectionData.ts
//
// Client-side access to the WHS differential streams that drive the projection
// simulator. One request covers every player on screen — the compare-all modals
// used to issue a query per followed player, on every open.

import { supabase } from "@/lib/supabaseClient";
import { fetchWithCache, setCacheScope } from "@/lib/cache/clientCache";

/** One accepted round's score differential. */
export type DiffPoint = { d: string; v: number };

const CACHE_OPTS = { ttl: 24 * 60 * 60_000, staleTime: 5 * 60_000 };
const cacheKey = (ids: string[]) => `stats:differentials:v1:${[...ids].sort().join(",")}`;

async function authedFetch(input: RequestInfo, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/**
 * Differential streams for the given profiles, oldest first.
 *
 * The server drops any profile the viewer is not allowed to see, so a caller
 * must treat a missing entry as "no data" rather than an error.
 */
export async function fetchDifferentialStreams(
  profileIds: string[]
): Promise<Map<string, DiffPoint[]>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  const out = new Map<string, DiffPoint[]>();
  if (!ids.length) return out;

  const res = await authedFetch(
    `/api/stats/differentials?profileIds=${encodeURIComponent(ids.join(","))}`
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Failed to load differentials (${res.status})`);
  }

  const json = (await res.json()) as { streams?: Record<string, DiffPoint[]> };
  for (const id of ids) out.set(id, json.streams?.[id] ?? []);
  return out;
}

/**
 * Stale-while-revalidate wrapper, sharing the client cache the other stats pages
 * use. Differentials only change when a round finishes, which already
 * invalidates the `stats` prefix.
 */
export async function fetchDifferentialStreamsCached(
  viewerProfileId: string,
  profileIds: string[],
  onFresh?: (streams: Map<string, DiffPoint[]>) => void
): Promise<Map<string, DiffPoint[]>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  if (!ids.length) return new Map();

  setCacheScope(viewerProfileId);

  // The cache stores plain objects; Maps do not survive JSON serialisation.
  const toRecord = (m: Map<string, DiffPoint[]>) => Object.fromEntries(m);
  const toMap = (r: Record<string, DiffPoint[]>) => new Map(Object.entries(r));

  const record = await fetchWithCache<Record<string, DiffPoint[]>>(
    cacheKey(ids),
    () => fetchDifferentialStreams(ids).then(toRecord),
    { ...CACHE_OPTS, onFresh: onFresh ? (r) => onFresh(toMap(r)) : undefined }
  );

  return toMap(record);
}
