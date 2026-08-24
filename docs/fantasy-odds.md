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

**Triggered by** (either path, both idempotent — re-running adds markets for
new entrants, never duplicates):

- **Group admin** taps *Generate Markets* on the event's market board
  (`POST /api/fantasy/events/[eventId]/generate`).
- **Daily cron** (08:00 UTC, `runFantasySweeps` in `lib/fantasy/cronSweeps.ts`):
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

The 08:00 UTC sweep (`apps/app/vercel.json`) never re-simulates healthy events. It:
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
   probabilities clamp to `[0.001, 0.995]`, then `1/p` snaps to the bookmaker
   fraction ladder → prices `1/100 … 1000/1` (decimal `1.01 … 1001.00`),
   every stored price a ladder rung (see §12 —
   decimal/fractional/American always agree).
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
| Analytic single-player pricing (noise-free convolution) | `apps/app/lib/fantasy/markets/analytic.ts` |
| Narrative engine (event preview text) | `apps/app/lib/fantasy/narrative.ts` |
| Accumulators (rules, placement, queries) | `apps/app/lib/fantasy/{parlayRules,parlays}.ts` |
| Correlated joint pricing (positions + h2h) | `apps/app/lib/fantasy/simulation/jointPricing.ts` + `apps/app/lib/fantasy/jointSamples.ts` |
| Self-betting restrictions | `apps/app/lib/fantasy/selfRestriction.ts` |
| Odds price ladder (single source for all formats) | `apps/app/lib/fantasy/oddsLadder.ts` |
| Odds display formats | `apps/app/lib/fantasy/oddsFormat.ts` |
| Staleness triggers + `mark_stale` | `supabase/migrations/20260708000001_fantasy_odds.sql` |
| Atomic job claim | `supabase/migrations/20260708000002_fantasy_claim_job.sql` |
| Partial (round) settlement RPC | `supabase/migrations/20260709000001_fantasy_partial_settlement.sql` |
| Parlay tables + RPCs | `supabase/migrations/20260709000002_fantasy_parlays.sql` |
| Board API (lazy refresh entry point) | `apps/app/app/api/fantasy/events/[eventId]/odds/route.ts` |
| Odds inspector (sandbox dev tool) | `apps/app/app/api/fantasy/events/[eventId]/inspect/` + `/majors/fantasy/events/[eventId]/inspector/` |
| Cron sweeps | `apps/app/lib/fantasy/cronSweeps.ts` |

---

## 9. V2 changes (2026-07-09)

### The model contract

1. **Gross from history.** A player's gross distribution comes from their
   observed per-hole scoring (par-type + length/SI splits), observed round
   stddev, and observed birdie/eagle rates. With ≥ 10 sampled rounds, history
   is the entire model.
2. **Net from event setup.** Scoring model, allowance % and per-round playing
   handicaps are applied on top of simulated gross (net = gross − PH × rounds,
   mirroring the leaderboard) to produce net totals and positions.
3. **Handicap is a prior, not a driver.** Thin profiles blend toward the
   net-consistent anchor `PH + POPULATION_GAP (4) over par` by sample weight
   (gross path `w = sampleSize/10`; differential path `w = effectiveN/12`);
   no-history players price entirely off it. Sigma defaults follow handicap
   when no observed stddev exists.
4. **Recent form is damped**: 40% weight on the gross path (20% on the
   differential path — the level is already recency-weighted there), clamped
   ±4 strokes — it nudges the mean, never replaces it.
5. **Rare outcomes are calibrated** — see §10 for the current (exact,
   Bayesian-shrunk) calibration; hole-in-one/albatross specials price off
   amateur base rates (since §12: 1/12,500 per par-3 player-hole,
   1/1,000,000 per par-4/5 player-hole), never the normal tail.
6. **Profiles have a 24 h TTL** — `ensureProfiles` rebuilds stale rows, so
   form inputs follow new rounds.

### Refresh also generates

`executeRefresh` runs the same market-materialization diff as generation
(`ensureMarkets`), so a player entering after first generation gets their
per-player markets (H2H/O-U/birdies/…) on the next refresh, not never.

### Multi-round events

Hole sets are round-tagged (per-round course/tee); completed rounds are fixed
from recorded scores, the live round plays out, future rounds fully simulate.
The engine keeps per-round joint samples, so event-wide AND per-round markets
("Round 2 Winner", round O/U, round birdies, round H2H) price from one run.
Round-scoped markets settle as their round completes
(`settleFantasyRoundMarkets`, apply RPC `p_final=false`) — hooked into
`executeRefresh` with the daily cron as safety net.

### Market catalogue

`outright_winner`, `top_n`, `finish_position` (exact, from the position
histogram), `finish_range` (wooden spoon / bottom-3 / mid-pack), `h2h`
(1-X-2 match odds — every unique pairing in the field, gross+net, draw is a
real backable outcome), `score_band` (4-stroke bands, gross+net),
`score_total` (Under/Exactly/Over per score value, gross+net — replaces the
old `gross_ou`/`net_ou`/`score_exact`), `birdies`, `eagle_count` (1+/2+/3+),
`hole_score` (birdie-or-better / bogey-or-worse per hole; played holes lock),
`field_special` (HIO / albatross / any eagle). Score bands and score totals
are centred on the player's **handicap-implied** score (par + playing
handicap + `POPULATION_GAP` from the event setup — see §11), not the model's
own projection; the odds themselves still price off the real simulated
distribution.

### Accumulators

2–8 legs, one stake. Independent legs multiply; correlated legs are jointly
priced or blocked — the current rules are §12 (this section's original blunt
"distinct markets AND one subject per event" guard is long gone). Cross-event
accas draw on season/lifetime wallets; event-scoped budgets only fund
single-event accas. Legs resolve with their market's settlement; void legs
drop to odds 1.0 (joint-priced accas void whole); all-void refunds. Acca
cash-out is deferred. UI copy: "Accumulator/Acca" via
`lib/fantasy/terminology.ts`.

### Odds inspector

Sandbox-only dev tool (`NEXT_PUBLIC_APP_ENV === "sandbox"`): resolved playing
handicaps with source path, stored profile inputs, per-hole μ/σ, sim
percentiles, market prices with probability-sum checks, refresh-job log, plus
"rebuild profiles" and "regenerate + reprice" actions.

---

## 10. V4 model audit fixes (2026-07-10)

An independent audit of the pricing model surfaced three real bugs; this
section documents the corrected model. The audit workbook (inspector Excel
export) now carries **Assumptions** and **Calibration** sheets that reconcile
every number below against the live simulation.

### The level model is differential-first

When the event tee has WHS rating/slope and the player has score
differentials, the per-hole level works the player's **recency-weighted mean
differential** back to gross (`AGS ≈ μ_D·slope/113 + rating`), blended toward
the `PH + 4` anchor by `min(1, effectiveN/12)`. The gross-average path of §9
is the fallback (no rating/slope, or no differentials).

- **Differential history is uncapped** — the full accepted-round stream feeds
  the level (paged explicitly past PostgREST's 1000-row default so long
  histories can never silently truncate).
- **Recency weighting**: half-life 20 rounds. The effective sample size
  `Neff = (Σw)²/Σw²` therefore **asymptotes at ≈ 57.7** no matter how long
  the history — a 249-round history shows Neff ≈ 57.7 by construction, not
  truncation.
- **The 20-round SHAPE cap** (`SHAPE_MAX_ROUNDS`) applies only to per-hole
  shape, birdie/eagle rates and form — a freshness window, not an ability cap.

### Birdie/eagle calibration: exact, with a documented Bayesian prior

**Bug fixed:** the old calibration clipped its scale factor to `[0.5, 2]`. The
discretized normal overstates amateur birdie odds so badly that the 0.5 floor
bound for entire fields — every player simulated at exactly half the raw
model's birdie mass, and a player with **zero** observed birdies still got
`max(0.5, 0) = 0.5` of it (e.g. observed 0.00/round → simulated ~0.4/round).
A post-scale renormalize also pulled even unclipped factors off target, and
the eagle pass then perturbed the just-calibrated birdie mass.

**Current model** (`buildHoleDistributionsDetailed`, holeModel.ts):

1. **Shrunk target** (Gamma-Poisson posterior mean):
   `λ* = (λ_obs·n + λ0·K)/(n + K)` with `n` = shape-sample rounds, `K = 8`.
   Prior mean `λ0(HI) = clamp(2.2·e^(−0.115·HI), 0.03, 3.0)` birdies/round
   (fit to published amateur rates: scratch ≈ 2.2, HI 10 ≈ 0.70, HI 20 ≈
   0.22). Eagles: `λ0e(HI) = clamp(0.06·e^(−0.18·HI), 0.001, 0.15)`,
   `K = 40`, target never above the birdie target. Handicap proxy for the
   prior: `HI → (μ_D − 4) → PH`. A missing observed rate means `n = 0` →
   pure prior (calibration never skips).
2. **Exact mass transfer**: one global factor `f = T/B` on the birdie bins;
   each hole's non-birdie bins rescale by `(1 − f·b_h)/(1 − b_h)` so every
   hole sums to exactly 1 and `Σ P(birdie-or-better) = λ*·holes/18` exactly
   (per-hole birdie mass capped at 0.95). The eagle bin is then set **within**
   the birdie-or-better mass, leaving the birdie total untouched.
3. **Mean preservation**: calibration alone would shift each hole's expected
   score (the differential level already includes the player's real birdies),
   so a fixed-point loop (≤ 20 passes, tol 0.01 strokes/hole) re-targets the
   latent means until the **post-calibration** expected score matches
   `holeMu`. Invariant: Σ E[hole] + par ≈ simulated mean gross ≈ the
   differential-anchored level.

### Tie semantics: pricing matches settlement, per market

| Market | Settlement | Price |
|---|---|---|
| Outright winner (event) | leaderboard `position = 1` (playoff/countback resolves ties) | `winProb` — ties **split** evenly (fair when ties resolve ~randomly) |
| Round winner | "ties all win" (no round playoffs) | ties at **full** credit (`winProbsFrom(…, "all")`) — **bug fixed**: was priced tie-split, systematically too long |
| Head-to-head | 1-X-2: `a` wins if lower score, `draw` wins if equal, `b` wins if lower score (§11 — no more void-on-tie) | `winsA/n`, `ties/n`, `winsB/n` — a genuine three-way split, sums to 1 |
| `finish_position` / `top_n` / `finish_range` | shared leaderboard positions | position histogram under 1224 ranking — tied players carry the tied position in full |

`P(position 1 incl. ties) ≥ winProb` whenever ties occur; both are shown side
by side on the inspector and the Sim aggregates sheet — they are different
quantities pricing different contracts, not a discrepancy.

### Audit surfaces

The inspector (JSON + Excel) now emits, per player: model path, σ source
(differential / observed / handicap / default) with clamp flag, form status,
the full calibration block (observed → prior → λ* target → pre/post mass →
factor → mean residual → passes), latent μ **and** post-calibration E[score]
per hole with `Σ+par` reconciliation columns, simulated E[birdies], and
`P(1st incl ties)` next to `Win%`. Missing profile values render "—" (they
are never numeric defaults; each has a documented fallback).

---

## 11. Board UX rework + match-odds redesign (2026-07-13)

**Season markets**: `loadSeasonContext`/the cron sweep no longer gate on
`group_seasons.standings_model` — that field turned out to be a cosmetic
Majors-app display toggle, not a real data dependency (standings entries are
computed by `ciaga_compute_group_season_standings` regardless of it). Season
market eligibility is now purely "fantasy enabled + `budgetScope: "season"`",
already enforced inside `generateSeasonFantasy`. The group-season headline
route (`/api/fantasy/groups/[id]/season`) self-generates on first view,
mirroring the season odds route.

**`score_total`** replaces `gross_ou`/`net_ou`/`score_exact` (the old three
stay in the `fantasy_markets.market_type` CHECK as a superset — zero picks
ever referenced them). One market per (player, gross|net); for each of 9
score values, three selections `u_{v}`/`e_{v}`/`o_{v}` (Under/Exactly/Over)
instead of a single fixed `.5` line.

**Handicap-implied centering**: `score_band` and `score_total` no longer
centre their range on the model's own projected mean. They reverse-engineer
an expected score from the player's **playing handicap** and the event's
course setup: `handicapImpliedScore` (`lib/fantasy/markets/roundUtil.ts`) —
`totalPar + numRounds·(playingHandicap + POPULATION_GAP)` for gross,
`totalPar + numRounds·POPULATION_GAP` for net (net is handicap-independent
by the handicap system's own design — same `POPULATION_GAP` constant
`holeModel.ts` uses as its own thin-data anchor, now exported). `GenerateCtx`
threads `playingHandicap` per player for this. The **odds themselves** are
unaffected — `simulate()` still prices off the real Monte Carlo distribution;
only which values/bands are *offered* changed.

**Head-to-head → 1-X-2**: `headToHead.ts` now generates every unique pairing
in the field (not just nearest-projected-rival), separately for gross and
net, and prices a real `draw` selection (`ties/simulationCount`) instead of
excluding ties from the price and voiding them at settlement. Settlement:
lower score wins, equal scores win the draw. `parlayRules.ts` needed no
changes (h2h was never in `POSITION_FAMILY_TYPES`).

**Board UI**: the event markets page gained a second, category-scoped tab row
(Finishes / Match Bets / Score Bands / Score Totals / Birdies / Eagles / Rare
Events / Hole Specials) replacing the old single flat vertical stack of every
section. Match Bets renders as an A/Draw/B table (`buildMatchRows`, one row
per pairing). Score Bands/Totals share a gross/net toggle. Exact Finish stays
one player per row with its position selections in two columns. `eagle_count`
now generates 1+/2+/3+ (was hardcoded to 1+ only), mirroring `birdies.ts`.

---

## 12. Acca correctness, self-betting, price ladder (2026-07-14)

### The correlated family now includes head-to-heads

The problem: "X to win" + "X beats Y" multiplied both legs' odds, but winning
implies beating everyone — the product handed the bettor a free multiplier.
Positively-correlated combos must never be priced as independent.

The correlated family is the position family + `h2h`
(`isCorrelatedFamily`, `parlayRules.ts`). Per event, all matrix-expressible
correlated legs are jointly priced from the retained positions matrix
(`combineAcca`, `jointPricing.ts`). H2h reads off positions exactly:
competition ranking ("1224") on the shared basis preserves order AND ties of
the underlying totals, so `posA < posB ⟺ A beat B`, equal = draw; both
players must be present that iteration (absent fails the leg, mirroring
void-on-withdrawal). So "X to win + X beats Y (net, net-ranked event)"
collapses to ≈ X's win price — quantization usually makes it exactly the win
leg's rung.

**Matrix-expressible** (`isMatrixExpressible`) = event-wide, and for h2h the
market's basis equals the event's ranking basis
(`rankingBasisFromScoringModel` — stableford events therefore never
joint-price h2h; the matrix holds no stroke totals). A player shared between
two correlated legs where ANY touching leg is inexpressible → blocked
("Those selections are related and can't combine"). Round-scoped legs are
never matrix legs — this also fixed a latent bug where a round-scoped
outright joint-priced as an event win — and round winners now claim
round-scoped exclusivity slots (`winner:r{n}`), so "R1 winner + R2 winner"
combines (it was wrongly blocked).

The independent-product fallback (matrix missing) is only reachable for
negatively-correlated position combos, where the true joint is longer —
never overpays.

### Impossible combos are rejected, not priced at the cap

- **Hall feasibility** over event-wide finishing claims (intervals: outright
  `[1,1]`, top-N `[1,n]`, exact `[k,k]`, ranges `[from,to]`): any interval
  containing more claims than positions → "Too many players for those
  finishing spots" (4 players all top-3 dies here; 3 is fine and
  joint-priced).
- **Deterministic contradictions**: an h2h side vs the named loser holding a
  win claim, or the named winner holding a wooden-spoon claim.
- **Numeric backstop**: a joint count of exactly 0 (e.g. an ordering cycle
  A>B, B>C, C>A that pairwise rules can't see) marks the price `infeasible` —
  placement rejects it; it is never priced at the ladder top.
- Combined odds cap at `MAX_COMBINED_ODDS = 10000` (numeric(12,2) guard).

### Multi-selection markets

`hole_score` is now co-occurrable (`marketAllowsMultiple`): birdie-or-better
on holes 3 AND 7 sits in one slip/acca (independent product — the model
treats holes as independent given the player). Opposite outcomes on the same
(player, hole) are blocked. The DB's leftover `UNIQUE (parlay_id, market_id)`
— which silently broke EVERY multi-selection acca, including two players in
one top-3 market — is now `UNIQUE (parlay_id, market_id, selection_key)`
(migration `20260714000000`). `findParlayViolation` also gained the server
mirror of the slip's replace rule: a second selection on a
non-co-occurrable market is a violation.

### Self-betting restrictions

`selfRestriction.ts` (pure, shared): you can back yourself to do well, never
to do badly, and never an exact score/band/position you could steer into.
Greyed out on the board (with the reason as tooltip), enforced in `placePick`
and `placeParlay`.

| Market | Blocked when it's you | Still allowed |
|---|---|---|
| `h2h` | opposite side and the draw | backing your side |
| `score_total` | Over, Exactly | Under |
| `score_band` | every band | — |
| `hole_score` | all of a bogey-or-worse market | birdie-or-better |
| `finish_range` | wooden spoon, any range not starting at 1st | from-1st ranges |
| `finish_position` | 2nd or worse | exactly 1st |

Unrestricted: outright, top-N, birdies, eagles, field specials.

### Rarity rates + the price ladder

- Hole-in-one `1/3,500 → 1/12,500` per par-3 player-hole; albatross
  `1/50,000 → 1/1,000,000` per par-4/5 player-hole (both aggregate over the
  whole field × all rounds: `P = 1 − (1 − rate)^exposures`). The old rates
  were near-pro and priced field HIO absurdly short.
- Probability floor `0.005 → 0.001`: price range is now `1/100 … 1000/1`
  (decimal `1.01 … 1001.00`). At 10k iterations the floor is 10 simulated
  hits — deterministic per version, not tail noise.
- **Ladder quantization** (`oddsLadder.ts`): `probabilityToDecimalOdds` =
  clamp → `1/p` → snap to the standard bookmaker fraction ladder (now
  extended `250/1 … 1000/1`). The rung is the single source of truth: decimal
  = `1 + num/den` (2dp), fractional = `num/den`, American = `±100·num/den`
  rounded — the three formats can never disagree (5/1 ⇔ 6.00 ⇔ +500; 8/15 ⇔
  1.53 ⇔ −188). Acca combined odds stay the exact product of quantized leg
  prices (not re-quantized), displayed as decimal in the slip.
- Migration `20260714000000` marks every unsettled book stale so open events
  reprice under the new constants on next view; open bets keep locked odds.

---

## 13. Variance-faithful model + analytic single-player pricing (2026-07-26)

A statistical audit of the model found the score-diff **estimators** correct
(recency-weighted mean; reliability-weighted unbiased variance) but four issues
in how they flow through to prices. This section documents the fixes. Profile
model version → **v5**; the pricing changes take effect on the next
generation/refresh (admin "regenerate + reprice" forces it immediately).

### σ_D now measures noise, not the improvement trend

`recencyWeightedDifferentialStats` (`simulation/differentials.ts`) measured
spread as deviations from the recency-weighted **level**, so an improving (or
declining) player's old rounds — far from their current mean — inflated σ_D and
over-widened their simulated distribution. The spread is now the reliability-
weighted stddev of the **residuals around a weighted-least-squares trend**
(`x ≈ a + b·r`, recency weights → a local slope), with a proper hat-trace
degrees-of-freedom correction (`V1 − V2/V1 − Σw²(r−r̄)²/Σw(r−r̄)²`). A trend is
only fitted with ≥ `MIN_DETREND_SAMPLES` (4) rounds; below that the original
deviation-from-level estimator stands (a 2-point line has zero residual). The
level (`avg_differential`) is unchanged. The slope `trendPerRound` is returned
for the inspector.

### Round variance is honoured, and holes share a "day"

Two coupled changes (`simulation/holeModel.ts`, `simulation/engine.ts`):

1. **Intra-round correlation** `INTRA_ROUND_CORRELATION = ρ (0.06)`. Golf holes
   are modestly positively correlated (a good/bad day lifts the whole round);
   independent hole sampling under-disperses count markets (birdies/eagles). The
   engine now samples each round's holes through a **one-factor Gaussian
   copula**: a shared per-(player, round) "day" normal `g`, per-hole noise, and
   `u = Φ(√ρ·g + √(1−ρ)·gₕₒₗₑ)` into the existing inverse-CDF. This adds
   correlation **without moving any hole's marginal pmf**, so the birdie/eagle
   and `holeMu` calibration stay exact.
2. **σ re-solve** so the CORRELATED round total still has variance σ_round². For
   equal per-hole `s`, `Var(Σ) = s²·n·(1 + (n−1)ρ)`, so per-hole
   `s = σ_round / √(n·(1 + (n−1)ρ))` (was `σ_round/√n`). Because `s` is smaller,
   most round variance now rides on the unbounded day factor rather than the
   grid-bounded per-hole spread, so the per-hole clamp (now `[0.35, 3.0]`)
   rarely binds and volatile players stay separated.

Only the **mean** was reconciled end-to-end before. `CalibrationMeta.variance`
(`{ target: Σσ², realized: Σ discrete var, perHole }`) now exposes per-hole
variance retention, shown in the inspector JSON/UI and the Calibration sheet
("Round var target / realized / retention %"); the Sim-aggregates sheet's
"σ round target vs Sim gross SD" checks the correlated round total.

### Bands/totals centre on the model projection

`score_band` / `score_total` centred their ranges on the **handicap-implied**
score — which fought the differential-first level model (form ≠ handicap), piling
an in-form player's mass into the bottom band. They now centre on the **model
projection** (`ctx.projections[id].meanGross/Net` from the preliminary sim;
handicap-implied is a defensive fallback). `bandsAround` was also made
symmetric: two 4-stroke inner bands whose junction sits at ≈ the projection
(`c = round(mean − 0.5)` → `le_(c−4) | (c−3)_c | (c+1)_(c+4) | ge_(c+5)`), a
gap-free integer partition. Edges can shift slightly between refreshes as form
updates, like O/U lines. Probabilities are unchanged in method (still the real
distribution) — only which bands/values are *offered* moved.

### Single-player markets are priced analytically (noise-free)

`score_band`, `score_total`, event-wide `birdies`, `eagle_count` no longer count
Monte-Carlo samples — they price off an **exact convolution** of the calibrated
per-hole distributions (`markets/analytic.ts`). Because the copula makes a
round's holes conditionally independent given the day factor, the exact
distribution is a **Gauss–Hermite quadrature over the day factor of the
per-hole convolution** — correlation-correct, seed-independent, and free of the
~14% relative tail noise the ladder used to lock in per version. The engine
attaches each player's calibrated `analytic` model (per-hole pmfs, pars, rounds,
fixed contributions) to `SimulationResult`; markets fall back to the retained MC
samples only when a player has no holes left (deterministic). `hole_score` stays
on the per-hole MC marginal (a single Bernoulli — least noisy). The remaining
multi-player markets (winner, top-N, finish position/range, h2h) keep the joint
MC engine, now with **antithetic variates** (paired iterations reuse each
sample's normals negated → `1−u`) to roughly halve their variance.

---

## 14. Stable market identity + drifting bands + responsive cash-out (2026-07-26)

§13 (V5) centred `score_band`/`score_total` on the model projection. But the band
edges lived in `fantasy_markets.params`, and `params` is part of market
**identity** (`marketShapeKey` + the `uq_fantasy_markets_shape` index). Since
`ensureMarkets` is insert-only, every time the projection drifted enough to
re-centre, a **new** market row appeared and the old one lingered — duplicate
markets, and cash-out reading a pick's frozen line while a re-centred duplicate
carried the board's fresh price. `finish_position` had the same disease via
`params.maxPos = min(fieldSize, 8)` (drifts as entrants join/leave).

**Fix — identity carries only stable discriminators; drifting data is
per-refresh.**

- `score_band` / `score_total`: `params` = just `{ basis }`. The offered
  bands/values are recomputed each refresh in `simulate` from the player's
  projection (`sim.players[idx].meanGross/Net`), priced by summing the exact
  per-score pmf over each range (`pmfBandProbability` / `pmfUnderExactOver`).
  `finish_position`: `params = {}`, positions `1..min(fieldSize, 8)` derived from
  the sim. So the offered set drifts with form/field while the row never
  duplicates.
- `marketShapeKey` now canonicalizes `params` recursively (sorted keys) to match
  Postgres jsonb, so the TS dedup and the DB index agree.
- **Self-describing keys.** A band/value key (`le_<hi>` / `<lo>_<hi>` /
  `ge_<lo>`, `u_/e_/o_<v>`) fully describes what was backed, so a placed pick
  settles/prices independent of the currently-offered set:
  `MarketDefinition.settleKey` settles ONE key (settlement resolves each
  pick/leg through it — `settlement.ts` resolver); acca joint-pricing
  (`jointPricing.ts compileLeg`) parses the leg key instead of `params`.
- **Responsive cash-out (the "cumulative of the exact scores").** Each refresh
  persists every player's exact per-score pmf (gross+net) to
  `fantasy_score_pmfs` (migration `20260726000000`). Cash-out of a
  `score_band`/`score_total` pick (`cashout.ts`, `parlayCashout.ts`) prices the
  pick's OWN band/value from that pmf via `scoreSelectionProbability` — so the
  value tracks drift and works even for a band no longer offered — falling back
  to the snapshot for other markets.
- **Migration `20260726000001`** collapses the duplicate score_band/score_total/
  finish_position rows already in prod: it repoints open picks + parlay legs onto
  the canonical sibling (bets preserved — the key is self-describing), drops the
  duplicates (snapshots cascade), and normalizes survivors' params to the stable
  shape so generation stops re-duplicating them.

The board reads the current-version snapshots as before; `buildScoreBandTable`
orders its four columns by parsing the selection keys instead of `params.bands`.

---

## 15. The ceremony freeze, and tie semantics (2026-07-29)

Found by playing The CiaGA Championship 2026 end-to-end on staging.

### The freeze must not leak through the board

`events.leaderboard_freeze_state = 'frozen'` hides each player's last N holes on
the leaderboard once they cross `num_rounds*18 − leaderboard_freeze_last_holes`.
Nothing in `lib/fantasy` read that, and `loadLiveRoundData` pinned **every**
completed hole into the sim — so the board published the hidden score. Measured
while the leaderboard showed "thru 12": an outright drifting 4.50 → **51.00**,
another to the 1001 cap, a gross band re-centring from "91–94" to "95–98", and
`score_total` bracketing a player to 93–96 at ~1.01.

Two-part fix, both in `lib/fantasy/odds.ts`:

1. **Clipping at the source.** When the event is frozen, `loadLiveRoundData`
   truncates each frozen player's `completedByProfile` to their snapshot's
   `holes_shown` (in play order, so multi-round and non-1st-tee starts work) and
   reports their round as *not* finished — their completion is itself hidden.
   Everything downstream (markets, cash-out, narrative) is leak-proof by
   construction.
2. **Locking the selections.** `LiveMarketCtx.frozen(profileId)` plus
   `selectionIsFrozen(market, key, ctx)` (`markets/types.ts`), enforced centrally
   in `picks.ts`, `parlays.ts`, `cashout.ts` and `parlayCashout.ts` rather than in
   all eleven market definitions. A market locks when any player it depends on is
   frozen — for h2h, either side. Event-wide specials are unaffected.

Related: `reconcileEventStatus` no longer completes an event while it is frozen,
so settlement (and the season standings publish) waits for **Reveal Results**.

### Playing handicap is COURSE handicap × allowance

`resolvePlayingHandicapDetails` multiplied the allowance straight onto a handicap
**index**, skipping the slope/rating conversion — because
`event_entries.assigned_course_handicap` is never written, so every entry took
the index branch. Measured gap: HI 22.1 → 15 on the leaderboard vs 23 in fantasy;
45.2 → 36 vs 43; 48.3 → 39 vs 46. Now converted via the tee's slope/rating/par
(which already ride on `SimHole`), with the 9-hole halving the round SQL applies.
Pricing and settlement share the resolver, so both moved together.

The basis is the player's REAL, current index — the latest `handicap_index_history`
row, i.e. what `ciaga_current_true_hi()` returns and what the round computes from.
`event_entries.assigned_handicap_index` is a snapshot frozen at entry and drifts
(Ware entered off ~24.6 but plays off 22.1), so it is now only a fallback for
players with no history at all. `fantasy_player_profiles.handicap_index` has a 24h
TTL and is likewise only a fallback.

### Tie semantics, per market

| Market | Settles on | Rule |
|---|---|---|
| `outright_winner` | `resolvedPosition` (`playoff_final_position ?? position`) | The trophy is decided by the playoff/countback — exactly one winner. Priced with ties SPLIT (`winProb`). |
| `finish_position` | `position` (tied 1224 rank) | **Ties count**: backing 1st and finishing T1 pays, whatever the playoff decides. Labelled "(ties count)". |
| `top_n` | `position` | Ties all in — a T3 pays a top-3 bet. Labelled "(ties count)". |
| `finish_range` | `position` | Ties all in, including the wooden spoon. |
| `h2h` | scores, not positions | `draw` is a real backable outcome. |

`lastProb` in the engine no longer splits bottom ties: `finishRange` settles
`position === worst`, which pays every tied player, so splitting priced the
wooden spoon systematically too long. `winProb` still splits — that one *is*
resolved by a playoff.

---

## 16. Leaving the field, and holes the engine never modelled (2026-08-24)

Two board defects reported on an entry-closed event: markets still showing for a
player who was no longer entered, and "Birdie or better" / "Bogey or worse"
quoting identical odds for the same player.

### A player who leaves the field

There is no entry *deadline* concept inside fantasy — the field is
`event_entries` filtered by `ACTIVE_ENTRY_STATUSES` (`entered`, `approved`,
`pending_approval`, `waitlisted`), plus non-entered group members carried as
**provisional** with a decaying attendance probability. `loadProvisionalPlayers`
does gate on `entry_window_end` though: once entry closes the field is fixed and
provisional players stop being generated at all.

That is what makes withdrawal visible only on closed events:

- **Entry open.** A player who withdraws simply falls back to provisional. They
  stay in `ctx.players`, so their existing markets keep repricing.
- **Entry closed.** They vanish from the simulation entirely. Every per-player
  `simulate()` opens with `if (idx === undefined) return out`, so their markets
  can never be priced again.

`ensureMarkets` is insert-only ("never deletes"), so the market rows survive —
and `writeSnapshots` used to *protect* any open-but-unpriced market from the
supersede, which is the ladder-gap fix ("1+ shows, 2+ blank, 3+ shows"). It
could not tell "momentarily unpriceable" from "gone for good", so a departed
player's last-good snapshot stayed `status = 'active'` indefinitely and the
board kept rendering them at frozen odds, still bettable.

Note the asymmetry: field-wide markets (`outright_winner`, `top_n`,
`finish_position`, `finish_range`) self-heal, because they *are* re-priced and
their old selection rows supersede. Only markets carrying a
`subject_profile_id` / `opponent_profile_id` leaked.

**Fix.** `keepableMarketIds` (odds.ts) now excludes any market whose subject or
opponent is absent from `ctx.players`. Their snapshots supersede, `marketsInTab`
drops zero-selection markets, and the player disappears from the board. No
market `status` is mutated and no migration is needed — if they re-enter, the
next refresh prices them and the rows come back.

No extra placement guard is needed, and one was deliberately **rejected**:
`ciaga_fantasy_place_pick` already refuses any snapshot that is not `active` AND
at the event's current `event_version`, so once the snapshots supersede the RPC
rejects the bet on its own. An entry-status-based guard would also have been
*wrong* — `ctx.players` is entrants **plus provisional** members, so keying off
`event_entries` alone would have blocked backing a not-yet-entered player in the
outright/top-N markets, which is exactly what the attendance model exists to
support. `keepableMarketIds` takes its field from `ctx.players` for this reason.

Already-placed picks are untouched: settlement voids them
(`WITHDRAWN_STATUSES` + `settle()`'s `!player || player.withdrawn` branch), and
cash-out already required a snapshot at the CURRENT `event_version`, so a stale
row was never usable there anyway.

### Holes with no simulated support

`runSimulation` adds a hole to `remainingIdx` only while the player's round is
unfinished. A **finished** round with an unrecorded hole — pick-up, mid-round
withdrawal, missing hole data, freeze-clipped holes — leaves that hole's outcome
bins empty. `holeScore.simulate` then reported `P = 0` for *both* outcomes, and
`clampProbability`'s floor (0.001) turned that into an invented **1000/1 on each
book**: birdie and bogey with literally identical odds, on a hole nobody has any
information about.

Such holes are now skipped rather than quoted. The test is "bins sum to zero",
deliberately **not** "both outcomes are zero" — a hole that was played and
**parred** has bins summing to `simulationCount` and legitimately prices both
legs at zero, because it is decided. Those keep their deterministic price, as
`placementAllowed` already blocks backing them.

`birdies` / `eagle_count` need no equivalent change: they feed the per-hole
probabilities into `countDistribution`, where a `p = 0` hole and an omitted hole
are mathematically identical. An unrecorded hole simply cannot contribute a
birdie, which understates the count — a data gap, not a pricing bug.

### The board no longer substitutes one book for the other

`EventMarketsClient`'s Hole Specials toggle picked the market for the selected
outcome with a `?? forPlayer[0]` fallback. Since `marketsInTab` drops markets
with no priced selections, one missing book meant the toggle silently rendered
the **other** one under the wrong label — identical odds on both tabs, and a
"bogey" click that placed a **birdie** bet. The markets are now indexed by
outcome with no fallback: an unavailable outcome's button is disabled and the
panel says so.

### …and what made a book go missing in the first place

The fallback was the messenger. The board read snapshots with its own
hand-rolled `range()` loop and **no ordering at all**:

```ts
.eq("event_id", eventId).eq("status", "active").range(from, from + pageSize - 1)
```

The International 2026 carries **1,265 active snapshots** across 236 markets, so
that takes the second page — and `range()` over an unordered select has no
defined row-to-page assignment. Rows can be served twice or skipped entirely at
the boundary. It lands on a whole market rather than scattering because
`writeSnapshots` upserts a market's selections together, so its rows are
physically adjacent: a shifted boundary drops one market's entire selection set,
`marketsInTab` removes it, and the toggle substituted the other book.

`lib/fantasy/paginate.ts` has documented this hazard since the cash-out fix —
`readAllPages` exists, is tested, and *requires* a total order. The board simply
wasn't using it. `lib/fantasy/eventReads.ts` now owns both event-scoped reads
(`readActiveSnapshots`, `readEventMarkets`), ordered by `id`; the board, the
inspector, the Excel export, `ensureMarkets` and both `writeSnapshots` callers
go through it.

Two of those were worse than a display glitch:

- **`inspect.ts` was unpaginated**, hard-truncating at 1,000 of those 1,265 rows —
  the odds inspector was quietly showing an incomplete board while being used to
  diagnose exactly this.
- **`ensureMarkets`' shape read**: a truncated `existingKeys` re-inserts markets
  that already exist, 23505s, and falls into the swallow-the-error per-row path
  on every refresh. The `writeSnapshots` callers are worse still — a market
  missing from that read is neither re-priced nor in `keepMarketIds`, so its last
  good snapshot is superseded and it goes blank for good.

Never order these by `event_version` or `computed_at`: both repeat across a whole
snapshot generation, so paging stays just as undefined. `id` is the primary key
and the only total order available.

### The bogey book was flat, because nothing calibrated it

None of the fixes above explains the *prices*. Measured on prod (The
International 2026, v12647), Ware's bogey book quoted 1.01-1.14 on all 36 holes
— flat enough to read as "the same odds" even once the read bug stopped
substituting the wrong book. Against his own stored 20-round profile:

| Per hole | Observed (his profile) | Modelled (prod snapshots) |
|---|---|---|
| birdie or better | 2.5% (0.45/round) | ~2.2% — **calibrated, accurate** |
| par | 17.9% (3.23/round) | ~7.2% |
| bogey or worse | 79.6% (14.32/round) | ~90.6% |

Only the birdie side was calibrated, so only the birdie side landed. The
par/bogey split was whatever the discretized normal had left after the birdie
rescale, and it discarded about 60% of his par mass. `profiles.ts` had computed
and persisted `pars_per_round` since the original schema and `toSimProfile`
mapped it onto `SimPlayerProfile` — `holeModel.ts` simply never read it.

Fixed in §17 below.

---

## 17. V6 — calibrating the par bin (2026-08-24)

### What changed

`buildHoleDistributionsDetailed` now calibrates the **exactly-par** bin the same
way it already calibrated birdie-or-better: a Gamma-Poisson target (observed
rate shrunk toward a handicap prior), exact mass transfer, mean preservation
unchanged.

That is enough to fix the whole hole book, because `holeScore.simulate` prices
bogey-or-worse as `bins.slice(3)` — i.e. `1 − P(birdie+) − P(par)`. Pin the two
calibrated bins and the residual is pinned with them.

```ts
export const PAR_PRIOR_STRENGTH = 5;
export function parPriorMean(hi: number): number {
  return Math.min(14, Math.max(0.05, 12.1 * Math.exp(-0.069 * hi)));
}
```

The prior is **fitted by log-linear regression to this group's own profiles**
(HI 6.4 → 54), not to published amateur tables: this population plays well above
its index (a 6.4 shoots 83 on these courses), so a published curve sits wide.
Prior vs observed at the fitted points — 6.4 → 7.76/7.66 · 20 → 3.03/3.23 ·
31.8 → 1.34/1.16 · 43.9 → 0.58/0.78 · 47.5 → 0.45/0.37. `K = 5` sits below the
birdie prior's 8 on purpose: pars are 5–10× more common, so the observed rate is
proportionally far more reliable and needs less shrinking.

Result on the six real production profiles — modelled vs observed, per hole:

| Player | P(birdie+) | P(par) | P(bogey+) |
|---|---|---|---|
| Jack Wilson | 0.066 / 0.068 | 0.427 / 0.426 | 0.508 / 0.506 |
| Ware | 0.021 / 0.025 | **0.177 / 0.179** | **0.801 / 0.796** |
| Linehan | 0.007 / 0.009 | 0.067 / 0.064 | 0.926 / 0.927 |
| Ciaran | 0.004 / 0.006 | 0.039 / 0.043 | 0.957 / 0.951 |
| Harper | 0.002 / 0.003 | 0.022 / 0.021 | 0.976 / 0.977 |

Ware's bogey book moves from ~1.10 to ~1.25 and regains hole-to-hole spread.

### Implementation notes

- **Ordering is load-bearing.** Birdie scaling runs first, then par (touching
  only `k=2` and `k≥3`), then the eagle move (only `k=0`/`k=1`). Neither later
  pass can disturb an earlier one, so both exactness guarantees survive. Tests
  assert birdie and eagle mass are bit-identical across wildly different par
  targets.
- **Water-filling, not a hard cap.** No hole may take more than 0.95 of the room
  the birdie bins leave it, or the `k≥3` rescale goes negative. A single capped
  global factor is not enough: par mass concentrates on the easy holes, so the
  easiest hole hits the ceiling first and the target is stranded for everyone —
  a scratch player's ~12 pars/round was unreachable. Overflowing holes are pinned
  at their ceiling and the shortfall redistributes over the rest.
- **`meta.par.capped` means the target was MISSED**, not merely that a hole hit
  its ceiling — matching the birdie flag, so the audit reads consistently.
- **No migration, no `PROFILE_MODEL_VERSION` bump.** `pars_per_round` has been
  computed, persisted and mapped since the original schema; nothing about the
  stored profile changes, and bumping would force a needless full re-derivation
  of every profile. Books reprice on the board's admin **Refresh** or
  `POST /api/fantasy/events/[eventId]/rebuild-profiles` — deliberately *not* a
  `ciaga_fantasy_mark_stale` sweep, unlike `20260714000000` and `20260715000000`.
  Open picks keep the odds they were placed at; only new prices and cash-out
  values move.

### Why par only, and not bogey

`profiles.ts` classifies into `{k≤1} | {k=2} | {k=3} | {k≥4}`, partitioning the
model's bins exactly, so `bogeys_per_round` and `doubles_plus_per_round` *could*
be pinned too. They are deliberately left unread.

Pinning bogey as well would leave only the shape beyond double bogey to carry
the level, so an unusually hard course would have nowhere to put the extra
strokes. And it isn't needed: pin birdie and par, preserve the level, and the
split falls out on its own. Ware's tail has to average **+2.03** over par to
reconcile — his observed record gives **+2.03**. Jack Wilson's lands at +2.30 the
same way.

### The cost: σ_D no longer controls round variance on its own

P(par) and variance are both functions of σ at a fixed mean, so **pinning the
shape is a partial σ override.** This is a real behavioural change, not a
side-effect to shrug at.

Holding a single shape constant while sweeping σ_D now compresses the realized
round SD toward whatever that shape implies — measured, σ_D 3/5/8 gives
4.22/5.04/5.26. `engine.test.ts`'s variance band was relaxed accordingly and its
comment says why.

Across the *real* field, where shape and volatility co-vary as they should, the
ordering survives intact: round SDs of 4.92 / 6.74 / 7.38 / 8.83 / 8.27 / 8.88
against σ_gross of 3.68 / 5.23 / 6.33 / 7.48 / 7.48 / 8.05 — monotone, and
consistently 1.1–1.34× σ. Exact tracking is now the shape's job, and
`calibrationLiveField.test.ts` guards it on the six production profiles.

### Still open: reconcile σ_D against the measured per-hole spread

Course-adjusted ANOVA over 548 real rounds (`hole_scoring_source`) gives
within-round per-hole SDs of 1.02–1.64 (Ware 1.42) against a model idiosyncratic
σ of ~0.93. Both cannot be right: 18 holes at 1.42 give a round SD of 6.03
unaided, above the 5.23 the model derives from Ware's detrended
`differential_stddev`. Either σ_D understates true round-to-round spread, or the
raw within-round measurement contains structure the model attributes to μ.

Two things are now settled and should not be re-litigated:

- **ρ = 0.06 is correct.** Measured course-adjusted intra-round correlation:
  0.063 (Jack Wilson, 249 rounds), 0.122 (Ware, 162), 0.078 (Ben), 0.063
  (Linehan), 0.066 (Ciaran), 0.076 (Harper). An earlier estimate of ~0.01 came
  from treating the double-plus bin as a point mass, which understates per-hole
  variance. `INTRA_ROUND_CORRELATION` needs no change.
- **The narrow marginal cannot simply be widened** — see the arithmetic above.

Par calibration removes the symptom from the hole book, but the narrow marginal
still exaggerates hole-to-hole *variation* in par mass (hard holes lose
proportionally more than they should) and still shapes score bands and totals.
That deserves its own analysis, not a tuning pass.
