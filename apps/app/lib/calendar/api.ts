// lib/calendar/api.ts
// Client-side data access for the calendar feature. Reads go direct via the
// Supabase client (under RLS); writes go through the service-role API routes.

import { supabase } from "@/lib/supabaseClient";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  CalendarEvent,
  CalendarGroupEvent,
  CalendarRound,
  Circle,
  ProfileLite,
  RoundInfo,
} from "./types";

async function authHeaders(): Promise<Record<string, string>> {
  const session = await getViewerSession();
  if (!session) throw new Error("Not authenticated");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.accessToken}`,
  };
}

/** Fetch calendar_events for the given profiles. Recurring rows are returned
 * regardless of range (they're expanded client-side); one-offs are bounded. */
export async function fetchEvents(
  profileIds: string[],
  rangeStart: Date,
  rangeEnd: Date
): Promise<CalendarEvent[]> {
  if (profileIds.length === 0) return [];
  const { data, error } = await supabase
    .from("calendar_events")
    .select("*")
    .in("profile_id", profileIds)
    // one-offs within range OR any recurring row (rrule not null)
    .or(
      `rrule.not.is.null,and(start_at.lt.${rangeEnd.toISOString()},end_at.gte.${rangeStart.toISOString()})`
    );
  if (error) throw error;
  return (data ?? []) as CalendarEvent[];
}

export async function fetchRounds(
  profileIds: string[],
  rangeStart: Date,
  rangeEnd: Date,
  selfId?: string | null
): Promise<CalendarRound[]> {
  if (profileIds.length === 0) return [];
  const { data, error } = await supabase.rpc("get_calendar_rounds", {
    _profile_ids: profileIds,
    _from: rangeStart.toISOString(),
    _to: rangeEnd.toISOString(),
  });
  if (error) throw error;

  // The RPC yields one row per (round, displayed participant). Collapse to one
  // row per round, preferring the earliest-listed profile (self) for the gross,
  // and flag whether the viewer participated.
  const rank = new Map(profileIds.map((id, i) => [id, i]));
  const byRound = new Map<string, CalendarRound>();
  for (const row of (data ?? []) as CalendarRound[]) {
    const selfHere = !!selfId && row.profile_id === selfId;
    const existing = byRound.get(row.round_id);
    if (!existing) {
      byRound.set(row.round_id, { ...row, selfParticipated: selfHere });
      continue;
    }
    const better =
      (rank.get(row.profile_id) ?? Infinity) < (rank.get(existing.profile_id) ?? Infinity);
    const merged = better ? { ...row } : { ...existing };
    merged.selfParticipated = existing.selfParticipated || selfHere;
    byRound.set(row.round_id, merged);
  }
  return Array.from(byRound.values());
}

/** Competition events from the viewer's Majors groups (draft / confirmed). */
export async function fetchGroupEvents(
  profileId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<CalendarGroupEvent[]> {
  const { data, error } = await supabase.rpc("get_calendar_group_events", {
    _profile_id: profileId,
    _from: rangeStart.toISOString(),
    _to: rangeEnd.toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as CalendarGroupEvent[];
}

/** Full round detail for the info window. */
export async function fetchRoundInfo(roundId: string): Promise<RoundInfo> {
  const { data, error } = await supabase.rpc("get_calendar_round_info", { _round_id: roundId });
  if (error) throw error;
  return data as RoundInfo;
}

export async function fetchCircles(): Promise<Circle[]> {
  const { data, error } = await supabase
    .from("calendar_circles")
    .select(
      "id, owner_profile_id, name, calendar_circle_members(profile_id, profiles(id, name, avatar_url))"
    )
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c: any) => ({
    id: c.id,
    owner_profile_id: c.owner_profile_id,
    name: c.name,
    members: (c.calendar_circle_members ?? []).map((m: any) => ({
      profile_id: m.profile_id,
      name: m.profiles?.name ?? null,
      avatar_url: m.profiles?.avatar_url ?? null,
    })),
  }));
}

/**
 * Resolve names/avatars for a set of profile ids via the shared public RPC
 * (same source InvitePlayerSheet uses — reliable regardless of profiles RLS).
 */
export async function resolveProfileNames(ids: string[]): Promise<ProfileLite[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return [];
  const { data, error } = await supabase.rpc("get_profiles_public", { ids: unique });
  if (error) throw error;
  return (data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name ?? null,
    avatar_url: p.avatar_url ?? null,
  }));
}

/** Profile ids of everyone the current viewer follows. */
export async function fetchFollowingIds(myProfileId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", myProfileId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.following_id).filter(Boolean) as string[];
}

/**
 * "Who's looking for a round": availability events for people I follow + my
 * circle members, over the range. Returns the raw events (expanded by the
 * caller) plus resolved names for rendering.
 */
export async function fetchLookingForRound(
  myProfileId: string,
  circleMemberIds: string[],
  rangeStart: Date,
  rangeEnd: Date
): Promise<{ events: CalendarEvent[]; profiles: ProfileLite[] }> {
  const followIds = await fetchFollowingIds(myProfileId);
  const ids = Array.from(new Set([...followIds, ...circleMemberIds])).filter(
    (id) => id !== myProfileId
  );
  if (ids.length === 0) return { events: [], profiles: [] };

  const { data, error } = await supabase
    .from("calendar_events")
    .select("*")
    .in("profile_id", ids)
    .eq("kind", "available")
    .or(
      `rrule.not.is.null,and(start_at.lt.${rangeEnd.toISOString()},end_at.gte.${rangeStart.toISOString()})`
    );
  if (error) throw error;

  const events = (data ?? []) as CalendarEvent[];
  const profiles = await resolveProfileNames(events.map((e) => e.profile_id));
  return { events, profiles };
}

export type ProfileSearchResult = { id: string; name: string | null; avatar_url: string | null };

export async function searchProfiles(
  query: string,
  signal?: AbortSignal
): Promise<ProfileSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  let req = supabase
    .from("profiles")
    .select("id, name, avatar_url")
    .ilike("name", `%${q}%`)
    .limit(20);
  // Cancel superseded typeahead requests instead of just ignoring their results.
  if (signal) req = req.abortSignal(signal);
  const { data, error } = await req;
  if (error) throw error;
  return (data ?? []) as ProfileSearchResult[];
}

// ---- Mutations (service-role API routes) ------------------------------------

export type EventInput = {
  kind: "available" | "unavailable";
  title: string | null;
  all_day: boolean;
  start_at: string;
  end_at: string;
  rrule: string | null;
};

export async function createEvent(input: EventInput): Promise<CalendarEvent> {
  const res = await fetch("/api/calendar/events", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || "Failed to create event");
  return json.event as CalendarEvent;
}

export async function updateEvent(id: string, input: Partial<EventInput>): Promise<CalendarEvent> {
  const res = await fetch(`/api/calendar/events/${id}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || "Failed to update event");
  return json.event as CalendarEvent;
}

export async function deleteEvent(id: string): Promise<void> {
  const res = await fetch(`/api/calendar/events/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || "Failed to delete event");
  }
}

export async function createCircle(name: string): Promise<Circle> {
  const res = await fetch("/api/calendar/circles", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ name }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || "Failed to create circle");
  return { ...json.circle, members: [] } as Circle;
}

export async function renameCircle(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/calendar/circles/${id}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || "Failed to rename circle");
  }
}

export async function deleteCircle(id: string): Promise<void> {
  const res = await fetch(`/api/calendar/circles/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || "Failed to delete circle");
  }
}

export async function addCircleMember(circleId: string, profileId: string): Promise<void> {
  const res = await fetch(`/api/calendar/circles/${circleId}/members`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ profile_id: profileId }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || "Failed to add member");
  }
}

export async function removeCircleMember(circleId: string, profileId: string): Promise<void> {
  const res = await fetch(
    `/api/calendar/circles/${circleId}/members?profile_id=${encodeURIComponent(profileId)}`,
    { method: "DELETE", headers: await authHeaders() }
  );
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || "Failed to remove member");
  }
}

/** Create a scheduled round at `scheduledAt` and return its id (for setup redirect). */
export async function createScheduledRound(scheduledAt: string): Promise<string> {
  const res = await fetch("/api/rounds/create", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      course_id: null,
      pending_tee_box_id: null,
      format_type: "strokeplay",
      scheduled_at: scheduledAt,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || "Failed to create round");
  return json.round_id as string;
}
