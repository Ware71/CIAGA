import { supabase } from "@/lib/supabaseClient";
import { fetchWithCache, readCache, setCacheScope } from "@/lib/cache/clientCache";

/**
 * Paginated fetch from the hole_scoring_source view.
 * Returns all rows for the given profile, newest first.
 * Selects the superset of columns used by milestones, hole-scoring, and scoring-breakdown pages.
 */
export async function fetchAllHoleScoringSource(profileId: string) {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("hole_scoring_source")
      .select(
        "profile_id, round_id, played_at, course_id, course_name, tee_box_id, tee_name, hole_number, par, yardage, stroke_index, strokes, to_par, net_strokes, net_to_par, strokes_received, is_double_plus, is_triple_plus"
      )
      .eq("profile_id", profileId)
      .order("played_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const chunk = (data ?? []) as any[];
    out.push(...chunk);

    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

// Whole-career hole-level data, fetched in 1000-row pages. Three stats pages
// (milestones, hole-scoring, scoring-breakdown) each pulled the entire set on
// every visit, and it only changes when a round is finished — which invalidates
// the "stats" prefix (see RoundDetailClient.finishRound).
const STATS_CACHE_OPTS = { ttl: 24 * 60 * 60_000, staleTime: 5 * 60_000 };

const statsCacheKey = (profileId: string) => `stats:holeScoring:${profileId}`;

/** Cached snapshot if there is one, for painting before the fetch resolves. */
export function peekHoleScoringSource(profileId: string): any[] | null {
  return readCache<any[]>(statsCacheKey(profileId), STATS_CACHE_OPTS)?.data ?? null;
}

/**
 * Stale-while-revalidate wrapper around fetchAllHoleScoringSource. Resolves
 * immediately from the snapshot when there is one; `onFresh` fires later if the
 * background revalidation returns newer rows.
 */
export async function fetchHoleScoringSourceCached(
  profileId: string,
  onFresh?: (rows: any[]) => void
): Promise<any[]> {
  setCacheScope(profileId);
  return fetchWithCache<any[]>(
    statsCacheKey(profileId),
    () => fetchAllHoleScoringSource(profileId),
    { ...STATS_CACHE_OPTS, onFresh }
  );
}
