import { supabase } from "@/lib/supabaseClient";

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
