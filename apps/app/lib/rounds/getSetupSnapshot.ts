import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { calcCourseHandicap } from "@/lib/rounds/setupHelpers";

export async function getSetupSnapshot(roundId: string) {
  const [roundRes, participantsRes] = await Promise.all([
    supabaseAdmin
      .from("rounds")
      .select(`
        id, name, status, course_id, pending_tee_box_id,
        started_at, format_type, format_config, side_games,
        scheduled_at, default_playing_handicap_mode,
        default_playing_handicap_value,
        courses(name)
      `)
      .eq("id", roundId)
      .single(),
    supabaseAdmin.rpc("get_round_setup_participants", { _round_id: roundId }),
  ]);

  if (roundRes.error) throw roundRes.error;
  if (!roundRes.data) return null;

  if (participantsRes.error) throw participantsRes.error;

  const round = roundRes.data as any;
  const rows = (participantsRes.data ?? []) as any[];

  const profileIds = rows
    .filter((r: any) => !r.is_guest && r.profile_id)
    .map((r: any) => r.profile_id as string);

  const [hiData, teeData] = await Promise.all([
    profileIds.length > 0
      ? supabaseAdmin
          .from("handicap_index_history")
          .select("profile_id, as_of_date, handicap_index")
          .in("profile_id", profileIds)
          .not("handicap_index", "is", null)
          .order("as_of_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    round.pending_tee_box_id
      ? supabaseAdmin
          .from("course_tee_boxes")
          .select("par, rating, slope")
          .eq("id", round.pending_tee_box_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const handicapIndexes: Record<string, number> = {};
  if (!hiData.error && hiData.data) {
    for (const row of hiData.data as any[]) {
      const pid = row.profile_id as string;
      if (handicapIndexes[pid] != null) continue;
      const hi = Number(row.handicap_index);
      if (Number.isFinite(hi)) {
        handicapIndexes[pid] = Math.round(hi * 10) / 10;
      }
    }
  }

  const courseHandicaps: Record<string, number> = {};
  if (!teeData.error && teeData.data) {
    const par = Number((teeData.data as any).par);
    const rating = Number((teeData.data as any).rating);
    const slope = Number((teeData.data as any).slope);

    if (Number.isFinite(par) && Number.isFinite(rating) && Number.isFinite(slope)) {
      for (const pid of profileIds) {
        const hi = handicapIndexes[pid];
        if (hi == null) continue;
        courseHandicaps[pid] = calcCourseHandicap(hi, slope, rating, par);
      }
    }
  }

  return {
    round,
    participants: rows,
    handicap_indexes: handicapIndexes,
    course_handicaps: courseHandicaps,
  };
}
