import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Query bodies lifted out of the `/api/majors/events/[id]/*` GET handlers so
 * both the routes and the server-rendered event page can call them.
 *
 * These are verbatim extractions — the routes now delegate here, and the page
 * composes them in `getEventDetailSnapshot`. Keeping one implementation means
 * the server-prefetched payload and the client refetch can't drift.
 */

/** Tee times with their event round and linked round + participants resolved. */
export async function getEventTeeTimes(eventId: string): Promise<any[]> {
  const { data: teeTimes, error } = await supabaseAdmin
    .from("event_tee_times")
    .select("*")
    .eq("event_id", eventId)
    .order("tee_time", { ascending: true });

  if (error) throw error;
  if (!teeTimes || teeTimes.length === 0) return [];

  // Event rounds give each tee time its grouping context.
  const { data: eventRounds } = await supabaseAdmin
    .from("event_rounds")
    .select("id, round_number, name, scheduled_date")
    .eq("event_id", eventId);

  const eventRoundById: Record<
    string,
    { id: string; round_number: number; name: string; scheduled_date: string | null }
  > = Object.fromEntries((eventRounds ?? []).map((r: any) => [r.id, r]));

  const roundIds = teeTimes.map((t) => t.round_id).filter(Boolean) as string[];
  const roundMap: Record<string, { id: string; status: string; participants: any[] }> = {};

  if (roundIds.length > 0) {
    const [{ data: participants }, { data: rounds }] = await Promise.all([
      supabaseAdmin
        .from("round_participants")
        .select(`
          round_id,
          profile_id,
          is_guest,
          display_name,
          role,
          profiles:profile_id (id, name, avatar_url)
        `)
        .in("round_id", roundIds),
      supabaseAdmin.from("rounds").select("id, status").in("id", roundIds),
    ]);

    for (const round of rounds ?? []) {
      roundMap[round.id] = { id: round.id, status: round.status, participants: [] };
    }

    for (const p of participants ?? []) {
      if (roundMap[p.round_id]) {
        roundMap[p.round_id].participants.push({
          profile_id: p.profile_id,
          is_guest: p.is_guest,
          display_name: p.display_name,
          role: p.role,
          profile: p.profiles ?? null,
        });
      }
    }
  }

  return teeTimes.map((t) => ({
    ...t,
    event_round: t.event_round_id ? (eventRoundById[t.event_round_id] ?? null) : null,
    round: t.round_id ? (roundMap[t.round_id] ?? null) : null,
  }));
}

/** Event rounds with course and default tee boxes joined. */
export async function getEventRounds(eventId: string): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from("event_rounds")
    .select(`
      *,
      course:courses(id, name),
      tee_male:course_tee_boxes!event_rounds_default_tee_box_id_male_fkey(id, name),
      tee_female:course_tee_boxes!event_rounds_default_tee_box_id_female_fkey(id, name)
    `)
    .eq("event_id", eventId)
    .order("round_number", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/** Manual winnings plus prize-pot payouts, merged and ordered by position. */
export async function getEventWinnings(eventId: string): Promise<any[]> {
  const [{ data: manualWinnings, error }, { data: eventPots }] = await Promise.all([
    supabaseAdmin
      .from("event_winnings")
      .select(`
        id, event_id, profile_id, position, amount, note, recorded_by, created_at,
        profile:profiles!profile_id(id, name, avatar_url)
      `)
      .eq("event_id", eventId)
      .order("position", { ascending: true, nullsFirst: false }),
    supabaseAdmin.from("prize_pots").select("id, name").eq("event_id", eventId),
  ]);

  if (error) throw error;

  const potIds = (eventPots ?? []).map((p: any) => p.id as string);
  const potNameMap = new Map((eventPots ?? []).map((p: any) => [p.id as string, p.name as string]));

  let potWinnings: any[] = [];
  if (potIds.length > 0) {
    const { data: potPayouts } = await supabaseAdmin
      .from("prize_pot_payouts")
      .select(`
        id, prize_pot_id, profile_id, position, amount, recorded_at,
        profile:profiles!profile_id(id, name, avatar_url)
      `)
      .in("prize_pot_id", potIds)
      .order("position", { ascending: true, nullsFirst: false });

    potWinnings = (potPayouts ?? []).map((p: any) => ({
      ...p,
      event_id: eventId,
      note: potNameMap.get(p.prize_pot_id) ?? null,
      recorded_by: null,
      created_at: p.recorded_at,
      source: "pot",
    }));
  }

  return [...(manualWinnings ?? []), ...potWinnings].sort(
    (a, b) => (a.position ?? 9999) - (b.position ?? 9999)
  );
}

/**
 * Waitlist entries, earliest first.
 *
 * Permission-scoped exactly as the route is: admins and owners see the whole
 * list, everyone else sees only their own row. Widening this would leak who
 * else is waiting, so the caller must pass a truthful `isAdmin`.
 */
export async function getEventWaitlist(
  eventId: string,
  viewerProfileId: string,
  isAdmin: boolean
): Promise<any[]> {
  const query = supabaseAdmin
    .from("event_waitlist")
    .select(`
      id, event_id, profile_id, status, offered_at, joined_at, created_at,
      profile:profiles!profile_id(id, name, avatar_url)
    `)
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  const { data, error } = isAdmin ? await query : await query.eq("profile_id", viewerProfileId);

  if (error) throw error;
  return data ?? [];
}

/** Matchplay stages + fixtures with both entries' profiles resolved. */
export async function getEventFixtures(
  eventId: string
): Promise<{ stages: any[]; fixtures: any[] }> {
  const [stagesResult, fixturesResult] = await Promise.all([
    supabaseAdmin
      .from("matchplay_stages")
      .select("*")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true }),
    supabaseAdmin
      .from("matchplay_fixtures")
      .select(`
        *,
        home_entry:event_entries!home_entry_id(id, profile_id, profile:profiles(id, name, avatar_url)),
        away_entry:event_entries!away_entry_id(id, profile_id, profile:profiles(id, name, avatar_url))
      `)
      .eq("event_id", eventId)
      .order("round_number", { ascending: true }),
  ]);

  if (stagesResult.error) throw stagesResult.error;
  if (fixturesResult.error) throw fixturesResult.error;

  return { stages: stagesResult.data ?? [], fixtures: fixturesResult.data ?? [] };
}

/** Matchplay league table, ordered by position. */
export async function getEventLeagueTable(eventId: string): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from("matchplay_league_table_entries")
    .select(`
      *,
      profile:profiles(id, name, avatar_url)
    `)
    .eq("event_id", eventId)
    .order("position", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/** Group role for a viewer, or null if they aren't an active member. */
export async function getViewerGroupRole(
  groupId: string,
  profileId: string
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("major_group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();

  return (data as any)?.role ?? null;
}
