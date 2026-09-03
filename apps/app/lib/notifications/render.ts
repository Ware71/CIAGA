/**
 * Client-safe notification rendering — maps a notification (type + payload) to
 * display copy and a deep link. Used by BOTH the push sender (server) and the
 * notification bell (client), so this module must not import server-only code.
 */

export type NotificationType =
  | "tee_time_assigned"
  | "waitlist_offered"
  | "event_created"
  | "entry_open"
  | "entry_closing"
  | "event_invited"
  | "event_cancelled"
  | "event_results_revealed"
  | "event_completed"
  | "event_date_changed"
  | "payment_recorded"
  | "playoff_started"
  | "join_request_approved"
  | "mention_post"
  | "mention_comment"
  | "comment_on_post"
  | "comment_reply"
  | "post_reaction"
  | "new_follower"
  | "follow_round_started"
  | "follow_round_completed"
  | "round_scheduled"
  | "round_schedule_changed"
  | "round_cancelled"
  | "fantasy_pick_won"
  | "fantasy_pick_lost"
  | "fantasy_pick_void"
  | "fantasy_parlay_won"
  | "fantasy_parlay_lost"
  | "fantasy_parlay_void"
  | "fantasy_season_pick_won"
  | "fantasy_season_pick_lost"
  | "fantasy_season_pick_void"
  | "prize_won"
  // Organiser-facing — see the `organiser` category in preferences.ts.
  | "join_request_pending"
  | "event_entry_received"
  | "event_withdrawal";

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

/**
 * "Alice", "Alice and Bob", "Alice, Bob and 2 others".
 *
 * `totalCount` is the true number of actors when the stored `actors` array has
 * been capped (see MAX_STORED_ACTORS) — a post with 500 reactions keeps only
 * the first few names but must still say "and 498 others".
 */
export function formatActorNames(
  actors: NotificationActor[],
  totalCount?: number
): string {
  const names = actors.map((a) => a.name).filter(Boolean);
  if (names.length === 0) return "Someone";
  const total = Math.max(totalCount ?? names.length, names.length);
  if (total === 1) return names[0];
  if (total === 2 && names.length >= 2) return `${names[0]} and ${names[1]}`;
  const shown = names.slice(0, 2);
  const others = total - shown.length;
  if (others <= 0) return shown.join(" and ");
  return `${shown.join(", ")} and ${others} other${others === 1 ? "" : "s"}`;
}

function truncate(s: string, n = 80): string {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// The app is UK-only, so tee times are always in UK local time. This must be
// pinned explicitly because renderNotification also runs server-side (Vercel
// Node = UTC) when building push bodies — without it, pushes render in UTC.
// Europe/London auto-handles BST vs GMT and matches the UK browser output, so
// the in-app bell (which renders client-side) is unaffected.
export const APP_TIME_ZONE = "Europe/London";

/** ISO timestamp → "Jun 30 at 2:30 PM" in UK local time (Europe/London).
 *  Non-ISO / already-formatted values are returned unchanged. */
function formatTeeTime(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", timeZone: APP_TIME_ZONE });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: APP_TIME_ZONE });
  return `${date} at ${time}`;
}

/** ISO timestamp → "Jun 30" in UK local time. Non-ISO values pass through. */
function formatDay(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString([], { month: "short", day: "numeric", timeZone: APP_TIME_ZONE });
}

/** ISO timestamp → "2:30 PM" in UK local time. Non-ISO values pass through. */
function formatClock(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: APP_TIME_ZONE });
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
        body: `Entry is now open for ${p.event_name ?? "an event"}${
          p.entry_window_end ? ` — closes ${formatDay(p.entry_window_end)}` : ""
        }`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "door-open",
      };

    case "entry_closing":
      return {
        title: "Entry closes today",
        body: `Last chance to enter ${p.event_name ?? "an event"}${
          p.entry_window_end ? ` — entry closes at ${formatClock(p.entry_window_end)}` : ""
        }`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "clock",
      };

    case "event_invited":
      return {
        title: "You're invited",
        body: `${p.actor_name ?? "An organiser"} invited you to ${p.event_name ?? "an event"}`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "mail",
      };

    case "event_cancelled":
      return {
        title: "Event cancelled",
        body: `${p.event_name ?? "An event"} has been cancelled${
          p.event_date ? ` — was ${formatDay(p.event_date)}` : ""
        }`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "calendar-x",
      };

    case "event_date_changed":
      return {
        title: "Event date changed",
        body: `${p.event_name ?? "An event"} has moved${
          p.event_date ? ` to ${formatDay(p.event_date)}` : ""
        }`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "calendar-clock",
      };

    case "payment_recorded":
      return {
        title: "Payment recorded",
        body: `${p.amount_label ?? "Your payment"} received${
          p.charge_name ? ` for ${p.charge_name}` : ""
        }`,
        url: p.group_id ? `/majors/groups/${p.group_id}` : "/majors",
        icon: "banknote",
      };

    case "event_results_revealed":
      return {
        title: "Results are in 🏆",
        body: `${p.event_name ?? "An event"} — the leaderboard is live${
          p.winner_name ? `. ${p.winner_name} takes it` : ""
        }`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "trophy",
      };

    case "event_completed":
      return {
        title: "Event complete",
        body: p.winner_name
          ? `${p.winner_name} won ${p.event_name ?? "the event"}`
          : `${p.event_name ?? "An event"} is complete — final standings are up`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "flag-checkered",
      };

    case "playoff_started":
      return {
        title: "Playoff! ⛳",
        body: p.player_names
          ? `Sudden death: ${p.player_names}`
          : `A playoff has started at ${p.event_name ?? "the event"}`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "swords",
      };

    case "join_request_approved":
      return {
        title: "You're in",
        body: `Your request to join ${p.group_name ?? "the group"} was approved`,
        url: p.group_id ? `/majors/groups/${p.group_id}` : "/majors/groups",
        icon: "user-check",
      };

    case "prize_won":
      return {
        title: "You won! 💰",
        body: `${p.amount_label ?? "A payout"} from ${p.pot_name ?? "the prize pot"}${
          p.event_name ? ` (${p.event_name})` : ""
        }`,
        url: p.event_id
          ? `/majors/events/${p.event_id}`
          : p.group_season_id
            ? `/majors/group-seasons/${p.group_season_id}`
            : "/majors",
        icon: "banknote",
      };

    // ── Organiser-facing ──────────────────────────────────────────────────────
    case "join_request_pending":
      return {
        title: "Join request",
        body: `${p.actor_name ?? "Someone"} asked to join ${p.group_name ?? "your group"}`,
        url: p.group_id ? `/majors/groups/${p.group_id}` : "/majors/groups",
        icon: "user-plus",
      };

    case "event_entry_received":
      return {
        title: "New entry",
        body: `${p.actor_name ?? "Someone"} entered ${p.event_name ?? "your event"}${
          typeof p.entry_count === "number" ? ` — ${p.entry_count} in` : ""
        }`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "user-plus",
      };

    case "event_withdrawal":
      return {
        title: "Withdrawal",
        body: `${p.actor_name ?? "Someone"} withdrew from ${p.event_name ?? "your event"}${
          typeof p.entry_count === "number" ? ` — ${p.entry_count} left in` : ""
        }`,
        url: p.event_id ? `/majors/events/${p.event_id}` : "/majors",
        icon: "user-minus",
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

    case "fantasy_parlay_won":
      return {
        title: "Acca landed! 🎉",
        body: `Your accumulator came in — +${p.payout ?? "?"} pts`,
        url: "/majors/fantasy/picks",
        icon: "trophy",
      };

    case "fantasy_parlay_lost":
      return {
        title: "Acca settled",
        body: "Your accumulator didn't come in",
        url: "/majors/fantasy/picks",
        icon: "flag",
      };

    case "fantasy_parlay_void":
      return {
        title: "Acca voided",
        body: `Your accumulator was voided — ${p.stake ?? "your"} pts returned`,
        url: "/majors/fantasy/picks",
        icon: "rotate-ccw",
      };

    case "fantasy_season_pick_won":
      return {
        title: "Season pick won! 🎉",
        body: `${p.market_label ?? "Your season pick"} came in — +${p.payout ?? "?"} pts${
          p.season_name ? ` (${p.season_name})` : ""
        }`,
        url: "/majors/fantasy/picks",
        icon: "trophy",
      };

    case "fantasy_season_pick_lost":
      return {
        title: "Season pick settled",
        body: `${p.market_label ?? "Your season pick"} didn't come in${
          p.season_name ? ` (${p.season_name})` : ""
        }`,
        url: "/majors/fantasy/picks",
        icon: "flag",
      };

    case "fantasy_season_pick_void":
      return {
        title: "Season pick voided",
        body: `${p.market_label ?? "Your season pick"} was voided — ${
          p.stake ?? "your"
        } pts returned${p.season_name ? ` (${p.season_name})` : ""}`,
        url: "/majors/fantasy/picks",
        icon: "rotate-ccw",
      };

    // Both mention types deep-link to the post itself via /social/[id]. They
    // used to land on the feed, leaving the user to scroll for the thing they
    // were tagged in — the payload has carried feed_item_id all along.
    case "mention_post":
      return {
        title: "You were tagged",
        body: `${p.actor_name ?? "Someone"} tagged you in a post${
          p.excerpt ? `: “${truncate(p.excerpt)}”` : ""
        }`,
        url: p.feed_item_id ? `/social/${p.feed_item_id}` : "/social",
        icon: "at-sign",
      };

    case "mention_comment":
      return {
        title: "You were mentioned",
        body: `${p.actor_name ?? "Someone"} mentioned you in a comment${
          p.excerpt ? `: “${truncate(p.excerpt)}”` : ""
        }`,
        url: p.feed_item_id ? `/social/${p.feed_item_id}` : "/social",
        icon: "at-sign",
      };

    case "comment_on_post": {
      const actors: NotificationActor[] = Array.isArray(p.actors) ? p.actors : [];
      const who = formatActorNames(actors, p.total_count);
      const plural = (p.total_count ?? actors.length) > 1;
      return {
        title: "New comment",
        body: `${who} commented on ${p.is_author ? "your post" : "a post you commented on"}${
          !plural && p.excerpt ? `: “${truncate(p.excerpt)}”` : ""
        }`,
        url: p.feed_item_id ? `/social/${p.feed_item_id}` : "/social",
        icon: "message-circle",
      };
    }

    case "comment_reply":
      return {
        title: "New reply",
        body: `${p.actor_name ?? "Someone"} replied to your comment${
          p.excerpt ? `: “${truncate(p.excerpt)}”` : ""
        }`,
        url: p.feed_item_id ? `/social/${p.feed_item_id}` : "/social",
        icon: "reply",
      };

    case "post_reaction": {
      const actors: NotificationActor[] = Array.isArray(p.actors) ? p.actors : [];
      const who = formatActorNames(actors, p.total_count);
      const plural = (p.total_count ?? actors.length) > 1;
      return {
        title: "New reaction",
        body: `${who} ${plural ? "reacted" : `reacted ${p.emoji ?? ""}`.trim()} to your post`,
        url: p.feed_item_id ? `/social/${p.feed_item_id}` : "/social",
        icon: "heart",
      };
    }

    case "new_follower": {
      const actors: NotificationActor[] = Array.isArray(p.actors) ? p.actors : [];
      const total = p.total_count ?? actors.length;
      const who = formatActorNames(actors, p.total_count);
      return {
        title: total > 1 ? "New followers" : "New follower",
        body: total > 1 ? `${who} started following you` : `${who} started following you`,
        url:
          total === 1 && actors[0]?.profile_id ? `/player/${actors[0].profile_id}` : "/profile",
        icon: "user-plus",
      };
    }

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
        url: p.round_id ? `/round/${p.round_id}/setup` : "/play",
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
        url: p.round_id ? `/round/${p.round_id}/setup` : "/play",
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
        url: "/play",
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
