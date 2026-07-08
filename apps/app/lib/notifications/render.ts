/**
 * Client-safe notification rendering — maps a notification (type + payload) to
 * display copy and a deep link. Used by BOTH the push sender (server) and the
 * notification bell (client), so this module must not import server-only code.
 */

export type NotificationType =
  | "tee_time_assigned"
  | "tee_time_reminder"
  | "waitlist_offered"
  | "event_created"
  | "entry_open"
  | "mention_post"
  | "mention_comment"
  | "follow_round_started"
  | "follow_round_completed"
  | "round_scheduled"
  | "round_schedule_changed"
  | "round_cancelled"
  | "fantasy_pick_won"
  | "fantasy_pick_lost"
  | "fantasy_pick_void";

export type NotificationActor = {
  profile_id: string;
  name: string;
  /** completed-round only: this actor set a new course record */
  course_record?: boolean;
  course_name?: string | null;
};

export type UserNotification = {
  id: string;
  profile_id: string;
  type: NotificationType | string;
  payload: Record<string, any>;
  read: boolean;
  group_key?: string | null;
  created_at: string;
  updated_at?: string;
};

export type RenderedNotification = {
  title: string;
  body: string;
  url: string;
  /** lucide-ish icon key the card UI can map to an icon component */
  icon: string;
};

/** "Alice", "Alice and Bob", "Alice, Bob and 2 others" */
export function formatActorNames(actors: NotificationActor[]): string {
  const names = actors.map((a) => a.name).filter(Boolean);
  if (names.length === 0) return "Someone";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const others = names.length - 2;
  return `${names[0]}, ${names[1]} and ${others} other${others === 1 ? "" : "s"}`;
}

function truncate(s: string, n = 80): string {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** ISO timestamp → "Jun 30 at 2:30 PM" (viewer's local time on the client).
 *  Non-ISO / already-formatted values are returned unchanged. */
function formatTeeTime(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${date} at ${time}`;
}

export function renderNotification(
  type: string,
  payload: Record<string, any>
): RenderedNotification {
  const p = payload ?? {};

  switch (type) {
    case "event_created":
      return {
        title: "New event",
        body: p.group_name
          ? `${p.event_name ?? "A new event"} was added to ${p.group_name}`
          : `${p.event_name ?? "A new event"} was added`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "calendar-plus",
      };

    case "entry_open":
      return {
        title: "Entry is open",
        body: `Entry is now open for ${p.event_name ?? "an event"}`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "door-open",
      };

    case "fantasy_pick_won":
      return {
        title: "Pick won! 🎉",
        body: `${p.market_label ?? "Your pick"} came in — +${p.payout ?? "?"} pts${
          p.event_name ? ` (${p.event_name})` : ""
        }`,
        url: "/majors/fantasy/picks",
        icon: "trophy",
      };

    case "fantasy_pick_lost":
      return {
        title: "Pick settled",
        body: `${p.market_label ?? "Your pick"} didn't come in${
          p.event_name ? ` (${p.event_name})` : ""
        }`,
        url: "/majors/fantasy/picks",
        icon: "flag",
      };

    case "fantasy_pick_void":
      return {
        title: "Pick voided",
        body: `${p.market_label ?? "Your pick"} was voided — ${p.stake ?? "your"} pts returned${
          p.event_name ? ` (${p.event_name})` : ""
        }`,
        url: "/majors/fantasy/picks",
        icon: "rotate-ccw",
      };

    case "mention_post":
      return {
        title: "You were tagged",
        body: `${p.actor_name ?? "Someone"} tagged you in a post${
          p.excerpt ? `: “${truncate(p.excerpt)}”` : ""
        }`,
        url: "/social",
        icon: "at-sign",
      };

    case "mention_comment":
      return {
        title: "You were mentioned",
        body: `${p.actor_name ?? "Someone"} mentioned you in a comment${
          p.excerpt ? `: “${truncate(p.excerpt)}”` : ""
        }`,
        url: "/social",
        icon: "at-sign",
      };

    case "follow_round_started": {
      const actors: NotificationActor[] = Array.isArray(p.actors) ? p.actors : [];
      const who = formatActorNames(actors);
      const plural = actors.length > 1;
      // co_player: the recipient is also playing in this round.
      const coPlayer = !!p.co_player;
      return {
        title: coPlayer ? "Your round started" : "Round started",
        body: coPlayer
          ? `${who} ${plural ? "have" : "has"} started your round`
          : `${who} ${plural ? "started rounds" : "started a round"}`,
        url: coPlayer && p.round_id
          ? `/round/${p.round_id}`
          : actors.length === 1 ? `/player/${actors[0].profile_id}` : "/social",
        icon: "flag",
      };
    }

    case "follow_round_completed": {
      const actors: NotificationActor[] = Array.isArray(p.actors) ? p.actors : [];
      const who = formatActorNames(actors);
      const plural = actors.length > 1;
      const coPlayer = !!p.co_player;
      const recordHolders = actors.filter((a) => a.course_record);

      // Body always states the result (for participants AND non-participants).
      let body: string;
      if (p.match_halved) {
        body = "Match halved";
      } else if (p.winner_name && p.loser_name && p.margin) {
        // Match play: who beat who and by how much.
        body = `${p.winner_name} beat ${p.loser_name} ${p.margin}`;
      } else if (p.winner_name) {
        body = `${p.winner_name} won ${coPlayer ? "your" : "the"} round`;
      } else {
        // Fallback to the generic copy when no result was supplied.
        body = `${who} ${plural ? "completed rounds" : "completed a round"}`;
      }

      if (recordHolders.length === 1) {
        const cn = recordHolders[0].course_name;
        body += ` · 🏆 New course record${cn ? ` at ${cn}` : ""}!`;
      } else if (recordHolders.length > 1) {
        body += ` · 🏆 ${recordHolders.length} new course records!`;
      }
      return {
        title: recordHolders.length ? "Course record!" : "Round completed",
        body,
        url: coPlayer && p.round_id
          ? `/round/${p.round_id}`
          : actors.length === 1 ? `/player/${actors[0].profile_id}` : "/social",
        icon: recordHolders.length ? "trophy" : "flag-checkered",
      };
    }

    case "round_scheduled": {
      const actors: NotificationActor[] = Array.isArray(p.actors) ? p.actors : [];
      const who = formatActorNames(actors);
      const where = p.course_name ? ` at ${p.course_name}` : "";
      const when = p.scheduled_at ? ` · ${formatTeeTime(p.scheduled_at)}` : "";
      return {
        title: "Round scheduled",
        body: `${who} scheduled a round for you${where}${when}`,
        url: p.round_id ? `/round/${p.round_id}/setup` : "/round",
        icon: "calendar-plus",
      };
    }

    case "round_schedule_changed": {
      const actors: NotificationActor[] = Array.isArray(p.actors) ? p.actors : [];
      const who = formatActorNames(actors);
      const where = p.course_name ? ` at ${p.course_name}` : "";
      const when = p.scheduled_at ? ` · now ${formatTeeTime(p.scheduled_at)}` : "";
      return {
        title: "Round time changed",
        body: `${who} changed the time of your round${where}${when}`,
        url: p.round_id ? `/round/${p.round_id}/setup` : "/round",
        icon: "calendar-clock",
      };
    }

    case "round_cancelled": {
      const actors: NotificationActor[] = Array.isArray(p.actors) ? p.actors : [];
      const who = formatActorNames(actors);
      const where = p.course_name ? ` at ${p.course_name}` : "";
      const when = p.scheduled_at ? ` · ${formatTeeTime(p.scheduled_at)}` : "";
      return {
        title: "Round cancelled",
        body: `${who} cancelled a scheduled round${where}${when}`,
        url: "/round",
        icon: "calendar-x",
      };
    }

    case "tee_time_assigned":
      return {
        title: "Tee time assigned",
        body: p.event_name
          ? `You've been placed in a tee time for ${p.event_name}${
              p.tee_time ? ` at ${formatTeeTime(p.tee_time)}` : ""
            }`
          : "You've been placed in a tee time",
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "clock",
      };

    case "tee_time_reminder":
      return {
        title: "Tee time reminder",
        body: `Upcoming tee time${p.event_name ? ` for ${p.event_name}` : ""}${
          p.tee_time ? ` at ${formatTeeTime(p.tee_time)}` : ""
        }`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "clock",
      };

    case "waitlist_offered":
      return {
        title: "A spot opened up",
        body: `You've been offered a spot in ${p.event_name ?? "an event"}`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "ticket",
      };

    default:
      return {
        title: typeof p.title === "string" ? p.title : "Notification",
        body: typeof p.body === "string" ? p.body : "",
        url: typeof p.url === "string" ? p.url : "/home",
        icon: "bell",
      };
  }
}
