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
  | "fantasy"
  | "money"
  | "organiser"
  | "social";

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
    description: "New events, entry windows, invitations and results",
    types: [
      "event_created",
      "entry_open",
      "entry_closing",
      "event_invited",
      "event_cancelled",
      "event_results_revealed",
      "event_completed",
      "playoff_started",
      "join_request_approved",
      "event_date_changed",
    ],
  },
  {
    key: "tee_times",
    label: "Tee times",
    description: "Tee time assignments and waitlist offers",
    types: ["tee_time_assigned", "waitlist_offered"],
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
    key: "social",
    label: "Comments & reactions",
    description: "Replies, comments on posts you're in, reactions and new followers",
    types: ["comment_on_post", "comment_reply", "post_reaction", "new_follower"],
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
      "fantasy_season_pick_won",
      "fantasy_season_pick_lost",
      "fantasy_season_pick_void",
    ],
  },
  {
    key: "money",
    label: "Money",
    description: "Prize pot payouts and payments recorded against you",
    types: ["prize_won", "payment_recorded"],
  },
  {
    key: "organiser",
    label: "Organising",
    description: "Join requests, entries and withdrawals for groups you run",
    types: ["join_request_pending", "event_entry_received", "event_withdrawal"],
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

/**
 * Delivery priority — a SEPARATE axis from the mute categories above.
 * Categories are what the user chooses; priority is what the system guarantees
 * when it is throttling. See docs/notifications.md §7.4.
 *
 *  urgent — bypasses the rolling-hour budget AND quiet hours. Reserved for cases
 *           where a delayed buzz means the user physically misses something or
 *           turns up at the wrong time.
 *  high   — bypasses the budget, respects quiet hours. The payoff moments, plus
 *           anything that names the recipient personally.
 *  normal — fully throttleable. Broadcast and high-volume traffic.
 *
 * Muting always wins over priority: an urgent notification in a muted category
 * still does not push.
 */
export type NotificationPriority = "urgent" | "high" | "normal";

const URGENT_TYPES: string[] = [
  "round_schedule_changed",
  "round_cancelled",
  "tee_time_assigned",
  "waitlist_offered",
  "waitlist_expiring",
];

const HIGH_TYPES: string[] = [
  "event_results_revealed",
  "event_completed",
  "event_cancelled",
  "playoff_started",
  "entry_closing",
  "fantasy_pick_won",
  "fantasy_pick_lost",
  "fantasy_pick_void",
  "fantasy_parlay_won",
  "fantasy_parlay_lost",
  "fantasy_parlay_void",
  "fantasy_season_pick_won",
  "fantasy_season_pick_lost",
  "fantasy_season_pick_void",
  "prize_won",
  "mention_post",
  "mention_comment",
  "comment_reply",
  "event_invited",
  "join_request_approved",
  "round_scheduled",
  // Not yet emitted (Tier 3 in docs/notifications.md §2) — classified ahead of
  // time so they inherit the right priority the day they are wired up.
  "round_removed",
  "matchplay_drawn",
];

const PRIORITY_BY_TYPE = new Map<string, NotificationPriority>([
  ...URGENT_TYPES.map((t) => [t, "urgent"] as const),
  ...HIGH_TYPES.map((t) => [t, "high"] as const),
]);

/**
 * Unknown types default to "normal" — deliberately the OPPOSITE asymmetry to
 * categoryForType, which fails open so a new type keeps pushing until it is
 * muteable. A new type should be pushable but throttleable until someone
 * decides it has earned the right to break through a budget.
 */
export function priorityForType(type: string): NotificationPriority {
  return PRIORITY_BY_TYPE.get(type) ?? "normal";
}
