---
paths:
  - "apps/app/lib/fantasy/**"
  - "apps/app/app/majors/fantasy/**"
---

# Fantasy odds and markets

## Market identity must be stable

A market's identifying params must not contain a value that drifts as the model
reprices. Putting the offered band/value/position into the identity meant every
refresh minted a *new* market, producing duplicate markets and cash-out buttons that
did nothing.

`score_band`, `score_total` and `finish_position` therefore have **stable** params.
The offered bands, values and positions are recomputed per refresh and priced from
the persisted exact-score pmf (`fantasy_score_pmfs`). A pick settles and cashes out
on its **own** self-describing key (`settleKey` + `scoreSelectionProbability`), so its
value tracks drift instead of being orphaned by it.

## Paged reads need ORDER BY

Any paged read of snapshots must specify a deterministic `ORDER BY`. Paging 1,265
snapshots without one silently dropped an entire market, which surfaced as "birdie and
bogey are priced identically" — a plausible-looking wrong answer rather than an error.
The same class of bug hit `get_round_detail_snapshot` via `LIMIT 1` with no ordering.

## Model version

`PROFILE_MODEL_VERSION` lives at
[profiles.ts:49](../../apps/app/lib/fantasy/profiles.ts#L49) and is currently `5`.
Bump it whenever the profile maths changes. Profiles rebuild lazily — `ensureProfiles`
refits any profile whose `model_version` is below the constant on the next odds
refresh. Books only reprice on staleness or an admin Refresh, so a model change is not
visible until one of those happens; say so when reporting the change.

## Scores

Read scores through the `round_effective_scores` view, never the raw score events. A
picked-up hole writes a NULL-strokes event *and* a `picked_up` hole state; reading raw
lets the hole vanish from the model or push a freeze clip one hole past its threshold.

## Testing

`lib/fantasy` carries 23 of the repo's 47 test files. Simulation changes should come
with a test — `npx vitest run` from `apps/app`.
