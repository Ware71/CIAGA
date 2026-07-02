// lib/calendar/api.ts
// Client-side data access for the calendar feature. Reads go direct via the
// Supabase client (under RLS); writes go through the service-role API routes.

import { supabase } from "@/lib/supabaseClient";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { CalendarEvent, CalendarRound, Circle } from "./types";

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
  rangeEnd: Date
): Promise<CalendarRound[]> {
  if (profileIds.length === 0) return [];
  const { data, error } = await supabase.rpc("get_calendar_rounds", {
    _profile_ids: profileIds,
    _from: rangeStart.toISOString(),
    _to: rangeEnd.toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as CalendarRound[];
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

export type ProfileSearchResult = { id: string; name: string | null; avatar_url: string | null };

export async function searchProfiles(query: string): Promise<ProfileSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, avatar_url")
    .ilike("name", `%${q}%`)
    .limit(20);
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
