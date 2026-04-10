import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  MajorGroup,
  MajorGroupMembershipWithProfile,
  CompetitionFull,
  CompetitionWithGroup,
  LeaderboardEntryWithProfile,
  GroupStandingWithProfile,
  MajorHubSummary,
  MajorScheduleItem,
  MajorHistoryItem,
  MajorProfileData,
} from "./types";

// ─── Groups ──────────────────────────────────────────────────────────────────

export async function getGroupById(groupId: string): Promise<MajorGroup | null> {
  const { data, error } = await supabaseAdmin
    .from("major_groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();
  if (error) throw error;
  return (data as MajorGroup) ?? null;
}

export async function getGroupsByProfile(
  profileId: string,
  status: "active" | "pending" | "invited" = "active"
): Promise<Array<MajorGroup & { member_count: number; role: string }>> {
  const { data, error } = await supabaseAdmin
    .from("major_group_memberships")
    .select("role, group:major_groups(*)")
    .eq("profile_id", profileId)
    .eq("status", status);
  if (error) throw error;

  const rows = (data ?? []) as any[];
  return rows
    .filter((r) => r.group)
    .map((r) => ({ ...(r.group as MajorGroup), role: r.role as string, member_count: 0 }));
}

export async function getGroupMemberCount(groupId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("major_group_memberships")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId)
    .eq("status", "active");
  if (error) throw error;
  return count ?? 0;
}

export async function getDiscoverGroups(
  limit = 20
): Promise<Array<MajorGroup & { member_count: number }>> {
  const { data, error } = await supabaseAdmin
    .from("major_groups")
    .select("*")
    .eq("privacy", "public")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as MajorGroup[]).map((g) => ({ ...g, member_count: 0 }));
}

export async function getGroupMembers(groupId: string): Promise<MajorGroupMembershipWithProfile[]> {
  const { data, error } = await supabaseAdmin
    .from("major_group_memberships")
    .select("*, profile:profiles(id, name, avatar_url)")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as MajorGroupMembershipWithProfile[];
}

// ─── Competitions ────────────────────────────────────────────────────────────

export async function getCompetitionById(competitionId: string): Promise<CompetitionWithGroup | null> {
  const { data, error } = await supabaseAdmin
    .from("competitions")
    .select("*, group:major_groups(id, name, ciaga_tag), course:courses(id, name)")
    .eq("id", competitionId)
    .maybeSingle();
  if (error) throw error;
  return (data as CompetitionWithGroup) ?? null;
}

export async function getCompetitionsByGroup(
  groupId: string
): Promise<CompetitionWithGroup[]> {
  const { data, error } = await supabaseAdmin
    .from("competitions")
    .select("*, group:major_groups(id, name, ciaga_tag), course:courses(id, name)")
    .eq("group_id", groupId)
    .order("competition_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CompetitionWithGroup[];
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export async function getCompetitionLeaderboard(
  competitionId: string
): Promise<LeaderboardEntryWithProfile[]> {
  const { data, error } = await supabaseAdmin
    .from("competition_leaderboard_entries")
    .select("*, profile:profiles(id, name, avatar_url)")
    .eq("competition_id", competitionId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as LeaderboardEntryWithProfile[];
}

export async function getGroupStandings(
  groupId: string
): Promise<GroupStandingWithProfile[]> {
  const { data, error } = await supabaseAdmin
    .from("major_group_standings")
    .select("*, profile:profiles(id, name, avatar_url)")
    .eq("group_id", groupId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as GroupStandingWithProfile[];
}

// ─── Schedule ────────────────────────────────────────────────────────────────

export async function getMajorSchedule(
  profileId: string,
  filters: {
    status?: string[];
    groupIds?: string[];
    cursor?: string;
    limit?: number;
  } = {}
): Promise<MajorScheduleItem[]> {
  const limit = filters.limit ?? 30;

  let query = supabaseAdmin
    .from("competitions")
    .select("*, group:major_groups(id, name, ciaga_tag), course:courses(id, name)")
    .order("competition_date", { ascending: true })
    .limit(limit);

  if (filters.status?.length) {
    query = query.in("majors_status", filters.status);
  }
  if (filters.groupIds?.length) {
    query = query.in("group_id", filters.groupIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const competitions = (data ?? []) as CompetitionWithGroup[];

  // Fetch which competitions this user has entered
  const compIds = competitions.map((c) => c.id);
  let enteredIds = new Set<string>();
  if (compIds.length > 0) {
    const { data: entries } = await supabaseAdmin
      .from("competition_entries")
      .select("competition_id")
      .eq("profile_id", profileId)
      .in("competition_id", compIds);
    enteredIds = new Set((entries ?? []).map((e: any) => e.competition_id as string));
  }

  const now = new Date();

  return competitions.map((c) => {
    let entry_status: MajorScheduleItem["entry_status"] = "open";
    if (enteredIds.has(c.id)) {
      entry_status = "entered";
    } else if (c.entry_window_end && new Date(c.entry_window_end) < now) {
      entry_status = "closed";
    } else if (c.majors_status === "completed" || c.majors_status === "cancelled") {
      entry_status = "closed";
    }
    return { ...c, entry_status };
  });
}

// ─── History ─────────────────────────────────────────────────────────────────

export async function getMajorHistory(
  profileId: string,
  cursor?: string,
  limit = 20
): Promise<MajorHistoryItem[]> {
  // Get competitions this user has leaderboard entries for (i.e., submitted a round)
  const { data: entries, error: entriesErr } = await supabaseAdmin
    .from("competition_leaderboard_entries")
    .select("*")
    .eq("profile_id", profileId)
    .order("computed_at", { ascending: false })
    .limit(limit);
  if (entriesErr) throw entriesErr;

  if (!entries?.length) return [];

  const compIds = (entries as any[]).map((e) => e.competition_id as string);

  const { data: comps, error: compsErr } = await supabaseAdmin
    .from("competitions")
    .select("*, group:major_groups(id, name, ciaga_tag), course:courses(id, name)")
    .in("id", compIds)
    .eq("majors_status", "completed");
  if (compsErr) throw compsErr;

  const compMap = new Map(((comps ?? []) as CompetitionWithGroup[]).map((c) => [c.id, c]));

  return (entries as any[])
    .filter((e) => compMap.has(e.competition_id))
    .map((e) => ({
      competition: compMap.get(e.competition_id)!,
      entry: {
        position: e.position as number | null,
        net_score: e.net_score as number | null,
        gross_score: e.gross_score as number | null,
        points_earned: e.points_earned as number | null,
      },
    }));
}

// ─── Majors Profile ───────────────────────────────────────────────────────────

export async function getMajorProfile(profileId: string): Promise<MajorProfileData> {
  const [profileRes, allEntries, memberships] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, name, avatar_url")
      .eq("id", profileId)
      .maybeSingle(),
    supabaseAdmin
      .from("competition_leaderboard_entries")
      .select("*")
      .eq("profile_id", profileId),
    supabaseAdmin
      .from("major_group_memberships")
      .select("role, group:major_groups(id, name, type, ciaga_tag)")
      .eq("profile_id", profileId)
      .eq("status", "active"),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (allEntries.error) throw allEntries.error;
  if (memberships.error) throw memberships.error;

  const profile = profileRes.data as any;
  const entries = (allEntries.data ?? []) as any[];

  const totalEvents = entries.length;
  const totalWins = entries.filter((e) => e.position === 1).length;
  const totalPodiums = entries.filter((e) => e.position != null && e.position <= 3).length;
  const totalPoints = entries.reduce((sum, e) => sum + (e.points_earned ?? 0), 0);
  const positions = entries.filter((e) => e.position != null).map((e) => e.position as number);
  const avgPosition =
    positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : null;

  // Get group standings for each membership
  const groupIds = (memberships.data ?? []).map((m: any) => m.group?.id).filter(Boolean) as string[];
  let standingsMap = new Map<string, { position: number | null; season_points: number }>();
  if (groupIds.length > 0) {
    const { data: standings } = await supabaseAdmin
      .from("major_group_standings")
      .select("group_id, position, season_points")
      .eq("profile_id", profileId)
      .in("group_id", groupIds);
    standingsMap = new Map(
      ((standings ?? []) as any[]).map((s) => [
        s.group_id as string,
        { position: s.position, season_points: s.season_points },
      ])
    );
  }

  // Recent results (last 5)
  const recentHistory = await getMajorHistory(profileId, undefined, 5);

  // Season summary: sum entries from competitions with competition_date in current year
  const thisYear = new Date().getFullYear().toString();
  const seasonEntryIds = entries.filter((e) => e.computed_at?.startsWith(thisYear));
  const seasonPoints = seasonEntryIds.reduce((s, e) => s + (e.points_earned ?? 0), 0);
  const seasonWins = seasonEntryIds.filter((e) => e.position === 1).length;
  const seasonPodiums = seasonEntryIds.filter((e) => e.position != null && e.position <= 3).length;

  return {
    profile: { id: profile?.id, name: profile?.name ?? null, avatar_url: profile?.avatar_url ?? null },
    season_summary: {
      points: seasonPoints,
      rank: null, // computed separately when needed
      events: seasonEntryIds.length,
      wins: seasonWins,
      podiums: seasonPodiums,
    },
    career: {
      total_events: totalEvents,
      total_wins: totalWins,
      total_podiums: totalPodiums,
      avg_position: avgPosition,
      total_points: totalPoints,
    },
    recent_results: recentHistory,
    group_memberships: (memberships.data ?? []).map((m: any) => ({
      group: m.group,
      role: m.role,
      standing: standingsMap.get(m.group?.id) ?? null,
    })),
  };
}

// ─── Hub Summary ─────────────────────────────────────────────────────────────

export async function getMajorHubSummary(profileId: string): Promise<MajorHubSummary> {
  const [myGroupRows, discoverGroups] = await Promise.all([
    getGroupsByProfile(profileId),
    getDiscoverGroups(6),
  ]);

  const myGroupIds = myGroupRows.map((g) => g.id);

  // Active and upcoming competitions across my groups
  let activeComps: CompetitionWithGroup[] = [];
  let upcomingComps: CompetitionWithGroup[] = [];

  if (myGroupIds.length > 0) {
    const { data: compData } = await supabaseAdmin
      .from("competitions")
      .select("*, group:major_groups(id, name, ciaga_tag), course:courses(id, name)")
      .in("group_id", myGroupIds)
      .in("majors_status", ["live", "upcoming"])
      .order("competition_date", { ascending: true })
      .limit(10);

    const comps = (compData ?? []) as CompetitionWithGroup[];
    activeComps = comps.filter((c) => c.majors_status === "live");
    upcomingComps = comps.filter((c) => c.majors_status === "upcoming");
  }

  // Season stats from group standings
  let seasonPoints = 0;
  let seasonRank: number | null = null;
  let eventsEntered = 0;
  let wins = 0;

  if (myGroupIds.length > 0) {
    const { data: standings } = await supabaseAdmin
      .from("major_group_standings")
      .select("season_points, wins, events_played, position")
      .eq("profile_id", profileId)
      .in("group_id", myGroupIds);

    const rows = (standings ?? []) as any[];
    seasonPoints = rows.reduce((s, r) => s + (r.season_points ?? 0), 0);
    wins = rows.reduce((s, r) => s + (r.wins ?? 0), 0);
    eventsEntered = rows.reduce((s, r) => s + (r.events_played ?? 0), 0);
    // Use best rank across groups
    const ranks = rows.map((r) => r.position as number | null).filter((p): p is number => p != null);
    if (ranks.length > 0) seasonRank = Math.min(...ranks);
  }

  // Filter discover groups to exclude already-joined ones
  const joinedGroupIds = new Set(myGroupIds);
  const filteredDiscover = discoverGroups.filter((g) => !joinedGroupIds.has(g.id));

  return {
    season_points: seasonPoints,
    season_rank: seasonRank,
    events_entered: eventsEntered,
    wins,
    active_competitions: activeComps,
    upcoming_competitions: upcomingComps,
    my_groups: myGroupRows.map((g) => ({ ...g, member_count: 0 })),
    discover_groups: filteredDiscover,
  };
}

// ─── Competition Series queries ──────────────────────────────────────────────

export async function getSeriesByGroup(groupId: string) {
  const { data, error } = await supabaseAdmin
    .from("competition_series")
    .select("*")
    .eq("group_id", groupId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getSeriesById(seriesId: string) {
  const { data, error } = await supabaseAdmin
    .from("competition_series")
    .select("*")
    .eq("id", seriesId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}
