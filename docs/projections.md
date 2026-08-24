# Projections

Stats › Projections forecasts a player's Handicap Index by **simulating future
rounds and replaying the real WHS arithmetic over them**.

- Page: [`apps/app/app/stats/projections/page.tsx`](../apps/app/app/stats/projections/page.tsx)
- WHS engine: [`apps/app/lib/whs/handicapIndex.ts`](../apps/app/lib/whs/handicapIndex.ts)
- Simulator: [`apps/app/lib/stats/projection/simulate.ts`](../apps/app/lib/stats/projection/simulate.ts)
- Cadence: [`apps/app/lib/stats/projection/cadence.ts`](../apps/app/lib/stats/projection/cadence.ts)
- Next-round table: [`apps/app/lib/stats/projection/nextRound.ts`](../apps/app/lib/stats/projection/nextRound.ts)
- Presentation gates: [`apps/app/lib/stats/projectionView.ts`](../apps/app/lib/stats/projectionView.ts)
- Data: `GET /api/stats/differentials` → [`route.ts`](../apps/app/app/api/stats/differentials/route.ts)

---

## 1. The mechanics being modelled

Source of truth is `public.recalc_handicap_profile(uuid)` in
`supabase/migrations/20260120144116_remote_schema.sql` (L1845–1985). The
TypeScript in `lib/whs/handicapIndex.ts` mirrors it exactly.

For each distinct `played_at`, take the last 20 accepted score differentials,
average the lowest **k**, add an adjustment, cap at 54.0, then cap against the
low index of the trailing 365 days.

| n (differentials in window) | k (lowest counted) | adjustment |
|---|---|---|
| < 3 | — | no index yet |
| 3 | 1 | −2.0 |
| 4 | 1 | −1.0 |
| 5 | 1 | 0 |
| 6 | 2 | −1.0 |
| 7–8 | 2 | 0 |
| 9–11 | 3 | 0 |
| 12–14 | 4 | 0 |
| 15–16 | 5 | 0 |
| 17–18 | 6 | 0 |
| 19 | 7 | 0 |
| 20 | 8 | 0 |

Caps, against `LHI` = the lowest index recorded in the previous 365 days:

| base − LHI | resulting index |
|---|---|
| ≤ 3.0 | uncapped |
| ≤ 5.0 | `LHI + 3 + (over − 3) × 0.5` — note this yields `LHI + 4.0` at exactly 5.0 over |
| > 5.0 | `LHI + 5.0` |

Then `least(54.0, …)`.

---

## 2. Why the previous model was wrong

Until August 2026 the page fitted `HI(t) = a·e^(−b·t) + c` to the recorded
handicap history and read projections off the curve. Four problems, in order of
severity.

**Handicap Index is not a function of calendar time.** It is an order statistic
over the last 20 *rounds*. A player posting four rounds a month turns their
counting window over in five months; one posting monthly takes twenty. A
calendar-time fit has no representation of play rate at all, so it gave those two
players the same forecast.

**Small-sample drift was read as improvement.** Walk the table above for a player
whose ability never changes. At five rounds their index is *best-1-of-5*; at
twenty it is *best-8-of-20*, which is a materially worse number for identical
golf. Their recorded index therefore drifts **upward** over their first twenty
rounds as pure arithmetic. Concretely: three differentials of 10.0/12.0/14.0 give
`10.0 − 2.0 = 8.0`; add a *worse* fourth round of 16.0 and the index **rises** to
`10.0 − 1.0 = 9.0`. For a society whose players carry 5–30 accepted rounds, this
was the dominant source of nonsense ETAs — and the curve fit extrapolated it
forever, in whichever direction it happened to point.

**The model could not express a plateau.** The asymptote search was bounded at
`min(minHi − 0.1, lastHi − 1.0)`, forcing the curve's floor at least a full
stroke below the player's current index. Every player was told they would improve
by at least one shot, regardless of their scores. A player who was flat or
getting worse produced a negative decay rate, which `predict()` never rejected,
so their projection grew exponentially.

**Uncertainty was absent or wrong.** The confidence band was the in-sample
residual spread, constant with horizon. The goal ETA and projected index were
bare point estimates off a three-parameter fit that often had four data points.

---

## 3. How the simulation works

Per simulated path:

1. Clone the player's **real** WHS state — their actual 20-round window and
   trailing-365-day index history.
2. Draw a gap to the next round from the cadence model (§4).
3. Draw a differential: `μ = levelNow + trend(j)`, plus a shock.
4. Post it through the same code the database logic mirrors, including caps.
5. Carry the resulting index forward across the weekly grid — an index is
   constant between postings, so the paths are step functions.

**Level.** `levelNow` from `recencyWeightedDifferentialStats`, which is the
recency-weighted fit evaluated *at the newest round*. The plain weighted `mean`
sits at the weighted centroid — roughly 28 rounds back at the default half-life —
which for a player trending 0.05 strokes/round is a 1.4-stroke bias in the
starting level.

**Trend.** Damped: `−trend · τ · (1 − e^(−j/τ))` with `τ = 12` rounds, clamped to
±3.0 strokes total. It is applied **only** when the effective sample size is ≥ 8
*and* the slope clears 1.5 standard errors. Otherwise the projection is flat.
Nobody improves linearly forever, and an insignificant slope is noise.

**Spread.** The detrended round-to-round standard deviation, shrunk toward a
population prior: `σ² = (n_eff·σ̂² + k₀·σ²_pop) / (n_eff + k₀)`. With ≥ 12
differentials the shock is bootstrapped from the player's own residuals instead
of drawn normal, which preserves the right-skew of blow-up rounds.

**Variance reduction.** Paths run in antithetic pairs sharing one uniform stream,
so a pair sees identical cadence draws and opposite scoring shocks. Note that
mirroring the *uniforms* would not achieve this — `cos(2π(1−u)) = cos(2πu)`, so
Box–Muller returns the same normal; the negation is applied to the draw.

---

## 4. Cadence

Estimated from the gaps between posted rounds, over the last 365 days, widening
to 540 days then all history if there are too few.

- **bootstrap** (≥ 5 gaps): resample the player's own gaps. Society golf comes in
  bursts, and a Poisson process would smooth away exactly the clustering that
  makes a counting window turn over in spurts.
- **gamma** (1–4 gaps): `λ ~ Gamma(2 + N, 365/12 + T)`, drawn **once per path** so
  cadence uncertainty propagates into the fan rather than averaging out.
- **prior** (no gaps): 12 rounds/year, and confidence is forced to `low`.

A player who has not posted in more than twice their median gap is flagged
`dormant`, and their first simulated gap is inflated. Dormancy over 120 days
caps confidence at `low` — the dates depend on rounds that may never be played.

---

## 5. What the page will and will not say

The user's rule: below a confidence threshold, **hide the number and say why**,
rather than presenting noise with a caveat.

| Accepted differentials | status | What is shown |
|---|---|---|
| 0 | `no_data` | "Post your first round to start your handicap." |
| 1–2 | `pre_index` | Countdown to having an index. No projection. |
| 3–7 | `mechanical` | **"Your next round"** only — that surface is exact (§6). No fan, no probabilities: σ from ≤ 7 samples is not a number worth showing. |
| 8–19 | `simulated` | Everything, confidence `low`. |
| 20–39 | `simulated` | Everything, confidence `medium`. |
| 40+, `effectiveN ≥ 12` | `simulated` | Everything, confidence `high`. |

Also refused: any date beyond the 2-year simulated horizon; a median ETA when
fewer than half the paths reach the target.

---

## 6. "Your next round" carries no model risk

`nextRound.ts` answers *"if your next differential is X, your index becomes
exactly Y"*. This is a total function of committed state, computed with the same
arithmetic the database uses. No distribution, no trend, no cadence assumption.

It is also the only projection surface that works for a player with three
accepted rounds — which, in a golf society, is most of them.

`differentialNeededFor` inverts it by binary search, which is exact because the
resulting index is monotone non-decreasing in the posted differential (every
order statistic of the window is).

---

## 7. Tunable constants

None of these are derived. They are defensible starting points to be recalibrated.

| Constant | Value | Where | Notes |
|---|---|---|---|
| `σ_pop` | `2.5 + 0.06 × HI` | `simulate.ts` | Recalibrate from `fantasy_player_profiles.differential_stddev`. |
| `SIGMA_PRIOR_STRENGTH` | 8 pseudo-rounds | `simulate.ts` | At 8 observations the estimate is half prior, half player. |
| `TREND_DAMPING_ROUNDS` | 12 | `simulate.ts` | |
| `TREND_SIGNIFICANCE` | 1.5 s.e. | `simulate.ts` | |
| `MAX_TREND_STROKES` | 3.0 | `simulate.ts` | |
| `DIFFERENTIAL_HALFLIFE_ROUNDS` | 20 | `fantasy/simulation/differentials.ts` | Shared with fantasy odds — changing it moves both. |
| `sims` | 1000 | `simulate.ts` | See below. SE of the median ≈ 0.06 HI, inside the 0.1 displayed. |

Cost scales with `sims × (rounds simulated per path)`, and the second factor is the
player's cadence — not a constant. Measured on a development desktop: a typical
player (~25 rounds/year, so ~50 simulated rounds per path) builds in ~150–350ms;
the most active player in staging (262 differentials, ~111 rounds/year, ~220
simulated rounds per path) takes ~730ms. Expect several times that on a phone.

It is a one-time cost per profile per page load — the target wheel and the date
picker are pure lookups against the finished matrix, so interaction stays
instant. If it ever needs to come down, scale `sims` inversely with
`diagnostics.roundsPerYear` rather than cutting the horizon.

---

## 8. Things this model does not know

Stated plainly, because it is what makes the rest credible.

- **Which courses you will play.** Differentials are course-adjusted, but a run
  of hard courses in bad weather is not in the model.
- **Lessons, injury, new clubs, age.** Any step change in ability appears only
  after it has shown up in posted scores, and then only slowly.
- **Seasonality.** UK scoring is materially worse in winter. Deliberately not
  modelled: at 5–40 rounds per player a per-player seasonal term is
  unidentifiable and would be fitting noise. If it is wanted, estimate **one**
  global month-effect vector pooled across all profiles — never per-player.
- **Your actual fixture list.** Cadence is sampled, not read from the calendar.
  Known future events could be injected as certain rounds with sampling only in
  the gaps; that is a real modelling change, not a bolt-on.
- **Whether you will play at all.** Every date assumes you keep posting scores.

### A known discrepancy

`recalc_handicap_profile` selects the counting window with
`order by played_at desc limit 20`, and `played_at` is a `date` with no
tiebreak. When the 20-round cut lands inside a group of rounds sharing a date,
Postgres keeps an arbitrary subset, and **re-running the recalculation can move a
player's index without any new scores** — up to ~0.4 on real staging data (3 rows
out of 251 for the most active player).

The TS replay keeps the last-appended rounds, which is *a* valid answer but not
necessarily the stored one. Because of this the chart's historical line is read
from `handicap_index_history` (authoritative) while the simulation is seeded from
the differential stream, so the two can disagree very slightly on affected dates.

`ambiguousCutDays()` identifies the affected dates. Fixing this properly means
adding a deterministic tiebreak to the SQL's `order by`.

---

## 9. Tests

| File | What it protects |
|---|---|
| `lib/whs/__tests__/replay.fixture.test.ts` | **The load-bearing one.** Replays real captured staging streams and asserts the TS engine reproduces `handicap_index_history` row for row. If this goes red, the SQL is right and the TS is wrong. |
| `lib/whs/__tests__/handicapIndex.test.ts` | The tables, caps, rounding, and the small-n drift property. |
| `lib/stats/projection/__tests__/simulate.test.ts` | The modelling claims: a stationary player is not projected to improve; the floor lands near the best-8-of-20 mean; a newer player's index is projected to rise; caps bind; the fan widens; cadence changes the answer. |
| `lib/stats/projection/__tests__/nextRound.test.ts` | Monotonicity, and that `differentialNeededFor` exactly inverts the impact table. |
| `lib/stats/projection/__tests__/perf.bench.test.ts` | Order-of-magnitude regressions in simulation cost. |
| `lib/stats/__tests__/projectionView.test.ts` | Which numbers are shown and which are withheld. |

Refresh the SQL-equivalence fixtures (read-only, staging) with:

```
node scripts/capture-whs-fixture.mjs
```
