import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// ── Types ────────────────────────────────────────────────────────────────────

export type CompetitionResult = {
  id: string;
  name: string | null;
  event_date: string | null;
  event_year: number | null;
  majors_status: string;
  competition_id: string | null;
  competition_name: string | null;
  winner: { profile_id: string; name: string | null; avatar_url: string | null } | null;
  winner_net_score: number | null;
};

export type PlayerSeriesRecord = {
  competition_id: string | null;
  competition_name: string | null;
  wins: number;
  best_finish: number | null;
  competition_count: number;
};

export type PlayerRecord = {
  profile_id: string;
  profile: { name: string | null; avatar_url: string | null };
  competition_records: PlayerSeriesRecord[];
  standalone_wins: { event_id: string; name: string | null; year: number | null }[];
  total_wins: number;
  career_points: number;
  career_events_played: number;
  career_total_gross_to_par: number | null;
  career_total_net_to_par: number | null;
  career_avg_gross_to_par: number | null;
  career_avg_net_to_par: number | null;
};

export type CompetitionResultsResponse = {
  events: CompetitionResult[];
  player_records: PlayerRecord[];
};

// ── Route ────────────────────────────────────────────────────────────────────

// GET /api/majors/groups/[id]/competition-results?year=YYYY
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id: groupId } = await params;

    const url = new URL(req.url);
    const filterYear = url.searchParams.get("year") ? Number(url.searchParams.get("year")) : null;

    // ── 1. Fetch events ─────────────────────────────────────────────
    let eventsQuery = supabaseAdmin
      .from("events")
      .select("id, name, event_date, event_year, majors_status, competition_id")
      .eq("group_id", groupId)
      .in("standings_contribution", ["season", "both"])
      .order("event_date", { ascending: true });
    if (filterYear) eventsQuery = eventsQuery.eq("event_year", filterYear);

    const { data: eventsData, error: eventsErr } = await eventsQuery;
    if (eventsErr) throw eventsErr;
    const evts = eventsData ?? [];

    // ── 2. Fetch competition names ─────────────────────────────────────────────
    const competitionIds = [...new Set(evts.map((c) => c.competition_id).filter(Boolean) as string[])];
    const competitionMap = new Map<string, string | null>();
    if (competitionIds.length > 0) {
      const { data: competitionsData } = await supabaseAdmin
        .from("competitions")
        .select("id, name")
        .in("id", competitionIds);
      for (const c of competitionsData ?? []) competitionMap.set(c.id, c.name);
    }

    // ── 3. Fetch leaderboard entries for completed events ───────────
    const completedIds = evts
      .filter((c) => ["completed", "official"].includes(c.majors_status))
      .map((c) => c.id);

    let entries: {
      event_id: string;
      profile_id: string;
      position: number;
      net_score: number | null;
      gross_score: number | null;
      points_earned: number | null;
      to_par: number | null;
      course_par: number | null;
      rounds_submitted: number | null;
    }[] = [];

    if (completedIds.length > 0) {
      const { data: entriesData, error: entriesErr } = await supabaseAdmin
        .from("event_leaderboard_entries")
        .select("event_id, profile_id, position, playoff_final_position, net_score, gross_score, points_earned, to_par, course_par, rounds_submitted")
        .in("event_id", completedIds)
        .eq("is_live", false)
        .not("position", "is", null);
      if (entriesErr) throw entriesErr;
      // Normalize to the effective finishing position: playoff-resolved ties keep
      // position=1 for every tied player, with the real order in playoff_final_position.
      entries = ((entriesData ?? []) as any[]).map((e) => ({
        ...e,
        position: e.playoff_final_position ?? e.position,
      })) as typeof entries;
    }

    // ── 4. Fetch all active group members + profiles ──────────────────────
    const { data: membershipsData } = await supabaseAdmin
      .from("major_group_memberships")
      .select("profile_id")
      .eq("group_id", groupId)
      .eq("status", "active");

    const memberProfileIds = (membershipsData ?? []).map((m) => m.profile_id).filter(Boolean) as string[];

    // Union with entry profile ids (in case someone played but isn't a current member)
    const allProfileIds = [
      ...new Set([...memberProfileIds, ...entries.map((e) => e.profile_id)]),
    ];

    const profileMap = new Map<string, { name: string | null; avatar_url: string | null }>();
    if (allProfileIds.length > 0) {
      const { data: profilesData } = await supabaseAdmin
        .from("profiles")
        .select("id, name, avatar_url")
        .in("id", allProfileIds);
      for (const p of profilesData ?? []) profileMap.set(p.id, { name: p.name, avatar_url: p.avatar_url });
    }

    // ── 5. Build CompetitionResult list ───────────────────────────────────
    const eventResults: CompetitionResult[] = evts.map((c) => {
      const winnerEntry = entries.find((e) => e.event_id === c.id && e.position === 1);
      const winnerProfile = winnerEntry ? profileMap.get(winnerEntry.profile_id) : null;
      return {
        id: c.id,
        name: c.name,
        event_date: c.event_date,
        event_year: c.event_year,
        majors_status: c.majors_status,
        competition_id: c.competition_id,
        competition_name: c.competition_id ? (competitionMap.get(c.competition_id) ?? null) : null,
        winner: winnerEntry && winnerProfile
          ? { profile_id: winnerEntry.profile_id, name: winnerProfile.name, avatar_url: winnerProfile.avatar_url }
          : null,
        winner_net_score: winnerEntry?.net_score ?? null,
      };
    });

    // ── 6. Build PlayerRecord list ────────────────────────────────────────
    // Group entries by profile_id then competition_id (null = standalone)
    type CompetitionAgg = { wins: number; best_finish: number; comp_count: number };
    const playerMap = new Map<string, Map<string | null, CompetitionAgg>>();

    type CareerAgg = {
      points: number; events: number;
      gross_to_par_sum: number; gross_events: number; gross_rounds: number;
      net_to_par_sum: number; net_events: number; net_rounds: number;
    };
    const careerMap = new Map<string, CareerAgg>();

    for (const entry of entries) {
      const evt = evts.find((c) => c.id === entry.event_id);
      const competitionId = evt?.competition_id ?? null;

      if (!playerMap.has(entry.profile_id)) playerMap.set(entry.profile_id, new Map());
      const competitionAggMap = playerMap.get(entry.profile_id)!;

      if (!competitionAggMap.has(competitionId)) {
        competitionAggMap.set(competitionId, { wins: 0, best_finish: 9999, comp_count: 0 });
      }
      const agg = competitionAggMap.get(competitionId)!;
      agg.comp_count += 1;
      if (entry.position === 1) agg.wins += 1;
      if (entry.position < agg.best_finish) agg.best_finish = entry.position;

      // Career stat aggregation
      if (!careerMap.has(entry.profile_id)) {
        careerMap.set(entry.profile_id, { points: 0, events: 0, gross_to_par_sum: 0, gross_events: 0, gross_rounds: 0, net_to_par_sum: 0, net_events: 0, net_rounds: 0 });
      }
      const career = careerMap.get(entry.profile_id)!;
      career.events += 1;
      if (entry.points_earned != null) career.points += entry.points_earned;
      const rounds = entry.rounds_submitted ?? 1;
      if (entry.gross_score != null && entry.course_par != null) {
        career.gross_to_par_sum += entry.gross_score - entry.course_par;
        career.gross_events += 1;
        career.gross_rounds += rounds;
      }
      if (entry.to_par != null) {
        career.net_to_par_sum += entry.to_par;
        career.net_events += 1;
        career.net_rounds += rounds;
      }
    }

    // Build a record for every active member (plus anyone with entries)
    const allMemberIds = [...new Set([...memberProfileIds, ...playerMap.keys()])];

    const playerRecords: PlayerRecord[] = allMemberIds.map((profileId) => {
      const competitionAggMap = playerMap.get(profileId) ?? new Map<string | null, CompetitionAgg>();
      const competitionRecords: PlayerSeriesRecord[] = [];
      const standaloneWins: PlayerRecord["standalone_wins"] = [];
      let total_wins = 0;

      for (const [competitionId, agg] of competitionAggMap) {
        total_wins += agg.wins;
        if (competitionId === null) {
          // Standalone events — list individual wins
          for (const e of entries.filter(
            (e) => e.profile_id === profileId && e.position === 1 && evts.find((c) => c.id === e.event_id)?.competition_id == null
          )) {
            const evt = evts.find((c) => c.id === e.event_id);
            standaloneWins.push({
              event_id: e.event_id,
              name: evt?.name ?? null,
              year: evt?.event_year ?? null,
            });
          }
        } else {
          competitionRecords.push({
            competition_id: competitionId,
            competition_name: competitionMap.get(competitionId) ?? null,
            wins: agg.wins,
            best_finish: agg.best_finish < 9999 ? agg.best_finish : null,
            competition_count: agg.comp_count,
          });
        }
      }

      // Sort competition records: ones with wins first, then by best_finish
      competitionRecords.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return (a.best_finish ?? 999) - (b.best_finish ?? 999);
      });

      const career = careerMap.get(profileId);
      const career_avg_gross_to_par = career && career.gross_rounds > 0
        ? Math.round((career.gross_to_par_sum / career.gross_rounds) * 10) / 10
        : null;
      const career_avg_net_to_par = career && career.net_rounds > 0
        ? Math.round((career.net_to_par_sum / career.net_rounds) * 10) / 10
        : null;

      return {
        profile_id: profileId,
        profile: profileMap.get(profileId) ?? { name: null, avatar_url: null },
        competition_records: competitionRecords,
        standalone_wins: standaloneWins,
        total_wins,
        career_points: career?.points ?? 0,
        career_events_played: career?.events ?? 0,
        career_total_gross_to_par: career && career.gross_events > 0 ? career.gross_to_par_sum : null,
        career_total_net_to_par: career && career.net_events > 0 ? career.net_to_par_sum : null,
        career_avg_gross_to_par,
        career_avg_net_to_par,
      };
    });

    // Sort by total wins descending, then alphabetically
    playerRecords.sort((a, b) => {
      if (b.total_wins !== a.total_wins) return b.total_wins - a.total_wins;
      return (a.profile.name ?? "").localeCompare(b.profile.name ?? "");
    });

    return NextResponse.json(
      { events: eventResults, player_records: playerRecords } satisfies CompetitionResultsResponse,
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
