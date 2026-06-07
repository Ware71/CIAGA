import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fanOutToGroupMembersAndFollowers } from "@/lib/feed/fanout";

export async function emitCompetitionRoundFeedItems(params: {
  eventId: string;
  newStatus: "live" | "completed";
}): Promise<void> {
  const { eventId, newStatus } = params;
  if (!eventId) return;

  // Fetch event with group, course, and rounds
  const { data: eventData } = await supabaseAdmin
    .from("events")
    .select(`
      id, name, num_rounds,
      group:major_groups(id, name, privacy),
      course:courses(id, name),
      rounds:event_rounds(id, round_number, name, scheduled_date, status)
    `)
    .eq("id", eventId)
    .maybeSingle();

  if (!eventData) return;

  const event = eventData as any;
  const group = event.group as { id: string; name: string; privacy: string } | null;
  const course = event.course as { id: string; name: string } | null;
  const rounds = (event.rounds ?? []) as Array<{
    id: string;
    round_number: number;
    name: string;
    scheduled_date: string | null;
    status: string;
  }>;

  if (!group || rounds.length === 0) return;

  const totalRounds = rounds.length;
  const now = new Date().toISOString();

  if (newStatus === "live") {
    // Fetch event entrants for the live_players list (no scores)
    const { data: entrants } = await supabaseAdmin
      .from("event_leaderboard_entries")
      .select("profile_id, profile:profiles(id, name, avatar_url)")
      .eq("event_id", eventId)
      .limit(8);

    const livePlayers = ((entrants ?? []) as any[])
      .filter((e) => e.profile?.id)
      .map((e) => ({
        profile_id: e.profile.id as string,
        name: (e.profile.name as string) ?? "Player",
        avatar_url: (e.profile.avatar_url as string | null) ?? null,
      }));

    // Fetch group members for fan-out
    const { data: memberRows } = await supabaseAdmin
      .from("major_group_memberships")
      .select("profile_id")
      .eq("group_id", group.id)
      .eq("status", "active");

    const memberIds = ((memberRows ?? []) as any[])
      .map((r) => r.profile_id as string)
      .filter(Boolean);

    const isPrivate = group.privacy === "invite_only";

    // Upsert one feed_item per round
    for (const round of rounds) {
      const groupKey = `competition_round:${round.id}`;

      const payload = {
        event_id: eventId,
        event_name: event.name as string,
        round_id: round.id,
        round_number: round.round_number,
        total_rounds: totalRounds,
        round_status: "live" as const,
        group_id: group.id,
        group_name: group.name,
        group_privacy: group.privacy as "public" | "request" | "invite_only",
        scheduled_date: round.scheduled_date ?? null,
        course_name: course?.name ?? null,
        live_players: livePlayers,
        winner: null,
      };

      const { data: upserted, error: upsertErr } = await supabaseAdmin
        .from("feed_items")
        .upsert(
          {
            type: "competition_round",
            actor_profile_id: null,
            audience: "followers",
            visibility: "visible",
            occurred_at: now,
            payload,
            group_key: groupKey,
          },
          { onConflict: "group_key" }
        )
        .select("id, created_at")
        .single();

      if (upsertErr || !upserted?.id) continue;

      // Only fan out when the row was just created (not an update)
      const wasJustCreated =
        Math.abs(new Date(upserted.created_at).getTime() - new Date(now).getTime()) < 5000;

      if (wasJustCreated && memberIds.length) {
        await fanOutToGroupMembersAndFollowers({
          feedItemId: upserted.id,
          memberProfileIds: memberIds,
          followersIncluded: !isPrivate,
        }).catch(() => {});
      }
    }
  } else {
    // completed — update payload with winner info
    const { data: winnerRow } = await supabaseAdmin
      .from("event_leaderboard_entries")
      .select("profile_id, profile:profiles(id, name, avatar_url)")
      .eq("event_id", eventId)
      .eq("position", 1)
      .maybeSingle();

    const winner = winnerRow && (winnerRow as any).profile?.id
      ? {
          profile_id: (winnerRow as any).profile.id as string,
          name: ((winnerRow as any).profile.name as string) ?? "Player",
          avatar_url: ((winnerRow as any).profile.avatar_url as string | null) ?? null,
        }
      : null;

    for (const round of rounds) {
      const groupKey = `competition_round:${round.id}`;

      // Fetch existing to merge payload
      const { data: existing } = await supabaseAdmin
        .from("feed_items")
        .select("id, payload")
        .eq("group_key", groupKey)
        .maybeSingle();

      if (!existing?.id) continue;

      const updatedPayload = {
        ...(existing.payload as object),
        round_status: "completed" as const,
        winner,
      };

      await supabaseAdmin
        .from("feed_items")
        .update({ payload: updatedPayload })
        .eq("id", existing.id);
    }
  }
}
