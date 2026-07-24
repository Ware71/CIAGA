/**
 * Client-safe notification preference model — groups the notification types in
 * render.ts into the handful of user-facing categories the settings cog offers.
 * Used by BOTH the push sender (server, notify.ts) and the settings pane
 * (client), so this module must not import server-only code.
 *
 * Muting a category suppresses PUSH DELIVERY ONLY. The in-app row is still
 * written and still counts toward the unread badge — the user simply doesn't
 * get a buzz.
 */

import type { NotificationType } from "@/lib/notifications/render";

export type NotificationCategoryKey =
  | "events"
  | "tee_times"
  | "rounds"
  | "following"
  | "mentions"
  | "fantasy";

export type NotificationCategory = {
  key: NotificationCategoryKey;
  label: string;
  description: string;
  types: NotificationType[];
};

/** Display order in the settings pane. */
export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  {
    key: "events",
    label: "Events & entry",
    description: "New events, entry opening and last-chance reminders",
    types: ["event_created", "entry_open", "entry_closing"],
  },
  {
    key: "tee_times",
    label: "Tee times",
    description: "Tee time assignments, reminders and waitlist offers",
    types: ["tee_time_assigned", "tee_time_reminder", "waitlist_offered"],
  },
  {
    key: "rounds",
    label: "Your rounds",
    description: "Rounds scheduled for you, time changes and cancellations",
    types: ["round_scheduled", "round_schedule_changed", "round_cancelled"],
  },
  {
    key: "following",
    label: "People you follow",
    description: "When golfers you follow tee off or post a result",
    types: ["follow_round_started", "follow_round_completed"],
  },
  {
    key: "mentions",
    label: "Mentions",
    description: "When someone tags you in a post or comment",
    types: ["mention_post", "mention_comment"],
  },
  {
    key: "fantasy",
    label: "Fantasy picks",
    description: "Picks and accas settling, winning or being voided",
    types: [
      "fantasy_pick_won",
      "fantasy_pick_lost",
      "fantasy_pick_void",
      "fantasy_parlay_won",
      "fantasy_parlay_lost",
      "fantasy_parlay_void",
    ],
  },
];

/** type → category, built once at module scope. */
const CATEGORY_BY_TYPE = new Map<string, NotificationCategoryKey>(
  NOTIFICATION_CATEGORIES.flatMap((c) => c.types.map((t) => [t as string, c.key] as const))
);

/**
 * Which category a notification type belongs to. Unknown / uncategorised types
 * return null and are never muted — a new type keeps pushing until it is
 * deliberately added to a category above.
 */
export function categoryForType(type: string): NotificationCategoryKey | null {
  return CATEGORY_BY_TYPE.get(type) ?? null;
}
