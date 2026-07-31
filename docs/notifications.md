# CIAGA Notifications

**Status:** **built** 2026-07-31 — Tiers 1, 1b, 2 and 3, and all of §7. Two Tier 3 rows
(`matchplay_drawn`, `round_removed`) remain unwired. **Written:** 2026-07-31.
**Related:** `docs/analytics.md`, `docs/legal-compliance.md` (PECR consent for push),
`docs/SECURITY_AUDIT_2026-07-03.md` (VAPID key handling, `push_subscriptions` RLS).

## Executive summary

CIAGA sends notifications through **one funnel, entirely in TypeScript**. No Postgres trigger or
RPC ever writes `user_notifications` — every notification in the app originates from a
`createNotification()` call in application code, which writes an in-app row and then fires a Web
Push. There are **two delivery channels: Web Push and the in-app bell.** No transactional email
exists anywhere in the codebase, and no SMS.

**37 notification type keys are declared, and all of them fire.** The audit that opened this
document found a system that notified well about scheduling and fantasy and not at all about
outcomes, money or being invited — you could win the event and nobody would tell you. That gap
is closed: results revealed, event completed, event cancelled, playoff started, event
invitation, join request approved, prize won, payment recorded, season fantasy settled, and
three organiser alerts all ship. The dead `tee_time_reminder` type — copy, payload shape and a
settings toggle for a notification that could never arrive — has been deleted.

The second problem was structural and had nothing to do with which notifications exist. **A push
fired on every write, including merges** — so a grouped notification that updated forty times
buzzed forty times, even though the in-app card collapsed correctly. There was no cooldown, no
budget, no quiet hours and no priority concept anywhere. That was the real reason the social
notifications could not ship. §7 is the fix: the push decision now runs four gates, and anything
it suppresses is released as a single 08:00 catch-up digest rather than dropped.

With that in place the social loop shipped too — comments, replies, reactions and follows,
including the thread-participant fan-out ("someone commented on a post you commented on") and
the precedence ladder that stops one comment producing three notifications.

§2 is the substance of this document: a single register of every notification — live and
rejected — in one table.

**What remains: browser verification.** None of this has been exercised in a real browser, and
push cannot be tested in `next dev` at all (§3.4) — it needs a production build, and an
installed PWA on iOS.

**Decisions this work was built around:**

| Question | Decision |
|---|---|
| Scheduling for time-based notifications | **Morning-of only** — stay on the single daily cron; no Vercel Pro, no `pg_cron` |
| Audience | **Include organiser/admin alerts**, behind their own preference category |
| Fatigue control (§7) | **All three levers** — per-group cooldown, rolling-hour cap, quiet hours 22:00–08:00 |
| Suppressed pushes | **Deferred, never dropped** — released as one 08:00 catch-up digest |
| Breakthrough set | **Widest** — time-critical, money, payoff moments, and anything addressed to you personally |

---

## 1. How it works today — the pipeline

**One writer.** `apps/app/lib/notifications/notify.ts` is the only path to a notification:

- `createNotification()` inserts the `user_notifications` row, then **synchronously** calls
  `sendPushToProfiles` for that one recipient.
- `createNotificationsForMany()` resolves push permission once for the whole set (one query),
  then `Promise.allSettled`s a `createNotification` per recipient.
- Two helpers wrap it for the fan-out cases: `notifyRoundSchedule()`
  (`lib/notifications/roundSchedule.ts`) and `notifyFollowersOfRoundActivity()`
  (`lib/notifications/roundActivity.ts`).

Everything is best-effort — a failed notification never fails the action that caused it.

**One renderer.** `apps/app/lib/notifications/render.ts` maps `(type, payload)` to
`{title, body, url, icon}` through a single switch, shared by the bell (client) and the push
sender (server). It must not import server-only code. `APP_TIME_ZONE = "Europe/London"` is
pinned explicitly because Vercel Node runs UTC — without it, push bodies render tee times in
the wrong timezone while the in-app bell renders them correctly.

**Grouping.** Passing a `groupKey` merges into an existing *unread* row with the same
`(profile_id, group_key)` instead of inserting: actors are deduped, `count` recomputed,
`updated_at` bumped and `read` reset to false. The push is tagged with the same key so the OS
coalesces on-device. Groups in use: `follow_started:<roundId>`, `follow_completed:<roundId>`,
`<round_scheduled|round_schedule_changed|round_cancelled>:<roundId>`; the organiser ones —
`join_request_pending:<groupId>`, `event_entry_received:<eventId>`,
`event_withdrawal:<eventId>` — which collapse an entry rush into one card; and the social ones —
`comment_on_post:<feedItemId>`, `post_reaction:<feedItemId>`, `new_follower:<recipientId>`.

**Actors are capped** at 10 per payload, with the true figure carried in `total_count` (§7.8).
Without the cap a post with 500 reactions stored 500 actor objects in jsonb *on every
recipient's row*. `formatActorNames` reads `total_count`, so the copy still says "and 498
others", and the expandable list in the bell says "and N more" rather than silently showing a
partial list.

**Preferences.** `apps/app/lib/notifications/preferences.ts` buckets types into nine categories
(`events`, `tee_times`, `rounds`, `following`, `mentions`, `social`, `fantasy`, `money`,
`organiser`).
Note the semantics carefully: **muting suppresses push delivery only.** The in-app row is still
written and still counts toward the unread badge — the user just doesn't get a buzz. A type with
no category is never muted, so a newly added type keeps pushing until it is deliberately
categorised.

The same module also carries the **delivery priority** map (§7.4). Priority is a separate axis
from category: categories are what the user chooses, priority is what the system guarantees when
it is throttling. Muting always wins over priority.

**Push.** `lib/push/sendPush.ts` (VAPID, prunes dead 404/410 endpoints, returns per-endpoint
diagnostics), `lib/push/clientPush.ts` (registration — every step timeout-wrapped because iOS
WebKit hangs forever, and a subscription whose `applicationServerKey` no longer matches is
dropped and re-created). Service worker: `apps/app/worker/index.js` handles `push`,
`notificationclick` and the app-icon badge. iOS requires an installed PWA.

**Storage.**

| Table | Migration | Notes |
|---|---|---|
| `user_notifications` | `20260422000005_user_notifications.sql` | `type` is free **text**, not an enum — adding a type needs no migration. Plus `payload jsonb`, `read`, `group_key` |
| `push_subscriptions` | `20260625000001_notifications_push_announcements.sql` | `endpoint` unique; owner-or-`service_role` RLS |
| `notification_preferences` | `20260724000000_notification_preferences.sql` | `muted_categories text[]`; absent row = nothing muted |
| `user_notifications.last_pushed_at` / `.digested_at` | `20260731000000_notification_delivery_intelligence.sql` | Throttling state — see §7.5 |

`user_notifications` is in the `supabase_realtime` publication, which is what makes the bell
live. `events.entry_open_notified_at` / `entry_closing_notified_at` are once-per-event guards.

**UI.** `components/notifications/NotificationCenter.tsx` (bottom sheet, All/Unread tabs,
settings cog), bell and unread badge in `app/home/HomeClient.tsx`, data + realtime in
`lib/notifications/useNotifications.ts`. There is no `/settings` route — notification
preferences live inside the notification sheet.

---

## 2. The register

Every notification, **live and proposed, in one table**, ordered by domain so the holes sit
next to what exists. `Status` is a column to scan, not a section heading.

Status values: **Live** (shipping) · **Dead** (declared but never fired — now deleted) ·
**Tier 2** (next) · **Tier 3** (deferred, blocked on §7.7) · **Future** (accepted, not yet
scheduled) · **Rejected** (decided against — reason in the row).

`Push` column: every live notification pushes by default, subject to the recipient's category
mute **and the four delivery gates in §7.3**. "grouped" means it merges into an unread row and
coalesces on-device.

### Events, competitions and seasons

| Type | Status | Category | Sent to | Fires when | Trigger site | Push |
|---|---|---|---|---|---|---|
| `event_created` | Live | events | Other active group members | An event is created in a group | `api/majors/events/route.ts:187` | yes |
| `entry_open` | Live | events | Active group members | Event created with its window already open, **or** the daily sweep finds a window that has opened | `api/majors/events/route.ts:190`; `lib/notifications/entryOpenSweep.ts:50` | yes |
| `entry_closing` | Live | events | Active members who have **not** entered | The entry window ends later today (UK local) | `lib/notifications/entryClosingSweep.ts:100` | yes |
| `event_invited` | **Live** | events | The invitee | An organiser sends a direct event invitation — today this is pull-only, so invites are missed by default | `api/majors/events/[id]/invitations/route.ts` | — |
| `event_results_revealed` | **Live** | events | Active group members | A frozen leaderboard is revealed, manually or automatically — **only once all rounds are in** | `api/majors/events/[id]/freeze-control/route.ts`; `ciaga_check_leaderboard_auto_reveal` | yes |
| `event_completed` | **Live** | events | Active group members | The event transitions to `completed` | `lib/majors/reconcileStatus.ts:198` | yes |
| `playoff_started` | **Live** | events | Players in the playoff | A sudden-death playoff is created / becomes active | `api/majors/events/[id]/playoff/route.ts` | — |
| `join_request_approved` | **Live** | events | The requester | Their membership flips to `active` | `api/majors/groups/[id]/members/route.ts` | — |
| `event_cancelled` | **Live** | events | Entrants | `majors_status` set to `cancelled` — entrants are currently never told | `api/majors/events/[id]/route.ts` (PATCH) | — |
| `event_date_changed` | **Live** | events | Entrants | `event_date` or the entry window is moved after entries exist | `api/majors/events/[id]/route.ts` (PATCH) | — |
| `announcement_published` | **Rejected** | events | All members | The in-app modal is considered sufficient — an announcement is not time-critical | `api/admin/announcements/route.ts` | — |
| `terms_updated` | **Rejected** | events | All members | The re-acceptance gate appears on next load and blocks until actioned; a push adds nothing | `lib/legal.ts` | — |
| `matchplay_drawn` | Tier 3 | events | Both players | The bracket advances and the next fixture is set | `api/majors/events/[id]/bracket/advance/route.ts` | yes |
| *season standings movement* | **Rejected** | — | — | Standings are recomputed on read — there is no state transition to hook | `api/majors/group-seasons/[id]/standings/route.ts` | n/a |

### Tee times

| Type | Status | Category | Sent to | Fires when | Trigger site | Push |
|---|---|---|---|---|---|---|
| `tee_time_assigned` | Live | tee_times | Non-guest players in the tee time | An organiser publishes tee times, or a player self-joins an open slot | `api/majors/events/[id]/tee-times/route.ts:265`; `.../[tee_time_id]/join/route.ts:160` | yes |
| `tee_time_reminder` | **Dead → deleted** | — | — | Never fired. Had copy, a payload shape and a settings toggle, and no emitter anywhere. Removed from `render.ts` and `preferences.ts` | — | n/a |
| `tee_time_reminder` *(revive)* | **Rejected** | tee_times | Players teeing off today | A morning-of nudge for a tee time you already know about is not worth the buzz. The dead type above should simply be deleted | — | — |
| `waitlist_offered` | **Future** | tee_times | The next waiting entrant | Someone withdraws from a waitlist-enabled event, promoting them to `offered` (48h expiry). Live in code today; parked pending the waitlist feature landing properly | `api/majors/events/[id]/withdraw/route.ts:161` | yes |
| `waitlist_expiring` | **Future** | tee_times | The offered entrant | Their 48h offer is nearly up. **Note:** no expiry code exists at all today — offers never lapse | *no code exists* | — |

### Rounds

| Type | Status | Category | Sent to | Fires when | Trigger site | Push |
|---|---|---|---|---|---|---|
| `round_scheduled` | Live | rounds | Added participants | Added to an already-scheduled round; a draft is promoted to scheduled; a Majors tee-time PATCH adds players | `api/rounds/add-participant/route.ts:79`; `api/rounds/update-settings/route.ts:116`; `.../[tee_time_id]/route.ts:201` | grouped |
| `round_schedule_changed` | Live | rounds | Participants | `scheduled_at` changes on a scheduled round | `api/rounds/update-settings/route.ts:116`; `.../[tee_time_id]/route.ts:215` | grouped |
| `round_cancelled` | Live | rounds | Participants (captured *before* the delete) | A scheduled round is deleted, or a tee time is deleted and cascades its round | `api/rounds/delete-draft/route.ts:136`; `.../[tee_time_id]/route.ts:306` | grouped |
| `follow_round_started` | Live | following | Followers of participants, plus co-players | A round goes live | `api/rounds/start/route.ts:310` → `lib/notifications/roundActivity.ts:139` | grouped |
| `follow_round_completed` | Live | following | Followers, plus co-players | A round is finished, manually or by the auto-complete cron. Body carries the winner, match-play margin and a 🏆 course-record callout | `lib/rounds/finishRound.ts:82` → `roundActivity.ts:139` | grouped |
| `handicap_changed` | **Rejected** | rounds | The player | Handicap movement is visible on the profile and expected after every round. Bulk imports would also fire it for everyone at once | DB trigger `recalc_profiles_when_round_finishes` | — |
| `round_today` | **Rejected** | rounds | Participants | Duplicates a tee-time reminder for a round the player scheduled themselves | — | — |
| `round_removed` | Tier 3 | rounds | The removed player | An owner removes a participant — they are currently never told | `api/rounds/remove-participant/route.ts` | yes |
| `personal_best` | **Rejected** | following | The player | The feed card already celebrates it; a push would fire on a large share of rounds | `lib/feed/generators/achievements.ts` | — |
| *per-hole scoring* | **Rejected** | — | — | Far too noisy, and the scorecard is already live and realtime | `app/round/[round_id]/RoundDetailClient.tsx` | n/a |

### Fantasy

| Type | Status | Category | Sent to | Fires when | Trigger site | Push |
|---|---|---|---|---|---|---|
| `fantasy_pick_won` / `_lost` / `_void` | Live | fantasy | The pick owner | Event or round markets settle. Type is built dynamically as `` `fantasy_pick_${status}` `` | `lib/fantasy/settlement.ts:500` | yes |
| `fantasy_parlay_won` / `_lost` / `_void` | Live | fantasy | The parlay owner | All legs settle and the acca finalises | `lib/fantasy/settlement.ts:320` | yes |
| `fantasy_season_pick_*` | **Live** | fantasy | The season pick owner | Season-long markets settle. **Currently silent** — `seasonSettlement.ts` contains zero `createNotification` calls, unlike event and round settlement | `lib/fantasy/seasonSettlement.ts` | — |
| `fantasy_book_open` | **Rejected** | fantasy | Group members | `event_created` and `entry_open` already announce the event; the book opening is discoverable from there | `lib/fantasy/odds.ts` (`generateEventFantasy`) | — |
| `fantasy_wallet_credited` | **Rejected** | fantasy | The recipient | Visible in the wallet next time they open fantasy — not worth a buzz | `lib/fantasy/wallet.ts` | — |
| *cash-out available / expiring* | **Rejected** | — | — | The archetypal push, but it needs a sub-daily cron we have decided not to buy. Revisit if the scheduler decision changes | `lib/fantasy/cashout.ts`, `cronSweeps.ts` | n/a |
| *odds refresh / market staleness* | **Rejected** | — | — | Five DB triggers mark books stale — this would fire constantly. Pure noise | `20260708000001_fantasy_odds.sql` | n/a |

### Money — proposed new `money` category

Nothing in this domain notifies today, in either direction. Money **in** is worth a push; money
**owed** is not — chasing subs is a job for the group's own screens, not the notification system.

| Type | Status | Category | Sent to | Fires when | Trigger site | Push |
|---|---|---|---|---|---|---|
| `prize_won` | **Live** | money | Payees | A prize pot is distributed | `api/majors/prize-pots/[potId]/distribute/route.ts` | yes |
| `payment_recorded` | **Live** | money | The player | Their charge is marked paid — a receipt | `api/majors/events/[id]/player-charges/[playerChargeId]/pay/route.ts` | — |
| `charge_assigned` | **Rejected** | money | The charged player | "You owe £15" is a nag, and charges are auto-assigned on entry — the player already knows they entered | `api/majors/events/[id]/charges/[chargeId]/assign/route.ts` | — |
| `balance_outstanding` | **Rejected** | money | Members in debit | A recurring debt-chasing push is the fastest way to get notifications disabled wholesale | `api/majors/groups/[id]/balances/route.ts` | — |

### Social

| Type | Status | Category | Sent to | Fires when | Trigger site | Push |
|---|---|---|---|---|---|---|
| `mention_post` | Live | mentions | Tagged profiles (author excluded), re-checked against feed-item visibility | A post is created with `tagged_profiles`. Deep-links to `/social/<feed_item_id>` | `lib/feed/commands.ts:96` | yes |
| `mention_comment` | Live | mentions | Mentioned profiles, re-checked against feed-item visibility | A comment contains @-mentions. Deep-links to `/social/<feed_item_id>` | `lib/feed/commands.ts:229` | yes |
| `comment_on_post` | **Live** | social | The post author **and everyone who has commented on the thread** | Someone comments on a post you wrote or replied to — only mentions fire today. See §7.7 | `lib/feed/commands.ts` (`createComment`) | grouped |
| `comment_reply` | **Live** | social | The parent commenter | Someone replies directly to your comment | `lib/feed/commands.ts` (`parentCommentId`) | yes |
| `post_reaction` | **Live** | social | The post author | Someone reacts to your post | `lib/feed/commands.ts` (`setReaction`) | grouped |
| `new_follower` | **Live** | social | The followed player | Someone follows you | `api/friends/invite/route.ts` | grouped |
| `circle_added` | **Rejected** | social | The added member | Circles are a private organising tool for the person who made them — being listed in one is not an event | `api/calendar/circles/[id]/members/route.ts` | — |
| `circle_free_same_day` | **Rejected** | social | Circle members | Would fire on ordinary calendar admin, for a coincidence the user may not care about | `lib/calendar/api.ts` (`fetchLookingForRound`) | — |
| `invite_accepted` | **Rejected** | social | The inviter | The new member shows up in the group list; a push adds nothing actionable | `api/invites/redeem/route.ts` | — |

### Organiser and moderation — proposed new `organiser` category

Nothing tells an admin that anything is waiting for them.

| Type | Status | Category | Sent to | Fires when | Trigger site | Push |
|---|---|---|---|---|---|---|
| `join_request_pending` | **Live** | organiser | Group admins | A join request is created with status `pending` — it can currently sit forever | `api/majors/groups/[id]/join/route.ts` | — |
| `event_entry_received` | **Live** | organiser | The event organiser | Someone enters their event | `api/majors/events/[id]/enter/route.ts` | — |
| `event_withdrawal` | **Live** | organiser | The event organiser | Someone withdraws | `api/majors/events/[id]/withdraw/route.ts` | — |
| `content_reported` | **Rejected** | organiser | Moderators | Deferred to a moderation dashboard at a later date — a push with nowhere to land is half a fix | `api/reports/route.ts` | — |

### How the live ones fire

The register can't carry this, so: notifications reach users by exactly three routes.

1. **Inline on a user action** — the majority. The API route or `lib/` command that performs
   the mutation awaits the notification before returning.
2. **On settlement** — the fantasy types, from `lib/fantasy/settlement.ts`, itself driven by
   `reconcileStatus.ts`, the odds refresh job, the daily sweeps, or an admin manual settle.
3. **On the daily cron** — `entry_open` and `entry_closing`, plus the `follow_round_completed`
   pushes that fall out of auto-completing abandoned rounds
   (`api/cron/auto-complete-rounds/route.ts`).

---

## 3. Constraints

These shape every proposal above, so they are stated before the backlog rather than after.

**1. One cron a day, at 08:00 UTC.** `apps/app/vercel.json` schedules exactly one job, because
Vercel Hobby permits one per day. That job already carries round auto-completion, event status
reconcile, both entry-window sweeps and the fantasy sweeps. The 08:00 slot was chosen
deliberately *because* it pushes — it has to land at an hour people can act on.

**The decision recorded here is to stay on it.** Every time-based notification is therefore
morning-of, never T-minus. `pg_cron` is not an available alternative: `pg_net` is explicitly
dropped in `supabase/migrations/20260120144116_remote_schema.sql:1`, so the database cannot
make HTTP calls, and re-enabling it would mean moving notification logic DB-side against the
grain of the entire system.

**2. Fan-out is inline and unbatched.** A 30-member group means 30 inserts, 30 unread-count
queries and 30 web-push calls inside one request or cron invocation. Fine at society scale;
worth knowing before adding a notification that fans out to everyone.

**3. ~~No quiet hours, no rate limiting, no digest.~~ RESOLVED by §7.** This was the binding
constraint: every emit was immediate and a push fired on every write including merges, so a
grouped notification that updated 40 times buzzed 40 times. The push decision now runs four
gates and suppressed pushes are released by the 08:00 digest. `group_key` merging is still the
only coalescing of the in-app *row*, and it still only merges into rows that are unread.

**4. Push is production-build only.** `next.config.mjs:119` sets `disable: !isProd`, so the
service worker does not exist in `next dev`. Push cannot be tested locally — only on a deployed
build, and on iOS only from an installed PWA.

**5. The six categories are coarse.** A user who wants results but not fantasy chatter is well
served. One who wants mentions but not reactions is not — both would sit in `mentions`/`social`.
Tier 1 adds `money` and `organiser`; Tier 3 would want per-type opt-outs rather than a seventh
bucket. Note this is a *preference* axis and is independent of the *priority* axis in §7.4 —
muting is what the user chooses, priority is what the system guarantees.

**6. The bell exists only on the home screen.** There is no unread affordance anywhere else in
the app, so notification value drops sharply once a user is deeper in a flow.

---

## 4. Defects and loose ends

Small, factual, each verified against the code. **All but one are now fixed** — kept here as a
record of what was wrong and where, since several were invisible from the outside.

- ~~**`tee_time_reminder` is a dead type.**~~ **Fixed** — deleted. It was declared, rendered,
  categorised and shown in the settings pane, with a payload documented in
  `20260422000005_user_notifications.sql:8`, and **no emitter anywhere in the repo**. We were
  offering users a toggle for a notification that could not arrive.
- ~~**Season fantasy settles silently.**~~ **Fixed** — `lib/fantasy/seasonSettlement.ts` now
  notifies via `fantasy_season_pick_*`, matching event and round settlement. It had zero
  `createNotification` calls; an inconsistency, not a decision.
- ~~**Three icon keys fall through to `Bell`.**~~ **Fixed** — `rotate-ccw`, `calendar-clock` and
  `calendar-x` were emitted by `render.ts` but absent from the `ICONS` map, so those cards
  silently showed a generic bell. The map now covers every key the renderer emits.
- ~~**A stale duplicate type union.**~~ **Fixed** — `lib/majors/types.ts` declared a
  three-member `NotificationType` and a `UserNotification` missing `group_key`/`updated_at`.
  Deleted in favour of `render.ts`, which nothing had been importing it over anyway.
- ~~**`mention_post` skips the visibility check that `mention_comment` performs.**~~ **Fixed** —
  `createUserPost` now calls `assertViewerCanReadFeedItem` per mentioned profile, as
  `createComment` already did. Tagging a non-follower in a `followers`-audience post used to
  notify them about something they could not open.
- ~~**Mentions deep-link to the feed, not the post.**~~ **Fixed** — both mention types now link
  to `/social/<feed_item_id>`. The route existed and the payload had carried `feed_item_id` all
  along; the notification just wasn't using it.
- ~~**The bell badge can undercount.**~~ **Fixed** — `useNotifications` counted unread from the
  loaded page (`limit = 50`), so above 50 unread the in-app badge stuck while the app-icon badge
  (which `notify.ts` computes with `count: exact`) showed the real figure. It now runs its own
  `count: exact`, with optimistic decrements on mark-read so the badge still drops instantly.
- **Announcements never notify.** `api/admin/announcements/route.ts` publishes an in-app modal
  only — no row, no push. Recorded as behaviour rather than a gap: the register rejects
  `announcement_published`, so the modal is the intended channel.

---

## 5. The backlog — why each tier sat where it did

The rows live in the §2 register. This section explains the tiering, and is kept as the record
of *why* — including for the tiers now shipped.

**Tier 1 — the payoff and personal moments. SHIPPED.** Eight notifications, every one hooking a
code path that already existed and already knew its recipients. No migration (the `type` column
is free text), no new infrastructure, no scheduler change. They shared a single characteristic:
*they were things the user would want to know and found out by chance.* The event ones (results
revealed, event completed, playoff started) are the product's payoff; the personal ones
(invited, approved, paid out) are the ones a member would be annoyed to have missed.
`fantasy_season_pick_*` was in Tier 1 because it closed a defect rather than adding a feature.

The Tier 1 line was drawn deliberately tightly. Three candidates were considered and **rejected
for being routine rather than notable**: `handicap_changed` (moves after most rounds, and bulk
imports would fire it for the whole society at once), `charge_assigned` (a nag — the player just
entered, they know they owe), and `announcement_published` (the in-app modal is the channel).
The register keeps them as rows with those reasons so they are not re-proposed.

Two implementation notes worth carrying forward. **`event_results_revealed` and
`event_completed` are mutually exclusive**: a reveal is the results moment, so
`reconcileEventStatus` suppresses its own completion notification when
`leaderboard_freeze_state === "revealed"`, or the same moment would buzz twice. And all three
**organiser types are grouped per event/group** (`event_entry_received:<eventId>` etc.) because
a popular event opening produces dozens of entries in an hour.

**Tier 1b — organiser alerts. SHIPPED.** Three notifications, same effort profile, behind a new
`organiser` preference category so ordinary members are not opted into admin noise. Shipped
alongside Tier 1 rather than after it, because the join-request one fixes a real failure mode:
requests sat pending indefinitely with nothing surfacing them. `content_reported`
was cut from this tier for a structural reason — there is no moderation queue for it to link
to, so the notification would be half a fix. It returns when the mod dashboard exists.

All three organiser types are **bursty**: a popular event opening can produce dozens of
`event_entry_received` in an hour. They are classified `normal` priority in §7.4 precisely so
the budget absorbs that, and grouped so the card collapses.

**Tier 2 — second-order changes. SHIPPED.** `event_date_changed` and `payment_recorded`: useful,
not urgent, and neither is a reminder. **No morning-of reminders survived triage** —
`tee_time_reminder` and `round_today` were both rejected as nudges about something the user
scheduled themselves. The daily cron therefore carries the entry-window sweeps and the §7.6
catch-up digest, and no reminders at all.

**Tier 3 — the social loop. SHIPPED, and it was right to go last.** Deferred not because the
items are low value but because **the prerequisite was delivery intelligence, not just finer
muting**. `comment_on_post`, `post_reaction` and `new_follower` are the highest-volume types in
the register, and shipping them against push-on-every-write would have made the app unusable on
a busy thread — 40 reactions was 40 buzzes. With §7 in place they are safe: all three are
`normal` priority and grouped, so the budget and the per-group cooldown absorb them.

They also needed a new `social` mute category. Putting them in `mentions` would have forced a
user who wants to know when they're tagged to also accept every reaction — the exact coarseness
§3.5 warned about.

One change fell out of this tier that is worth noting because it altered an existing surface:
**follows now go through `POST /api/follows`** rather than a client-side insert. The notification
has to originate server-side, and leaving the write on the client would have made it skippable
by anyone calling the table directly. The RLS insert policy remains as the backstop.

**Rejected.** Eighteen rows — the largest status in the register — kept with their reasons so
they are not re-proposed in six months. They fall into five groups:

- **Structurally impossible or pointless** — season standings movement (recomputed on read, no
  transition to hook), odds refresh and market staleness (five DB triggers, would fire
  constantly), per-hole scoring (the scorecard is already realtime).
- **Needs a scheduler we chose not to buy** — fantasy cash-out availability and expiry, true
  T-minus tee-time reminders.
- **Routine, not notable** — `handicap_changed`, `personal_best`, `fantasy_wallet_credited`,
  `fantasy_book_open`, `invite_accepted`, `circle_added`, `circle_free_same_day`,
  `round_today`, `tee_time_reminder` (revive). Each fires often enough that a push devalues the
  channel.
- **Would nag** — `charge_assigned`, `balance_outstanding`. Debt-chasing pushes are the fastest
  route to a user disabling notifications wholesale, which costs us Tier 1 as collateral.
- **Blocked on something else** — `content_reported`, pending a moderation dashboard;
  `announcement_published` and `terms_updated`, where an in-app gate already does the job.

---

## 6. What shipped, and what is next

**Shipped 2026-07-31** — Tiers 1, 1b, 2 and 3, every §4 defect, and all of §7. Files touched:

| Area | Files |
|---|---|
| Types, copy, deep links | `lib/notifications/render.ts` |
| Categories + priority map | `lib/notifications/preferences.ts` |
| Push gates + actor cap | `lib/notifications/notify.ts` |
| Majors fan-out | `lib/notifications/majorsActivity.ts` (new) |
| Social fan-out, thread following | `lib/notifications/socialActivity.ts` (new) |
| Catch-up digest | `lib/notifications/catchUpDigest.ts` (new), wired into `api/cron/auto-complete-rounds/route.ts` |
| Follow write moved server-side | `app/api/follows/route.ts` (new), `components/profile/ProfileScreen.tsx` |
| Icons, grouped-actor list, badge | `components/notifications/NotificationCenter.tsx`, `lib/notifications/useNotifications.ts` |
| Migration | `20260731000000_notification_delivery_intelligence.sql` |

**What is not done: browser verification.** None of this has been exercised in a real browser.
Push in particular cannot be tested in `next dev` at all (§3.4) — it needs a production build,
and on iOS an installed PWA. The highest-value things to check first are the ones with the most
moving parts: the precedence ladder (comment on your own post, having been @-mentioned in it,
should produce exactly one notification) and the digest (suppress something overnight, confirm
one push at 08:00 and no duplicate bell rows).

Two things to remember when implementing, both learned the hard way and encoded in the code:
`renderNotification` runs **server-side** for push bodies, so anything time-formatted must go
through `APP_TIME_ZONE`; and the `icon` field is a lucide key for the bell, **not** a URL —
passing it to the push payload resolves to a 404 and kills the notification icon.

---

## 7. Delivery intelligence — aggregation, throttling and priority

**Status: BUILT** (2026-07-31), in full. This section specifies how notifications get
*delivered* rather than which ones exist.

### 7.1 The problem it solved

`createNotification` used to fire a device push on **every write, including merges**. That was
survivable for the original 19 types, all low-frequency by nature. It was not survivable for the
social types, and that — not muting granularity — was the real reason they stayed parked:

- A post with 40 reactions was **40 pushes**. The in-app card collapsed correctly; the phone did
  not.
- An active thread pushed once per comment, indefinitely, to every participant.
- A user who joins a group, has a round finish, and gets two picks settled inside a minute
  received four unrelated buzzes with no coordination between them.

There was no server-side rate limiting anywhere in the app to build on — this was greenfield.
The only near-misses were Supabase Auth error *classifiers* (`lib/server/managedProfiles.ts:16`,
which reads a 429 rather than enforcing one) and a client-side localStorage cooldown for the
push-permission prompt (`lib/notifications/usePushPrompt.ts:23`).

### 7.2 What was already there

The expensive half of aggregation already existed. `createNotification`'s `groupKey` path:

- finds the newest **unread** row for `(profile_id, group_key)` and merges into it rather than
  inserting — `mergeGroupedPayload` dedupes `payload.actors` by `profile_id` and recomputes
  `payload.count`;
- bumps `updated_at` and resets `read` to false, so the card resurfaces;
- tags the push with the `groupKey` so the OS coalesces the *displayed* notification.

`formatActorNames` (`render.ts:56`) already renders `"Alice"` → `"Alice and Bob"` →
`"Alice, Bob and 2 others"`. And `resolvePushRecipients` establishes the pattern this section
extends: **one batched query per fan-out, resolved once and passed down per recipient**, never
N+1.

One behaviour looks like a bug and is not: **merging only applies to unread rows.** Once a user
reads the card, the next comment creates a fresh row rather than reviving the old one. That is
correct — it is genuinely new activity since they last looked. The cooldown below is what stops
it buzzing, not a change to the merge.

### 7.3 The push decision

Today the decision is one question: is the category muted? Proposed, it becomes four gates,
evaluated in order and short-circuiting on the first refusal. **The in-app row is written
regardless, at every gate** — consistent with the existing mute semantics in §1.

| # | Gate | Applies to | Rule |
|---|---|---|---|
| 1 | Category mute | all | Unchanged — existing `resolvePushRecipients` |
| 2 | **Per-group cooldown** | **all, no exceptions** | If this `(profile_id, group_key)` was pushed within ~15 min, merge silently |
| 3 | **Quiet hours** | all but `urgent` | 22:00–08:00 Europe/London → hold for the digest |
| 4 | **Rolling-hour cap** | all but `urgent` and `high` | Max ~5 pushes per user per hour |

Two properties of this ordering are deliberate.

**The per-group cooldown binds even the highest-priority types.** It is an anti-spam floor, not
a preference. A direct reply to your comment is personal enough to bypass the budget — but forty
of them must never be forty buzzes. This single gate is what answers "stop firing push after the
first, keep updating the card".

**Quiet hours end at 08:00, not 07:00.** That is not a comfort judgement; it is so held pushes
are released by the daily cron we already have (§3.1) rather than needing a scheduler we
decided not to buy.

A daily cap was considered and rejected — it is blunter than the rolling hour and would silence
a genuinely busy competition day.

### 7.4 Priority classes

Three levels, defined in `lib/notifications/preferences.ts` alongside the categories — same
client-safe module, same shape as `CATEGORY_BY_TYPE`, so the settings pane can explain the
behaviour if we ever want it to.

**`urgent`** — bypasses the budget *and* quiet hours. Reserved for cases where a delayed buzz
means the user physically misses something or turns up at the wrong time:

> `round_schedule_changed`, `round_cancelled`, `tee_time_assigned`, `waitlist_offered`,
> `waitlist_expiring`

**`high`** — bypasses the budget, respects quiet hours. The payoff moments, plus anything that
names you personally:

> `event_results_revealed`, `event_completed`, `playoff_started`, `entry_closing`,
> `fantasy_pick_*`, `fantasy_parlay_*`, `fantasy_season_pick_*`, `prize_won`, `mention_post`,
> `mention_comment`, `comment_reply`, `event_invited`, `join_request_approved`,
> `round_scheduled`, `round_removed`, `matchplay_drawn`

**`normal`** — everything else, fully throttleable.

The sanity check that makes this credible is what `normal` leaves exposed: `event_created`,
`entry_open`, `event_date_changed`, `follow_round_started`, `follow_round_completed`,
`payment_recorded`, `comment_on_post`, `post_reaction`, `new_follower`, and the three organiser
types. That is precisely the broadcast and high-volume traffic — group-wide announcements,
follow activity, thread noise and entry churn. The budget bites exactly where it should and
nowhere else.

**Unclassified types default to `normal`.** Note this is the opposite of `categoryForType`,
which fails *open* so a new type keeps pushing until deliberately muted. The asymmetry is
intentional: a new type should stay **pushable but throttleable** until someone decides it
deserves to break through.

### 7.5 Schema

**Two columns on `user_notifications`.** One migration, no new table, nothing else touched.

| Column | Purpose |
|---|---|
| `last_pushed_at timestamptz` | Stamped when a real individual push is sent for this row |
| `digested_at timestamptz` | Stamped when a row is covered by a catch-up digest |

`last_pushed_at` alone serves all three new gates: cooldown compares it against now, the budget
counts rows with it inside the last hour, and digest eligibility is `IS NULL`.

**Why `digested_at` is not redundant.** The digest stamps many rows at a single instant. If it
wrote `last_pushed_at`, those rows would read as N pushes in the budget window and silence the
user for the hour after every digest — the machinery would throttle itself. Keeping them
separate means the budget counts only genuine individual pushes.

Index: partial on `(profile_id, last_pushed_at)` for the rolling-hour count.

Both gates that need a per-recipient answer (cooldown, budget) should be resolved **in the same
batched pass as `resolvePushRecipients`**, not per recipient — a 30-member fan-out must not
become 90 queries. The natural shape is to widen that function into a single
`resolvePushDecision(profileIds, type)` returning the allowed set.

### 7.6 The 08:00 catch-up digest

Runs as one more step on `api/cron/auto-complete-rounds/route.ts`, alongside the entry sweeps
and in the same best-effort try/catch shape as `runEntryOpenNotifications`.

Per profile, it selects unread rows where `last_pushed_at IS NULL AND digested_at IS NULL`,
collapses them **by type**, and sends a single push:

> **You've missed a few things**
> 10 new followers · 3 new events in Sunday Swingers · 6 comments

Then stamps `digested_at` on every row it covered.

Two things it deliberately does not do. It **creates no notification row** — the digest is a
push over rows that already exist, so the bell is untouched and nothing is double-counted. And
it **does not respect the rolling-hour budget**, because it is the mechanism that makes the
budget acceptable; suppressing the digest would strand notifications permanently.

Deep link: `/home` with the bell open, since a digest spans types.

This is the piece that satisfies "some notifications should still force their way through, even
if they collapse to *You have 10 new followers*". Nothing is dropped — it is deferred to a
single daily buzz.

### 7.7 Thread following

Extends `comment_on_post` from the post author to everyone in the thread — "someone commented on
a post you commented on". All of it lives in `lib/notifications/socialActivity.ts`.

**A participant query.** Nothing returned distinct commenters for an item. The nearest were
`getTopComments` (`lib/feed/queries.ts:376`, which fetches commenter profile ids but keeps only
the top one per item) and the thread route (`api/feed/[id]/comments/route.ts`, capped at 200
full rows). `getThreadParticipantIds(feedItemId)` now does
`select("profile_id").eq("feed_item_id", …).neq("visibility", "removed")`, deduped in JS. Note
`feed_comments` has no index on `profile_id`; the existing
`feed_comments_item_created_idx (feed_item_id, created_at)` covers the lookup but is not
covering for the projection.

**Recipients** = post author + prior commenters, minus the actor. The author is
`feed_items.actor_profile_id` — a direct column, but **nullable**, so `getFeedItemOwnerIds`
falls back to `feed_item_subjects` for system-generated cards.

**A batched visibility check.** `assertViewerCanReadFeedItem` (`lib/feed/commands.ts:29`) is
module-private and does one query per recipient; a thread fan-out would multiply that.
`filterViewersWhoCanReadFeedItem` is the set version — one `.in("viewer_profile_id", ids)`
against `feed_item_targets` returning a `Set`, mirroring `resolvePushRecipients`. It **fails
closed**, unlike the push-preference lookup: a failure there costs a buzz, a failure here would
leak a post's existence to people outside its audience.

Known wrinkle, unchanged: `feed_item_targets` is a snapshot written at post time, so a
participant who later unfollowed may be silently dropped. That is the correct outcome for
visibility, but it means the participant list and the notified list can differ.

**A precedence ladder.** One comment produces **at most one notification per person**:

> `mention_comment` > `comment_reply` > `comment_on_post`

Without it, being @-named in a reply on your own post fires three notifications for one event.
`createComment` accumulates the mention recipients it has already handled and passes them to
`notifyThreadActivity` as `alreadyNotified`; each lower rung filters against that set.

The last rung fans out **twice** with different copy — the author reads "commented on your post",
a fellow commenter reads "a post you commented on". Group keys are scoped per recipient, so the
two fan-outs cannot collide.

**Grouping keys** for the aggregating types:

| Type | Group key | Collapses to |
|---|---|---|
| `comment_on_post` | `comment_on_post:<feedItemId>` | "Alice, Bob and 4 others commented on your post" |
| `post_reaction` | `post_reaction:<feedItemId>` | "Alice, Bob and 12 others reacted to your post" |
| `new_follower` | `new_follower:<recipientId>` | "You have 10 new followers" |

`new_follower` has no natural parent object, so it groups per recipient — which is exactly what
produces "You have 10 new followers".

`comment_reply` is deliberately **not** grouped: a direct reply is a conversation, and the
per-group cooldown in §7.3 already prevents a reply storm from becoming a buzz storm.

Changing an existing reaction's emoji does **not** notify. The author was told when that person
first reacted, and swapping 👍 for 🎉 is not news.

**Deep link.** `/social/[id]` is a real per-post detail page (`app/social/[id]/page.tsx` →
`getFeedItemById` + `getFeedItemDetail`), and all four social types plus both mention types use
it. The mentions previously pointed at `/social` and left the user scrolling for the thing they
were tagged in, even though the payload had carried `feed_item_id` all along.

### 7.8 Payload growth

`mergeGroupedPayload` used to append actors without bound: a post with 500 reactions stored 500
actor objects in `payload` jsonb — on **every recipient's row**. Nothing hit this while the
grouped types were rounds and follows, with naturally small actor sets; reactions are the first
type that reaches it realistically.

Stored actors are now capped at 10, with the true figure carried in `total_count`.
`formatActorNames` takes that count as a second argument rather than reading `actors.length`, so
the copy still says "and 498 others". One consequence worth knowing: **`total_count` cannot be
derived from the array once capped**, so the merge counts how many *new* actor ids each write
introduces and adds them to the running total. The bell's expandable actor list shows "and N
more" rather than silently presenting 10 of 500 as the whole set.

### 7.9 Order it was built in

The sequencing mattered, and is worth recording because it would be wrong to reverse:

1. Throttling engine — the two columns, the four gates, the priority map
2. The 08:00 catch-up digest
3. Thread following — participant query, batched visibility, precedence ladder
4. The social types themselves

Steps 1–2 would have been worth doing even if the social types were never built: they retrofit
fatigue protection onto notifications that already existed, and `follow_round_started` /
`follow_round_completed` can burst on a busy Saturday without any of Tier 3 in play.

### 7.10 Tuning

The three thresholds are constants at the top of `lib/notifications/notify.ts`, deliberately
grouped so they can be tuned without reading the gate logic:

| Constant | Value | What it controls |
|---|---|---|
| `PUSH_COOLDOWN_MS` | 15 min | Gate 2 — per-group silence after a buzz |
| `PUSH_BUDGET_PER_HOUR` | 5 | Gate 4 — throttleable pushes per user per hour |
| `QUIET_START_HOUR` / `QUIET_END_HOUR` | 22 / 8 | Gate 3 — quiet hours, UK local |

These are first guesses for a golf society's traffic, not measured values. If they need tuning
the signal is in the logs: `notify.ts` already warns when a push reaches zero devices, and the
digest returns `{profiles, pushed, rows}` from the cron so a persistently large `rows` figure
means the gates are holding back more than intended.
