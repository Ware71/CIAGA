import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// ── Types ────────────────────────────────────────────────────────────────────

export type CompetitionResult = {
  id: string;
  name: string | null;
  competition_date: string | null;
  competition_year: number | null;
  majors_status: string;
  series_id: string | null;
  series_name: string | null;
  winner: { profile_id: string; name: string | null; avatar_url: string | null } | null;
  winner_net_score: number | null;
};

export type PlayerSeriesRecord = {
  series_id: string | null;
  series_name: string | null;
  wins: number;
  best_finish: number | null;
  competition_count: number;
};

export type PlayerRecord = {
  profile_id: string;
  profile: { name: string | null; avatar_url: string | null };
  series_records: PlayerSeriesRecord[];
  standalone_wins: { competition_id: string; name: string | null; year: number | null }[];
  total_wins: number;
};

export type CompetitionResultsResponse = {
  competitions: CompetitionResult[];
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

    // ── 1. Fetch competitions ─────────────────────────────────────────────
    let compsQuery = supabaseAdmin
      .from("competitions")
      .select("id, name, competition_date, competition_year, majors_status, series_id")
      .eq("group_id", groupId)
      .in("standings_contribution", ["season", "both"])
      .order("competition_date", { ascending: true });
    if (filterYear) compsQuery = compsQuery.eq("competition_year", filterYear);

    const { data: compsData, error: compsErr } = await compsQuery;
    if (compsErr) throw compsErr;
    const comps = compsData ?? [];

    // ── 2. Fetch series names ─────────────────────────────────────────────
    const seriesIds = [...new Set(comps.map((c) => c.series_id).filter(Boolean) as string[])];
    const seriesMap = new Map<string, string | null>();
    if (seriesIds.length > 0) {
      const { data: seriesData } = await supabaseAdmin
        .from("competition_series")
        .select("id, name")
        .in("id", seriesIds);
      for (const s of seriesData ?? []) seriesMap.set(s.id, s.name);
    }

    // ── 3. Fetch leaderboard entries for completed competitions ───────────
    const completedIds = comps
      .filter((c) => ["completed", "official"].includes(c.majors_status))
      .map((c) => c.id);

    let entries: {
      competition_id: string;
      profile_id: string;
      position: number;
      net_score: number | null;
      gross_score: number | null;
    }[] = [];

    if (completedIds.length > 0) {
      const { data: entriesData, error: entriesErr } = await supabaseAdmin
        .from("competition_leaderboard_entries")
        .select("competition_id, profile_id, position, net_score, gross_score")
        .in("competition_id", completedIds)
        .eq("is_live", false)
        .not("position", "is", null);
      if (entriesErr) throw entriesErr;
      entries = (entriesData ?? []) as typeof entries;
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
    const competitionResults: CompetitionResult[] = comps.map((c) => {
      const winnerEntry = entries.find((e) => e.competition_id === c.id && e.position === 1);
      const winnerProfile = winnerEntry ? profileMap.get(winnerEntry.profile_id) : null;
      return {
        id: c.id,
        name: c.name,
        competition_date: c.competition_date,
        competition_year: c.competition_year,
        majors_status: c.majors_status,
        series_id: c.series_id,
        series_name: c.series_id ? (seriesMap.get(c.series_id) ?? null) : null,
        winner: winnerEntry && winnerProfile
          ? { profile_id: winnerEntry.profile_id, name: winnerProfile.name, avatar_url: winnerProfile.avatar_url }
          : null,
        winner_net_score: winnerEntry?.net_score ?? null,
      };
    });

    // ── 6. Build PlayerRecord list ────────────────────────────────────────
    // Group entries by profile_id then series_id (null = standalone)
    type SeriesAgg = { wins: number; best_finish: number; comp_count: number };
    const playerMap = new Map<string, Map<string | null, SeriesAgg>>();

    for (const entry of entries) {
      const comp = comps.find((c) => c.id === entry.competition_id);
      const seriesId = comp?.series_id ?? null;

      if (!playerMap.has(entry.profile_id)) playerMap.set(entry.profile_id, new Map());
      const seriesAggMap = playerMap.get(entry.profile_id)!;

      if (!seriesAggMap.has(seriesId)) {
        seriesAggMap.set(seriesId, { wins: 0, best_finish: 9999, comp_count: 0 });
      }
      const agg = seriesAggMap.get(seriesId)!;
      agg.comp_count += 1;
      if (entry.position === 1) agg.wins += 1;
      if (entry.position < agg.best_finish) agg.best_finish = entry.position;
    }

    // Build a record for every active member (plus anyone with entries)
    const allMemberIds = [...new Set([...memberProfileIds, ...playerMap.keys()])];

    const playerRecords: PlayerRecord[] = allMemberIds.map((profileId) => {
      const seriesAggMap = playerMap.get(profileId) ?? new Map<string | null, SeriesAgg>();
      const seriesRecords: PlayerSeriesRecord[] = [];
      const standaloneWins: PlayerRecord["standalone_wins"] = [];
      let total_wins = 0;

      for (const [seriesId, agg] of seriesAggMap) {
        total_wins += agg.wins;
        if (seriesId === null) {
          // Standalone competitions — list individual wins
          for (const e of entries.filter(
            (e) => e.profile_id === profileId && e.position === 1 && comps.find((c) => c.id === e.competition_id)?.series_id == null
          )) {
            const comp = comps.find((c) => c.id === e.competition_id);
            standaloneWins.push({
              competition_id: e.competition_id,
              name: comp?.name ?? null,
              year: comp?.competition_year ?? null,
            });
          }
        } else {
          seriesRecords.push({
            series_id: seriesId,
            series_name: seriesMap.get(seriesId) ?? null,
            wins: agg.wins,
            best_finish: agg.best_finish < 9999 ? agg.best_finish : null,
            competition_count: agg.comp_count,
          });
        }
      }

      // Sort series records: ones with wins first, then by best_finish
      seriesRecords.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return (a.best_finish ?? 999) - (b.best_finish ?? 999);
      });

      return {
        profile_id: profileId,
        profile: profileMap.get(profileId) ?? { name: null, avatar_url: null },
        series_records: seriesRecords,
        standalone_wins: standaloneWins,
        total_wins,
      };
    });

    // Sort by total wins descending, then alphabetically
    playerRecords.sort((a, b) => {
      if (b.total_wins !== a.total_wins) return b.total_wins - a.total_wins;
      return (a.profile.name ?? "").localeCompare(b.profile.name ?? "");
    });

    return NextResponse.json(
      { competitions: competitionResults, player_records: playerRecords } satisfies CompetitionResultsResponse,
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
