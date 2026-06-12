import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  MajorGroup,
  MajorGroupMembershipWithProfile,
  EventWithGroup,
  LeaderboardEntryWithProfile,
  GroupStandingWithProfile,
  MajorHubSummary,
  MajorScheduleItem,
  MajorHistoryItem,
  MajorProfileData,
  CompetitionWithEventTemplates,
  CompetitionYearGroup,
  EventTemplateHistory,
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
  const groups = rows
    .filter((r) => r.group)
    .map((r) => ({ ...(r.group as MajorGroup), role: r.role as string }));
  const counts = await Promise.all(groups.map((g) => getGroupMemberCount(g.id)));
  return groups.map((g, i) => ({ ...g, member_count: counts[i] }));
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
  const groups = (data ?? []) as MajorGroup[];
  const counts = await Promise.all(groups.map((g) => getGroupMemberCount(g.id)));
  return groups.map((g, i) => ({ ...g, member_count: counts[i] }));
}

export async function getGroupMembers(groupId: string): Promise<MajorGroupMembershipWithProfile[]> {
  const { data, error } = await supabaseAdmin
    .from("major_group_memberships")
    .select("*, profile:profiles!profile_id(id, name, avatar_url, gender)")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });
  if (error) throw error;

  const members = (data ?? []) as unknown as MajorGroupMembershipWithProfile[];
  if (!members.length) return members;

  const profileIds = members.map((m) => m.profile_id);

  // Fetch current handicaps and group event participation in parallel
  const [handicapRes, participantRes] = await Promise.all([
    supabaseAdmin.rpc("get_current_handicaps", { ids: profileIds }),
    supabaseAdmin.rpc("get_group_event_participants", { p_group_id: groupId }),
  ]);

  const handicapMap = new Map<string, number>();
  for (const row of (handicapRes.data ?? []) as any[]) {
    if (row.profile_id && row.handicap_index != null) {
      handicapMap.set(row.profile_id, row.handicap_index);
    }
  }

  const participantMap = new Map<string, string | null>();
  for (const row of (participantRes.data ?? []) as any[]) {
    if (row.profile_id) participantMap.set(row.profile_id, row.first_participated_at ?? null);
  }

  return members.map((m) => ({
    ...m,
    handicap_index: handicapMap.get(m.profile_id) ?? null,
    has_participated: participantMap.has(m.profile_id),
    first_participated_at: participantMap.get(m.profile_id) ?? null,
  }));
}

// ─── Events ──────────────────────────────────────────────────────────────────

export async function getEventById(eventId: string): Promise<EventWithGroup | null> {
  const { data, error } = await supabaseAdmin
    .from("events")
    .select("*, group:major_groups(id, name, type, ciaga_tag), course:courses(id, name)")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  return (data as EventWithGroup) ?? null;
}

export async function getEventsByGroup(
  groupId: string
): Promise<EventWithGroup[]> {
  const { data, error } = await supabaseAdmin
    .from("events")
    .select("*, group:major_groups(id, name, type, ciaga_tag), course:courses(id, name)")
    .eq("group_id", groupId)
    .order("event_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventWithGroup[];
}

// ─── Participants & submissions ───────────────────────────────────────────────

export async function getEventParticipants(eventId: string): Promise<
  Array<{ profile_id: string; profile: { id: string; name: string | null; avatar_url: string | null } | null }>
> {
  const { data, error } = await supabaseAdmin
    .from("event_entries")
    .select("profile_id, profile:profiles(id, name, avatar_url)")
    .eq("event_id", eventId);
  if (error) throw error;
  return (data ?? []) as any;
}

export async function getEventSubmissionMap(eventId: string): Promise<Record<string, string>> {
  const { data, error } = await supabaseAdmin
    .from("event_round_submissions")
    .select("profile_id, round_id")
    .eq("event_id", eventId)
    .eq("accepted", true);
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if ((row as any).round_id) map[(row as any).profile_id] = (row as any).round_id;
  }
  return map;
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export async function getEventLeaderboard(
  eventId: string
): Promise<LeaderboardEntryWithProfile[]> {
  const { data, error } = await supabaseAdmin
    .from("event_leaderboard_entries")
    .select("*, profile:profiles(id, name, avatar_url)")
    .eq("event_id", eventId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as LeaderboardEntryWithProfile[];
}

export async function getEventPendingParticipants(
  eventId: string,
  scoredProfileIds: Set<string>
): Promise<Array<{ profile_id: string; name: string | null; avatar_url: string | null; tee_time: string }>> {
  // Use the reliable FK direction: event_tee_times.round_id → rounds.id
  // (rounds.event_tee_time_id is a back-link set without error handling and may be NULL)
  const { data: teeTimes, error: ttErr } = await supabaseAdmin
    .from("event_tee_times")
    .select("id, tee_time, round_id")
    .eq("event_id", eventId);
  if (ttErr) throw ttErr;

  const roundIds = (teeTimes ?? []).map((t) => (t as any).round_id).filter(Boolean) as string[];
  if (!roundIds.length) return [];

  const teeTimeByRoundId = new Map<string, string>();
  for (const tt of teeTimes ?? []) {
    if ((tt as any).round_id) teeTimeByRoundId.set((tt as any).round_id, (tt as any).tee_time);
  }

  const { data: participants, error: partErr } = await supabaseAdmin
    .from("round_participants")
    .select("round_id, profile_id, profile:profiles(id, name, avatar_url)")
    .in("round_id", roundIds)
    .eq("is_guest", false)
    .not("profile_id", "is", null);
  if (partErr) throw partErr;

  const results: Array<{ profile_id: string; name: string | null; avatar_url: string | null; tee_time: string }> = [];
  const seen = new Set<string>();

  for (const rp of participants ?? []) {
    const profileId = (rp as any).profile_id as string;
    const teeTime = teeTimeByRoundId.get((rp as any).round_id);
    if (!profileId || !teeTime || scoredProfileIds.has(profileId) || seen.has(profileId)) continue;
    seen.add(profileId);
    results.push({
      profile_id: profileId,
      name: (rp as any).profile?.name ?? null,
      avatar_url: (rp as any).profile?.avatar_url ?? null,
      tee_time: teeTime,
    });
  }

  return results;
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
    .from("events")
    .select("*, group:major_groups(id, name, type, ciaga_tag), course:courses(id, name)")
    .order("event_date", { ascending: true })
    .limit(limit);

  if (filters.status?.length) {
    query = query.in("majors_status", filters.status);
  }
  if (filters.groupIds?.length) {
    query = query.in("group_id", filters.groupIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const events = (data ?? []) as EventWithGroup[];

  // Fetch which events this user has entered
  const eventIds = events.map((c) => c.id);
  let enteredIds = new Set<string>();
  if (eventIds.length > 0) {
    const { data: entries } = await supabaseAdmin
      .from("event_entries")
      .select("event_id")
      .eq("profile_id", profileId)
      .in("event_id", eventIds);
    enteredIds = new Set((entries ?? []).map((e: any) => e.event_id as string));
  }

  const now = new Date();

  return events.map((c) => {
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
  // Get events this user has leaderboard entries for (i.e., submitted a round)
  const { data: entries, error: entriesErr } = await supabaseAdmin
    .from("event_leaderboard_entries")
    .select("*")
    .eq("profile_id", profileId)
    .order("computed_at", { ascending: false })
    .limit(limit);
  if (entriesErr) throw entriesErr;

  if (!entries?.length) return [];

  const eventIds = (entries as any[]).map((e) => e.event_id as string);

  const { data: evts, error: evtsErr } = await supabaseAdmin
    .from("events")
    .select("*, group:major_groups(id, name, type, ciaga_tag), course:courses(id, name)")
    .in("id", eventIds)
    .eq("majors_status", "completed");
  if (evtsErr) throw evtsErr;

  const eventMap = new Map(((evts ?? []) as EventWithGroup[]).map((c) => [c.id, c]));

  return (entries as any[])
    .filter((e) => eventMap.has(e.event_id))
    .map((e) => ({
      event: eventMap.get(e.event_id)!,
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
      .from("event_leaderboard_entries")
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

  // Season summary: sum entries from events with event_date in current year
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
  const [myGroupRows, discoverGroups, inviteRes] = await Promise.all([
    getGroupsByProfile(profileId),
    getDiscoverGroups(6),
    supabaseAdmin
      .from("major_group_memberships")
      .select("group_id, group:major_groups!group_id(id, name, image_url)")
      .eq("profile_id", profileId)
      .eq("status", "invited"),
  ]);

  const myGroupIds = myGroupRows.map((g) => g.id);
  const myGroupMemberCounts = await Promise.all(myGroupRows.map((g) => getGroupMemberCount(g.id)));

  // Active and upcoming events across my groups
  let activeEvents: EventWithGroup[] = [];
  let upcomingEvents: EventWithGroup[] = [];

  if (myGroupIds.length > 0) {
    const { data: eventData } = await supabaseAdmin
      .from("events")
      .select("*, group:major_groups(id, name, type, ciaga_tag), course:courses(id, name)")
      .in("group_id", myGroupIds)
      .in("majors_status", ["live", "upcoming"])
      .order("event_date", { ascending: true })
      .limit(10);

    const evts = (eventData ?? []) as EventWithGroup[];
    activeEvents = evts.filter((c) => c.majors_status === "live");
    upcomingEvents = evts.filter((c) => c.majors_status === "upcoming");
  }

  // Build event→group map for user's groups
  const eventIdToGroupId = new Map<string, string>();
  if (myGroupIds.length > 0) {
    const { data: groupEvents } = await supabaseAdmin
      .from("events")
      .select("id, group_id")
      .in("group_id", myGroupIds);
    for (const e of groupEvents ?? []) {
      eventIdToGroupId.set(e.id as string, e.group_id as string);
    }
  }
  const groupEventIds = [...eventIdToGroupId.keys()];

  // ── Season scoping ────────────────────────────────────────────────────────
  // Find the current group_season per group (live > published > completed > archived,
  // then latest season_year). Scopes "season" stats away from all-time aggregates.
  const currentSeasonByGroup = new Map<string, string>(); // group_id → group_season_id
  let currentSeasonIds: string[] = [];

  if (myGroupIds.length > 0) {
    const { data: groupSeasonRows } = await supabaseAdmin
      .from("group_seasons")
      .select("id, group_id, status, season_year, start_date, end_date, created_at")
      .in("group_id", myGroupIds)
      .in("status", ["live", "published", "completed", "archived"]);

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const effectiveYear = (gs: any): number => {
      if (gs.season_year) return gs.season_year;
      if (gs.start_date) return new Date(gs.start_date).getFullYear();
      return new Date(gs.created_at).getFullYear();
    };

    const gsPriority: Record<string, number> = { live: 0, published: 1, completed: 2, archived: 3 };

    // Group rows by group_id for per-group selection
    const rowsByGroup = new Map<string, any[]>();
    for (const gs of groupSeasonRows ?? []) {
      if (!rowsByGroup.has(gs.group_id)) rowsByGroup.set(gs.group_id, []);
      rowsByGroup.get(gs.group_id)!.push(gs);
    }

    for (const [groupId, seasons] of rowsByGroup) {
      // 1. Prefer a season whose date range contains today
      const current = seasons.find(
        (gs) => gs.start_date && gs.end_date && gs.start_date <= today && today <= gs.end_date
      );
      if (current) {
        currentSeasonByGroup.set(groupId, current.id);
        continue;
      }
      // 2. Fall back: most recent by effective year, then status priority
      const sorted = [...seasons].sort((a, b) => {
        const ya = effectiveYear(a), yb = effectiveYear(b);
        if (ya !== yb) return yb - ya;
        return (gsPriority[a.status] ?? 99) - (gsPriority[b.status] ?? 99);
      });
      currentSeasonByGroup.set(groupId, sorted[0].id);
    }
    currentSeasonIds = [...currentSeasonByGroup.values()];
  }

  // Fetch all data in parallel
  const [lbRes, winRes, allLbRes, allWinRes, gsStandingsRes, seasonEventsRes, potPayoutsRes] = await Promise.all([
    groupEventIds.length > 0
      ? supabaseAdmin
          .from("event_leaderboard_entries")
          .select("event_id, rounds_submitted")
          .eq("profile_id", profileId)
          .in("event_id", groupEventIds)
      : Promise.resolve({ data: [] }),
    groupEventIds.length > 0
      ? supabaseAdmin
          .from("event_winnings")
          .select("event_id, amount")
          .eq("profile_id", profileId)
          .in("event_id", groupEventIds)
      : Promise.resolve({ data: [] }),
    supabaseAdmin
      .from("event_leaderboard_entries")
      .select("event_id, rounds_submitted, position")
      .eq("profile_id", profileId),
    supabaseAdmin
      .from("event_winnings")
      .select("amount")
      .eq("profile_id", profileId),
    currentSeasonIds.length > 0
      ? supabaseAdmin
          .from("group_season_standings_entries")
          .select("group_season_id, position, season_points, events_played, wins")
          .in("group_season_id", currentSeasonIds)
          .eq("profile_id", profileId)
      : Promise.resolve({ data: [] }),
    currentSeasonIds.length > 0
      ? supabaseAdmin
          .from("events")
          .select("id")
          .in("group_season_id", currentSeasonIds)
      : Promise.resolve({ data: [] }),
    myGroupIds.length > 0
      ? supabaseAdmin
          .from("prize_pot_payouts")
          .select("amount, prize_pot:prize_pots(group_id, group_season_id, event_id)")
          .eq("profile_id", profileId)
      : Promise.resolve({ data: [] }),
  ]);

  const lbRows = (lbRes.data ?? []) as any[];
  const winRows = (winRes.data ?? []) as any[];
  const allLbRows = (allLbRes.data ?? []) as any[];
  const allWinRows = (allWinRes.data ?? []) as any[];

  const gsStandingsMap = new Map<string, any>(
    ((gsStandingsRes.data ?? []) as any[]).map((s: any) => [s.group_season_id, s])
  );
  const seasonEventIdSet = new Set<string>(
    ((seasonEventsRes.data ?? []) as any[]).map((e: any) => e.id as string)
  );
  const potPayoutRows = (potPayoutsRes.data ?? []) as any[];

  // Build per-group stats (season-scoped: events/wins/points/earnings from current season only)
  const group_stats = myGroupRows
    .map((g) => {
      const groupSeasonId = currentSeasonByGroup.get(g.id);
      const gsStat = groupSeasonId ? gsStandingsMap.get(groupSeasonId) : null;
      const gLbRows = lbRows.filter((r: any) => {
        if (eventIdToGroupId.get(r.event_id) !== g.id) return false;
        return groupSeasonId ? seasonEventIdSet.has(r.event_id) : true;
      });
      const gWinRows = winRows.filter((r: any) => {
        if (eventIdToGroupId.get(r.event_id) !== g.id) return false;
        return groupSeasonId ? seasonEventIdSet.has(r.event_id) : true;
      });
      const gPotRows = potPayoutRows.filter((r: any) => {
        const pot = r.prize_pot;
        if (pot?.group_id !== g.id) return false;
        if (!groupSeasonId) return true;
        return pot.group_season_id === groupSeasonId || seasonEventIdSet.has(pot.event_id);
      });
      return {
        group_id: g.id,
        group_name: g.name,
        group_image_url: (g as any).image_url ?? null,
        events: gsStat?.events_played ?? 0,
        rounds_played: gLbRows.reduce((s: number, r: any) => s + (r.rounds_submitted ?? 0), 0),
        wins: gsStat?.wins ?? 0,
        earnings: gWinRows.reduce((s: number, r: any) => s + (r.amount ?? 0), 0)
          + gPotRows.reduce((s: number, r: any) => s + (r.amount ?? 0), 0),
        season_points: gsStat?.season_points ?? 0,
        season_rank: gsStat?.position ?? null,
      };
    })
    .sort((a, b) => b.events - a.events);

  const season_events = group_stats.reduce((s, g) => s + g.events, 0);
  const season_rounds_played = group_stats.reduce((s, g) => s + g.rounds_played, 0);
  const season_wins = group_stats.reduce((s, g) => s + g.wins, 0);
  const season_earnings = group_stats.reduce((s, g) => s + g.earnings, 0);

  const alltime_events = new Set(allLbRows.map((r: any) => r.event_id)).size;
  const alltime_rounds_played = allLbRows.reduce((s: number, r: any) => s + (r.rounds_submitted ?? 0), 0);
  const alltime_wins = allLbRows.filter((r: any) => r.position === 1).length;
  const alltime_earnings = allWinRows.reduce((s: number, r: any) => s + (r.amount ?? 0), 0)
    + potPayoutRows.reduce((s: number, r: any) => s + (r.amount ?? 0), 0);

  // Filter discover groups to exclude already-joined ones
  const joinedGroupIds = new Set(myGroupIds);
  const filteredDiscover = discoverGroups.filter((g) => !joinedGroupIds.has(g.id));

  const pending_invites = ((inviteRes.data ?? []) as any[])
    .filter((r) => r.group)
    .map((r) => ({ group_id: r.group_id as string, group: r.group as { id: string; name: string; image_url: string | null } }));

  return {
    season_events,
    season_rounds_played,
    season_wins,
    season_earnings,
    alltime_events,
    alltime_rounds_played,
    alltime_wins,
    alltime_earnings,
    group_stats,
    active_events: activeEvents,
    upcoming_events: upcomingEvents,
    my_groups: myGroupRows.map((g, i) => ({ ...g, member_count: myGroupMemberCounts[i] })),
    discover_groups: filteredDiscover,
    pending_invites,
  };
}

// ─── Competitions queries ─────────────────────────────────────────────────────

export async function getCompetitionsByGroup(groupId: string) {
  const { data, error } = await supabaseAdmin
    .from("competitions")
    .select("*")
    .eq("group_id", groupId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getCompetitionById(competitionId: string) {
  const { data, error } = await supabaseAdmin
    .from("competitions")
    .select("*")
    .eq("id", competitionId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function getCompetitionWithEventTemplates(competitionId: string): Promise<CompetitionWithEventTemplates | null> {
  const { data, error } = await supabaseAdmin
    .from("competitions")
    .select("*, event_templates:competition_event_templates(*)")
    .eq("id", competitionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as any;
  const eventTemplates = (row.event_templates ?? []).sort(
    (a: any, b: any) => a.sort_order - b.sort_order
  );
  return { ...row, event_templates: eventTemplates } as CompetitionWithEventTemplates;
}

export async function getCompetitionHistory(competitionId: string): Promise<CompetitionYearGroup[]> {
  // Fetch all events in this competition with their group/course
  const { data: evts, error: evtsErr } = await supabaseAdmin
    .from("events")
    .select("*, group:major_groups(id, name, type, ciaga_tag), course:courses(id, name), event_template:competition_event_templates(id, name, sort_order)")
    .eq("competition_id", competitionId)
    .order("event_date", { ascending: true });
  if (evtsErr) throw evtsErr;

  const events = (evts ?? []) as any[];
  if (events.length === 0) return [];

  // Fetch P1 leaderboard entries for all these events
  const eventIds = events.map((c) => c.id as string);
  const { data: leaderboard, error: lbErr } = await supabaseAdmin
    .from("event_leaderboard_entries")
    .select("event_id, profile_id, position, net_score, profile:profiles(id, name, avatar_url)")
    .in("event_id", eventIds)
    .eq("position", 1);
  if (lbErr) throw lbErr;

  const winnerMap = new Map<string, any>();
  for (const entry of (leaderboard ?? []) as any[]) {
    winnerMap.set(entry.event_id, {
      profile_id: entry.profile_id,
      name: entry.profile?.name ?? null,
      avatar_url: entry.profile?.avatar_url ?? null,
      net_score: entry.net_score,
    });
  }

  // Group by year
  const yearMap = new Map<number, CompetitionYearGroup["events"]>();
  for (const evt of events) {
    const year = (evt.event_year ?? new Date(evt.event_date ?? "").getFullYear()) as number;
    if (!yearMap.has(year)) yearMap.set(year, []);
    yearMap.get(year)!.push({
      event: evt as EventWithGroup,
      event_template: evt.event_template ?? null,
      winner: winnerMap.get(evt.id) ?? null,
    });
  }

  return Array.from(yearMap.entries())
    .sort(([a], [b]) => b - a) // newest first
    .map(([year, evts]) => ({
      year,
      events: evts.sort((a, b) => {
        const aOrder = a.event_template?.sort_order ?? 999;
        const bOrder = b.event_template?.sort_order ?? 999;
        return aOrder - bOrder;
      }),
    }));
}

export async function getPlayerCompetitionHistory(profileId: string, competitionId: string) {
  // All events in the competition
  const { data: evts, error: evtsErr } = await supabaseAdmin
    .from("events")
    .select("id, name, event_date, event_year, majors_status, competition_event_template_id, event_template:competition_event_templates(id, name, sort_order)")
    .eq("competition_id", competitionId)
    .order("event_date", { ascending: false });
  if (evtsErr) throw evtsErr;

  const events = (evts ?? []) as any[];
  if (events.length === 0) return [];

  const eventIds = events.map((c) => c.id as string);

  const { data: entries, error: entriesErr } = await supabaseAdmin
    .from("event_leaderboard_entries")
    .select("event_id, position, net_score, gross_score, points_earned")
    .eq("profile_id", profileId)
    .in("event_id", eventIds);
  if (entriesErr) throw entriesErr;

  const entryMap = new Map<string, any>();
  for (const e of (entries ?? []) as any[]) {
    entryMap.set(e.event_id, e);
  }

  return events.map((c) => ({
    event: c,
    entry: entryMap.get(c.id) ?? null,
  }));
}


// ─── Event history summaries ──────────────────────────────────────────────────

export async function getEventHistorySummaries(eventTemplateId: string) {
  const { data, error } = await supabaseAdmin
    .from("event_history_summaries")
    .select(`
      *,
      winner:profiles!winner_profile_id(id, name, avatar_url),
      runner_up:profiles!runner_up_profile_id(id, name, avatar_url),
      event:events(id, name, event_date, majors_status)
    `)
    .eq("competition_event_template_id", eventTemplateId)
    .order("season_year", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─── Profile event stats ──────────────────────────────────────────────────────

export async function getProfileEventStats(profileId: string, groupId?: string, competitionId?: string) {
  let query = supabaseAdmin
    .from("profile_event_stats")
    .select("*")
    .eq("profile_id", profileId);

  if (groupId) {
    query = query.eq("group_id", groupId);
  } else if (competitionId) {
    query = query.eq("competition_id", competitionId);
  } else {
    query = query.is("group_id", null).is("competition_id", null);
  }

  const { data } = await query.maybeSingle();
  return data ?? null;
}

export async function getEventTemplateHistory(
  eventTemplateId: string,
  viewerProfileId?: string
): Promise<EventTemplateHistory | null> {
  // Fetch the event template
  const { data: templateData, error: tmplErr } = await supabaseAdmin
    .from("competition_event_templates")
    .select("*")
    .eq("id", eventTemplateId)
    .maybeSingle();
  if (tmplErr) throw tmplErr;
  if (!templateData) return null;

  // Fetch all events linked to this event template
  const { data: evts, error: evtsErr } = await supabaseAdmin
    .from("events")
    .select("id, name, event_date, event_year, majors_status")
    .eq("competition_event_template_id", eventTemplateId)
    .order("event_date", { ascending: false });
  if (evtsErr) throw evtsErr;

  const events = (evts ?? []) as any[];
  if (events.length === 0) {
    return { event_template: templateData as any, results: [] };
  }

  const eventIds = events.map((c) => c.id as string);

  // Winners (position 1)
  const { data: winners } = await supabaseAdmin
    .from("event_leaderboard_entries")
    .select("event_id, profile_id, net_score, profile:profiles(id, name)")
    .in("event_id", eventIds)
    .eq("position", 1);

  const winnerMap = new Map<string, any>();
  for (const w of (winners ?? []) as any[]) {
    winnerMap.set(w.event_id, {
      profile_id: w.profile_id,
      name: w.profile?.name ?? null,
      net_score: w.net_score,
    });
  }

  // Viewer's own entries
  let viewerEntryMap = new Map<string, any>();
  if (viewerProfileId) {
    const { data: viewerEntries } = await supabaseAdmin
      .from("event_leaderboard_entries")
      .select("event_id, position, net_score, gross_score")
      .eq("profile_id", viewerProfileId)
      .in("event_id", eventIds);
    for (const e of (viewerEntries ?? []) as any[]) {
      viewerEntryMap.set(e.event_id, e);
    }
  }

  const results = events.map((c) => ({
    year: (c.event_year ?? new Date(c.event_date ?? "").getFullYear()) as number,
    event: c,
    winner: winnerMap.get(c.id) ?? null,
    entry: viewerEntryMap.get(c.id) ?? null,
  }));

  return { event_template: templateData as any, results };
}
