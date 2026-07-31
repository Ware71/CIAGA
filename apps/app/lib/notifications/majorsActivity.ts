import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createNotification,
  createNotificationsForMany,
  resolvePushRecipients,
} from "@/lib/notifications/notify";
import type { NotificationType } from "@/lib/notifications/render";

/**
 * Fan-out helpers for the Majors notifications (events, groups, prize pots).
 *
 * Every function here is BEST-EFFORT and never throws — an event completing or
 * a prize being distributed must not fail because a notification could not be
 * written. Callers should still `.catch(() => {})` defensively at the call site
 * where the surrounding code is not already inside a try.
 *
 * Recipient rules, per docs/notifications.md §2:
 *  - result/lifecycle notifications go to ACTIVE GROUP MEMBERS, not just
 *    entrants — a member who didn't play still wants to know who won;
 *  - organiser notifications go to group owners/admins only, and never to the
 *    person who triggered them.
 */

const ADMIN_ROLES = ["owner", "admin"];

async function getProfileName(profileId: string | null | undefined): Promise<string> {
  if (!profileId) return "Someone";
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("name")
    .eq("id", profileId)
    .maybeSingle();
  return (data as any)?.name ?? "Someone";
}

/** Active members of a group, minus `exclude`. */
async function getActiveMemberIds(
  groupId: string,
  exclude?: string | null
): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("major_group_memberships")
    .select("profile_id")
    .eq("group_id", groupId)
    .eq("status", "active");

  return Array.from(
    new Set(
      (data ?? [])
        .map((m: any) => m.profile_id as string | null)
        .filter((id): id is string => !!id && id !== exclude)
    )
  );
}

/** Owners and admins of a group, minus `exclude`. */
async function getGroupAdminIds(groupId: string, exclude?: string | null): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("major_group_memberships")
    .select("profile_id, role")
    .eq("group_id", groupId)
    .eq("status", "active")
    .in("role", ADMIN_ROLES);

  return Array.from(
    new Set(
      (data ?? [])
        .map((m: any) => m.profile_id as string | null)
        .filter((id): id is string => !!id && id !== exclude)
    )
  );
}

/** Minimal event shape needed to address a notification. */
async function getEventContext(eventId: string): Promise<{
  id: string;
  name: string | null;
  group_id: string | null;
  event_date: string | null;
} | null> {
  const { data } = await supabaseAdmin
    .from("events")
    .select("id, name, group_id, event_date")
    .eq("id", eventId)
    .maybeSingle();
  return (data as any) ?? null;
}

/**
 * Winner name(s) for an event, for the results/completion copy. Returns null
 * when the leaderboard hasn't been computed — the copy degrades gracefully.
 * Ties are joined ("Alice & Bob") since position 1 can be shared.
 */
export async function getEventWinnerName(eventId: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("event_leaderboard_entries")
      .select("profile_id")
      .eq("event_id", eventId)
      .eq("position", 1);

    const ids = (data ?? []).map((r: any) => r.profile_id).filter(Boolean) as string[];
    if (ids.length === 0) return null;

    const { data: profs } = await supabaseAdmin.from("profiles").select("name").in("id", ids);
    const names = (profs ?? []).map((p: any) => p.name).filter(Boolean) as string[];
    return names.length ? names.join(" & ") : null;
  } catch {
    return null;
  }
}

/**
 * Notify a group about something that happened to one of its events —
 * results revealed, event completed, event cancelled.
 *
 * `excludeProfileId` is whoever performed the action; they don't need telling.
 */
export async function notifyEventAudience(params: {
  eventId: string;
  type: NotificationType;
  extraPayload?: Record<string, any>;
  excludeProfileId?: string | null;
}): Promise<void> {
  const { eventId, type, extraPayload, excludeProfileId } = params;
  if (!eventId) return;

  try {
    const event = await getEventContext(eventId);
    if (!event?.group_id) return;

    const recipientIds = await getActiveMemberIds(event.group_id, excludeProfileId);
    if (recipientIds.length === 0) return;

    await createNotificationsForMany(recipientIds, type, {
      event_id: event.id,
      event_name: event.name,
      event_date: event.event_date,
      group_id: event.group_id,
      ...(extraPayload ?? {}),
    });
  } catch (e: any) {
    console.error(`[notify] notifyEventAudience(${type}) failed:`, e?.message);
  }
}

/** A player has been directly invited to an event. */
export async function notifyEventInvited(params: {
  eventId: string;
  inviteeProfileId: string;
  actorProfileId?: string | null;
}): Promise<void> {
  const { eventId, inviteeProfileId, actorProfileId } = params;
  if (!eventId || !inviteeProfileId) return;
  if (inviteeProfileId === actorProfileId) return;

  try {
    const [event, actorName] = await Promise.all([
      getEventContext(eventId),
      getProfileName(actorProfileId),
    ]);
    if (!event) return;

    await createNotification({
      recipientProfileId: inviteeProfileId,
      type: "event_invited",
      payload: {
        event_id: event.id,
        event_name: event.name,
        event_date: event.event_date,
        group_id: event.group_id,
        actor_profile_id: actorProfileId ?? null,
        actor_name: actorName,
      },
    });
  } catch (e: any) {
    console.error("[notify] notifyEventInvited failed:", e?.message);
  }
}

/**
 * Organiser-facing: tell a group's owners/admins that something needs them, or
 * that their event roster moved. Grouped per group+type so a rush of entries
 * collapses into one card ("Alice, Bob and 4 others entered").
 */
export async function notifyGroupAdmins(params: {
  groupId: string;
  type: NotificationType;
  actorProfileId?: string | null;
  payload?: Record<string, any>;
  /** Collapse repeats into one card. Omit for one card per occurrence. */
  groupKey?: string | null;
}): Promise<void> {
  const { groupId, type, actorProfileId, payload, groupKey } = params;
  if (!groupId) return;

  try {
    const [adminIds, actorName, group] = await Promise.all([
      getGroupAdminIds(groupId, actorProfileId),
      getProfileName(actorProfileId),
      supabaseAdmin.from("major_groups").select("name").eq("id", groupId).maybeSingle(),
    ]);
    if (adminIds.length === 0) return;

    const basePayload = {
      group_id: groupId,
      group_name: (group.data as any)?.name ?? null,
      actor_profile_id: actorProfileId ?? null,
      actor_name: actorName,
      actors: actorProfileId ? [{ profile_id: actorProfileId, name: actorName }] : [],
      ...(payload ?? {}),
    };

    if (!groupKey) {
      await createNotificationsForMany(adminIds, type, basePayload);
      return;
    }

    // Grouped fan-out: resolve push permission once, then merge per recipient.
    const pushable = await resolvePushRecipients(adminIds, type);
    await Promise.allSettled(
      adminIds.map((recipientProfileId) =>
        createNotification({
          recipientProfileId,
          type,
          payload: basePayload,
          groupKey,
          pushAllowed: pushable.has(recipientProfileId),
        })
      )
    );
  } catch (e: any) {
    console.error(`[notify] notifyGroupAdmins(${type}) failed:`, e?.message);
  }
}

/** A pending join request was approved — tell the requester they're in. */
export async function notifyJoinRequestApproved(params: {
  groupId: string;
  profileId: string;
}): Promise<void> {
  const { groupId, profileId } = params;
  if (!groupId || !profileId) return;

  try {
    const { data: group } = await supabaseAdmin
      .from("major_groups")
      .select("name")
      .eq("id", groupId)
      .maybeSingle();

    await createNotification({
      recipientProfileId: profileId,
      type: "join_request_approved",
      payload: {
        group_id: groupId,
        group_name: (group as any)?.name ?? null,
      },
    });
  } catch (e: any) {
    console.error("[notify] notifyJoinRequestApproved failed:", e?.message);
  }
}

/** A sudden-death playoff has started — tell the players in it. */
export async function notifyPlayoffStarted(params: {
  eventId: string;
  playerProfileIds: string[];
  playerNames?: string[] | null;
}): Promise<void> {
  const { eventId, playerProfileIds, playerNames } = params;
  const ids = Array.from(new Set((playerProfileIds ?? []).filter(Boolean)));
  if (!eventId || ids.length === 0) return;

  try {
    const event = await getEventContext(eventId);
    if (!event) return;

    await createNotificationsForMany(ids, "playoff_started", {
      event_id: event.id,
      event_name: event.name,
      group_id: event.group_id,
      player_names: playerNames?.length ? playerNames.join(" v ") : null,
    });
  } catch (e: any) {
    console.error("[notify] notifyPlayoffStarted failed:", e?.message);
  }
}
