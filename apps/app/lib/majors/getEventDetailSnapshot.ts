import { reconcileEventStatus } from "@/lib/majors/reconcileStatus";
import { getEventById, getEventParticipants, getGroupMembers } from "@/lib/majors/queries";
import { getEventLeaderboardPayload } from "@/lib/majors/eventLeaderboardPayload";
import {
  getEventTeeTimes,
  getEventRounds,
  getEventWinnings,
  getEventWaitlist,
  getEventFixtures,
  getEventLeagueTable,
  getViewerGroupRole,
} from "@/lib/majors/eventDetailQueries";
import { isMatchplayLeague, isMatchplayKnockout } from "@/lib/majors/labels";

export type EventDetailSnapshot = {
  viewer_profile_id: string;
  event: any;
  leaderboard: Awaited<ReturnType<typeof getEventLeaderboardPayload>>;
  tee_times: any[];
  participants: any[];
  winnings: any[];
  event_rounds: any[];
  matchplay: { stages: any[]; fixtures: any[] } | null;
  league_table: any[] | null;
  group_members: any[] | null;
  my_role: string | null;
  waitlist: any[] | null;
};

/**
 * Everything the event detail page renders on first paint, resolved in one
 * server pass.
 *
 * The client used to do this in five sequential network waves from the phone:
 * resolve the session, six parallel fetches, then fixtures → league table →
 * group members → waitlist one after another. Server-side those are all a hop
 * from Postgres, and the dependent ones only need `event` first.
 *
 * Returns null when the event doesn't exist, so the page can render notFound().
 */
export async function getEventDetailSnapshot(
  eventId: string,
  viewerProfileId: string
): Promise<EventDetailSnapshot | null> {
  // Matches GET /api/majors/events/[id], which reconciles before reading.
  await reconcileEventStatus(eventId);

  const event = await getEventById(eventId);
  if (!event) return null;

  const groupId = (event as any).group_id as string | null;
  const isMatchplay =
    isMatchplayLeague((event as any).event_type) || isMatchplayKnockout((event as any).event_type);

  // Wave 2 — everything that only needed `event` to be resolved first. The
  // client ran the last four of these serially.
  const [
    leaderboard,
    teeTimes,
    participants,
    winnings,
    eventRounds,
    matchplay,
    leagueTable,
    groupMembers,
    myRole,
  ] = await Promise.all([
    getEventLeaderboardPayload(eventId, viewerProfileId),
    getEventTeeTimes(eventId),
    getEventParticipants(eventId),
    getEventWinnings(eventId),
    getEventRounds(eventId),
    isMatchplay ? getEventFixtures(eventId) : Promise.resolve(null),
    isMatchplay ? getEventLeagueTable(eventId) : Promise.resolve(null),
    groupId ? getGroupMembers(groupId) : Promise.resolve(null),
    groupId ? getViewerGroupRole(groupId, viewerProfileId) : Promise.resolve(null),
  ]);

  // The client only fetches the waitlist when the viewer isn't entered, so match
  // that — and scope it the way the route does, or we'd leak the full list to
  // non-admins.
  const isEntered = (participants ?? []).some((p: any) => p.profile_id === viewerProfileId);
  const waitlist = isEntered
    ? null
    : await getEventWaitlist(
        eventId,
        viewerProfileId,
        myRole === "owner" || myRole === "admin"
      );

  return {
    viewer_profile_id: viewerProfileId,
    event,
    leaderboard,
    tee_times: teeTimes,
    participants: participants ?? [],
    winnings,
    event_rounds: eventRounds,
    matchplay,
    league_table: leagueTable,
    group_members: groupMembers,
    my_role: myRole,
    waitlist,
  };
}
