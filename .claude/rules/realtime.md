---
paths:
  - "apps/app/lib/realtime/**"
  - "apps/app/lib/rounds/hooks/**"
  - "apps/app/lib/notifications/**"
  - "apps/app/app/majors/**"
  - "apps/app/app/round/**"
  - "apps/app/components/round/**"
---

# Supabase realtime channels

## One table per channel. Always.

A channel with `postgres_changes` bindings on two **different** tables receives
**zero** events — while still reporting `SUBSCRIBED`, with the socket connected and
`phx_reply` returning `ok`. There is no error anywhere. Measured on 2026-09-05:

| Shape | Events received |
|---|---|
| one binding | 6 / 6 |
| two bindings, one channel, same table | 6 / 6 |
| two bindings, one channel, **different tables** | **0 / 6** |
| two bindings, two channels | 6 / 6 |

Five screens — competition leaderboard, event detail, round menu, playoff scorecard,
round setup — had never updated live in the browser because of this. Fixed in
`cb8ff72`.

**If you need to watch two tables, open two channels.**

## Reconnection

`subscribeWithChannelRetry` in
[useRoundDetail.ts:14](../../apps/app/lib/rounds/hooks/useRoundDetail.ts#L14) wraps
subscribe with backoff and post-reconnect reconciliation. It is currently private to
that file and used only there; nine files call `.channel(` and the other eight
subscribe raw, so a mobile tab suspend silently kills their live updates until a full
reload.

Prefer that helper. If you are adding a subscription outside `useRoundDetail.ts`,
hoisting it into `apps/app/lib/realtime/` is the right move rather than copying it.

When disposing, **null the ref before calling `removeChannel`** — `removeChannel`
re-fires `CLOSED`, and the old order recursed until the stack blew on every socket
drop.

## Bursts

Live scoring writes arrive in bursts of one row per hole. Debounce the refetch with
`useDebouncedRefresh` (`apps/app/lib/majors/useDebouncedRefresh.ts`) rather than
refetching per row — a 6-row burst went from 6 refetches to 1.

To reproduce a burst safely against real data, issue a no-op `UPDATE` that sets a
column to its own value.
