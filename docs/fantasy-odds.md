# Fantasy Picks — Odds Lifecycle

How, when, and why odds are generated, cached, invalidated, and re-simulated.

**Core principle (from the execution spec):** there is no continuous odds
engine. A simulation runs only when **(1) something meaningful changed** and
**(2) someone actually needs the numbers** — a viewer, a pick placement, a
cash-out quote, settlement, or the daily cron. Everything in between is served
from cached, versioned snapshots.

All simulations run **server-side** (Next.js API routes with the service-role
client). The engine is pure TypeScript: `apps/app/lib/fantasy/simulation/`.

---

## 1. The moving parts

| Piece | Table / module | Role |
|---|---|---|
| Event odds state | `fantasy_event_state` | One row per fantasy-enabled event. `version` (bigint) increments on every meaningful change; `odds_stale` flags that snapshots no longer match reality; `is_final` freezes everything after settlement. **Row existence is the switch** — no row = fantasy inactive = triggers exit instantly. |
| Player profiles | `fantasy_player_profiles`, built by `lib/fantasy/profiles.ts` | Per (group, player): scoring averages, variance, birdie rates, par-3/4/5 splits, `hole_splits` (length-band × stroke-index buckets), sample size, confidence. The simulation's priors. |
| Markets | `fantasy_markets` | One row per (event, market type, subject/params). Materialized at generation time; the *selection* (who/over/under/yes) lives on the pick, not the market. |
| Odds snapshots | `fantasy_odds_snapshots` | The cached prices: one row per (market, selection, **event version**), `UNIQUE` on that triple. `status` = `active` or `superseded`. |
| Refresh queue | `fantasy_refresh_jobs` | At most one live (`pending`/`running`) job per event, enforced by a partial unique index. Carries `debounce_until`, `attempts`, lock fields. |
| Simulation engine | `lib/fantasy/simulation/engine.ts` | Seeded Monte Carlo. One run prices **every** market for the event. |
| Market registry | `lib/fantasy/markets/registry.ts` | Per-market-type `simulate()` maps the shared sim result to selection probabilities. Also owns settlement, placement, and cash-out rules. |
| Orchestration | `lib/fantasy/odds.ts` | Sim-input assembly, job claiming, refresh execution, snapshot writing. |

---

## 2. When are markets and odds first GENERATED?

Generation (`generateEventFantasy` in `lib/fantasy/odds.ts`) is what turns an
ordinary event into a fantasy event. It:

1. Verifies the group has `fantasy_config` set, the event is single-round and
   not completed, and ≥ 2 players are entered.
2. Rebuilds performance profiles for the entered field (from
   `hole_scoring_source` history).
3. Inserts the `fantasy_event_state` row (**this activates the staleness
   triggers** for the event).
4. Runs one simulation to get projected means per player.
5. Asks every market definition in the registry to materialize its markets —
   projections set the O/U lines (`mean ± → x.5`) and pair the head-to-head
   rivals (adjacent players sorted by projected mean).
6. Prices every market from the same sim run and writes the initial `active`
   snapshots at the current version.

**Triggered by** (either path, both idempotent — re-running adds markets for
new entrants, never duplicates):

- **Group admin** taps *Generate Markets* on the event's market board
  (`POST /api/fantasy/events/[eventId]/generate`).
- **Daily cron** (03:00, `runFantasySweeps` in `lib/fantasy/cronSweeps.ts`):
  pre-generates for any event dated *today* in a fantasy-enabled group that
  has no state row yet. Events created later the same day rely on the admin
  button.

---

## 3. What marks odds STALE (and what doesn't)

Staleness is detected by **five cheap database triggers**, all funneling into
`ciaga_fantasy_mark_stale(event_id, reason)`
(migration `20260708000001_fantasy_odds.sql`):

| Trigger | Fires on | Reason recorded |
|---|---|---|
| `trg_fantasy_score_event` | `round_score_events` INSERT (append-only table, so this also covers edits/deletes) | `score_submitted` |
| `trg_fantasy_round_finished` | `rounds.status` → `finished` on an event-linked round | `round_complete` |
| `trg_fantasy_submission_change` | `event_round_submissions` insert or `submission_status` change (accept/reject/supersede/withdraw/DQ) | `submission_change` |
| `trg_fantasy_entry_change` | `event_entries` insert/delete, or `entry_status` / assigned-handicap changes | `field_change` |
| `trg_fantasy_handicap_change` | `handicap_index_history` INSERT — stales every active fantasy event the player is entered in | `handicap_change` |

`ciaga_fantasy_mark_stale` does three things atomically:

```
version   = version + 1        -- new event version
odds_stale = true
upsert refresh job: status = 'pending', debounce_until = now() + 60s
```

Cost control: casual (non-event) rounds exit the score trigger after a single
primary-key lookup (`rounds.event_tee_time_id IS NULL`), and every path
no-ops unless a `fantasy_event_state` row exists and `is_final = false`.

**Deliberately does NOT mark stale** (per spec §9.2):

- viewing the market page, refreshing the browser, viewing settled events
  — reads never invalidate;
- **placing a pick** — there is no trigger on `fantasy_picks`; a pick doesn't
  change anyone's probability of anything;
- anything after settlement — `is_final = true` blocks all bumps forever.

Event-config edits (course/date changes) are expected to bump from TypeScript
in the relevant admin routes rather than via triggers.

---

## 4. When do we automatically RE-RUN the simulation?

There is no queue worker. The expired job is executed **inline by whichever
request needs it next** — that's the lazy-refresh core.

### 4a. Market page view (the normal path)

`GET /api/fantasy/events/[eventId]/odds` (`maxDuration = 60`):

```
read state ──► fresh? ──────────────► serve active snapshots
                │ stale
                ▼
        past debounce_until?
                │ no  ──► serve cached + { stale: true, retry hint }
                │ yes
                ▼
   ciaga_fantasy_claim_refresh_job   (single UPDATE … RETURNING — atomic,
                │                     so concurrent viewers can't stampede)
        won the claim? ── no ──► serve cached + { refreshing: true }
                │ yes
                ▼
        executeRefresh (see §5) ──► serve fresh snapshots
```

Losers (and anyone inside the 60s debounce window) see the cached odds with a
shimmer. They don't poll: `fantasy_event_state` is in the realtime
publication, so the `odds_stale → false` UPDATE reaches every open board and
triggers one refetch.

### 4b. Cash-out quote (debounce bypass)

`POST /api/fantasy/picks/[pickId]/cashout` calls
`refreshIfStale(eventId, { force: true })`. The force path claims the job
**ignoring the debounce** — and creates the job row if none was queued —
because a quote must be priced on current reality. If another request holds a
fresh lock, the route waits ~1.5s, re-checks, and returns 409 ("try again")
rather than quoting stale numbers.

### 4c. Daily cron (safety nets only)

The 03:00 sweep never re-simulates healthy events. It:
- pre-generates today's events (§2),
- settles completed events whose fantasy never settled,
- fails `running` jobs locked > 10 minutes (crashed executor) and expires
  dead cash-out offers.

### 4d. What does NOT trigger a re-run

Straight from spec §10.2: not on every page load, not immediately after every
score (that's the debounce's job — a burst of 9 hole scores coalesces into
one job), never for settled markets or events nobody is looking at. An event
that goes stale and is never viewed again is **never simulated again** — the
pending job just sits there costing nothing.

---

## 5. What one refresh actually computes

`executeRefresh` (`lib/fantasy/odds.ts`):

1. **Pin the version.** Read `fantasy_event_state.version` = `V` before
   simulating.
2. **Assemble inputs** (`loadSimInputs`): entered field + stored profiles
   (admin `overrides` merged), playing handicaps from
   `event_entries.assigned_playing_handicap` (falling back to CH/HI × the
   event's `handicap_rules.allowance_pct` — so a 90% vs 100% allowance event
   prices net markets differently), the event tee's holes (par / yardage /
   stroke index), and **live round data**: every already-played hole is fixed
   in the sim, only remaining holes are random.
3. **Simulate** (`runSimulation`): 10,000 iterations (5,000 for fields > 60),
   seeded with `hash(eventId, V)` — deterministic per version. One run yields
   joint gross/net totals, rankings (ties handled), birdie counts, and
   per-hole outcome distributions for every player.
4. **Price every open market** via the registry's `simulate()` maps;
   probabilities clamp to `[0.005, 0.995]` → decimal odds `1.01 … 200.00`.
5. **Write snapshots** at version `V` (upsert on the unique triple), then mark
   older `active` snapshots `superseded`.
6. **Mark fresh — version-guarded:**
   `UPDATE fantasy_event_state SET odds_stale = false WHERE version = V`.
   If a score landed mid-simulation, `mark_stale` already bumped the version
   to `V+1` and flipped the job back to `pending`, so this UPDATE matches
   nothing: odds **stay stale** and the next request re-runs. No locks needed
   beyond the job claim.
7. Job → `done` (or `failed` + `last_error`; wedged locks are reclaimable
   after 90s by the next claimer, hard-failed by cron after 10 min).

Cost: worst case ~40 players × 18 holes × 10k iterations ≈ 7M hole samples —
sub-second in Node, well inside one request.

---

## 6. Why versioning matters downstream

The `event_version` on every snapshot is what makes cached odds *safe*:

- **Pick placement** (`ciaga_fantasy_place_pick`): the priced snapshot must be
  `active` **and** its `event_version` must equal the current state version.
  A score submitted between seeing the odds and confirming the pick bumps the
  version and the placement is rejected ("odds are stale — refresh") — no
  sniping value off numbers that no longer reflect reality.
- **Cash-out offers** pin `event_version` + `pick_version` at quote time;
  `ciaga_fantasy_accept_cashout` revalidates both. Any movement between the
  15-second quote and the accept invalidates the offer.
- **Settlement** (`lib/fantasy/settlement.ts`) sets `is_final = true`, which
  permanently silences the triggers and the refresh path for that event.

## 7. End-to-end example

> Event generated Friday (admin). Saturday 09:00, players tee off.
>
> 1. **09:14** — James holes out on 1, score submitted →
>    `trg_fantasy_score_event` → version 7→8, `odds_stale = true`, job
>    pending with `debounce_until = 09:15:14`. Nobody is watching; nothing
>    else happens. Three more scores by 09:15 just push the debounce forward
>    — still one job.
> 2. **09:18** — Sarah opens the market board. Stale + past debounce → her
>    request claims the job, simulates (~300ms) with holes 1–3 fixed at their
>    real scores, writes snapshots at version 11, marks fresh. She sees live
>    odds; two teammates' boards refetch off the realtime flip.
> 3. **09:19** — Tom taps an outright price and confirms a pick. Snapshot
>    version 11 == state version 11 → accepted at those odds.
> 4. **09:20** — a score lands (v12). Tom requests cash-out on an older pick
>    → force refresh (debounce bypassed) → quote priced on v12, valid 15s.
>    Another score during those 15s → v13 → accept is rejected, he's offered
>    a re-quote.
> 5. **13:40** — last round finishes → event completes → settlement runs from
>    the `reconcileEventStatus` hook: picks pay out, markets close,
>    `is_final = true`. From here the event never simulates again.

## 8. File map

| Concern | Where |
|---|---|
| Engine (RNG, hole model, Monte Carlo) | `apps/app/lib/fantasy/simulation/{rng,holeModel,engine}.ts` |
| Orchestration (inputs, claim, refresh, generation) | `apps/app/lib/fantasy/odds.ts` |
| Profiles | `apps/app/lib/fantasy/profiles.ts` |
| Market pricing/settlement rules | `apps/app/lib/fantasy/markets/*` |
| Staleness triggers + `mark_stale` | `supabase/migrations/20260708000001_fantasy_odds.sql` |
| Atomic job claim | `supabase/migrations/20260708000002_fantasy_claim_job.sql` |
| Board API (lazy refresh entry point) | `apps/app/app/api/fantasy/events/[eventId]/odds/route.ts` |
| Cron sweeps | `apps/app/lib/fantasy/cronSweeps.ts` |
