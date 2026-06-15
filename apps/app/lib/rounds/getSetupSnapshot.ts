import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { calcCourseHandicap } from "@/lib/rounds/setupHelpers";
import { resolvePlayingHandicapPreview } from "@/lib/rounds/playingHandicapPreview";

export async function getSetupSnapshot(roundId: string) {
  const [roundRes, participantsRes, teamsRes] = await Promise.all([
    supabaseAdmin
      .from("rounds")
      .select(`
        id, name, status, course_id, pending_tee_box_id,
        started_at, format_type, format_config, side_games,
        scheduled_at, default_playing_handicap_mode,
        default_playing_handicap_value, setup_locked,
        event_tee_time_id,
        courses(name)
      `)
      .eq("id", roundId)
      .single(),
    supabaseAdmin.rpc("get_round_setup_participants", { _round_id: roundId }),
    supabaseAdmin
      .from("round_teams")
      .select("id, name, team_number")
      .eq("round_id", roundId)
      .order("team_number", { ascending: true }),
  ]);

  if (roundRes.error) throw roundRes.error;
  if (!roundRes.data) return null;

  if (participantsRes.error) throw participantsRes.error;

  const round = roundRes.data as any;
  const rows = (participantsRes.data ?? []) as any[];
  const teams = (teamsRes.data ?? []) as any[];

  const profileIds = rows
    .filter((r: any) => !r.is_guest && r.profile_id)
    .map((r: any) => r.profile_id as string);

  // Build a map of profileId → pending_tee_box_id (per-player overrides)
  const participantTeeMap: Record<string, string> = {};
  for (const row of rows as any[]) {
    if (row.pending_tee_box_id && row.profile_id) {
      participantTeeMap[row.profile_id as string] = row.pending_tee_box_id as string;
    }
  }

  // Collect unique tee box IDs needed for handicap computation
  const teeBoxIdsNeeded = new Set<string>();
  if (round.pending_tee_box_id) teeBoxIdsNeeded.add(round.pending_tee_box_id);
  for (const teeId of Object.values(participantTeeMap)) teeBoxIdsNeeded.add(teeId);

  const [hiData, teeBoxesData] = await Promise.all([
    profileIds.length > 0
      ? supabaseAdmin
          .from("handicap_index_history")
          .select("profile_id, as_of_date, handicap_index")
          .in("profile_id", profileIds)
          .not("handicap_index", "is", null)
          .order("as_of_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    teeBoxIdsNeeded.size > 0
      ? supabaseAdmin
          .from("course_tee_boxes")
          .select("id, par, rating, slope")
          .in("id", [...teeBoxIdsNeeded])
      : Promise.resolve({ data: [], error: null }),
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

  // Build teeBoxId → { par, rating, slope }
  const teeBoxStats: Record<string, { par: number; rating: number; slope: number }> = {};
  for (const tb of (teeBoxesData.data ?? []) as any[]) {
    teeBoxStats[tb.id as string] = {
      par: Number(tb.par),
      rating: Number(tb.rating),
      slope: Number(tb.slope),
    };
  }

  // Compute per-player course handicap using their assigned tee (fallback: round default tee)
  const courseHandicaps: Record<string, number> = {};
  for (const pid of profileIds) {
    const hi = handicapIndexes[pid];
    if (hi == null) continue;
    const teeBoxId = participantTeeMap[pid] ?? round.pending_tee_box_id;
    const tee = teeBoxId ? teeBoxStats[teeBoxId] : null;
    if (!tee) continue;
    const { par, rating, slope } = tee;
    if (Number.isFinite(par) && Number.isFinite(rating) && Number.isFinite(slope)) {
      courseHandicaps[pid] = calcCourseHandicap(hi, slope, rating, par);
    }
  }

  // Live PREVIEW of each player's playing handicap (mirrors the round-start
  // resolver) so the setup UI can show PH before it's locked in. Keyed by
  // profile_id. `compare_against_lowest` needs the lowest CH across the field.
  const chValues = Object.values(courseHandicaps).filter((n) => Number.isFinite(n));
  const lowestCourseHandicap = chValues.length > 0 ? Math.min(...chValues) : null;

  const assignedHiByProfileId: Record<string, number> = {};
  for (const row of rows as any[]) {
    if (!row.profile_id) continue;
    // Resolver precedence: assigned_handicap_index, else legacy assigned_playing_handicap.
    const override = row.assigned_handicap_index ?? row.assigned_playing_handicap;
    if (override != null) {
      assignedHiByProfileId[row.profile_id as string] = Number(override);
    }
  }

  const playingHandicaps: Record<string, number> = {};
  for (const pid of profileIds) {
    const ph = resolvePlayingHandicapPreview({
      courseHandicap: courseHandicaps[pid] ?? null,
      assignedHandicapIndex: assignedHiByProfileId[pid] ?? null,
      mode: round.default_playing_handicap_mode,
      value: round.default_playing_handicap_value,
      lowestCourseHandicap,
    });
    if (ph != null) playingHandicaps[pid] = ph;
  }

  return {
    round,
    participants: rows,
    teams,
    handicap_indexes: handicapIndexes,
    course_handicaps: courseHandicaps,
    playing_handicaps: playingHandicaps,
  };
}
