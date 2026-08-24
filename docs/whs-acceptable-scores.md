# WHS Acceptable Scores — how CIAGA decides a round counts

_Reference standard: R&A **Rules of Handicapping**, as applied within GB&I by the England Golf /
CONGU document **"Guidance on the WHS Rules of Handicapping as applied within GB&I" v2.8**._

_Companion doc: [`format-whs-audit.md`](./format-whs-audit.md) covers Appendix C **handicap
allowances** — how many strokes you play off in a given format. That is a different question from
the one here, which is whether the round produces a Score Differential at all._

---

## Why GB&I and not "the R&A"

R&A Rule 2.1 deliberately does **not** state the minimum number of holes or the list of acceptable
formats. Both are delegated:

> "National Associations have the ability to select the formats of play that are acceptable for
> handicap purposes within their own jurisdiction, from an authorized list of formats." — Rule 2.1a
>
> "National Associations have discretion to decide how many holes must be played for both a 9-hole
> and an 18-hole score to be acceptable for handicap purposes." — Rule 2.2

So "match the R&A" resolves to "match a National Association". CIAGA is a UK society
(ciagagolf.com), which makes **GB&I** the binding jurisdiction.

---

## 1. The rules CIAGA implements

### Rule 2.1 — when a score is acceptable

> "A score is acceptable for handicap purposes if the round has been played: In an authorized
> format of play over at least the minimum number of holes required for either a 9-hole or an
> 18-hole score to be acceptable. In the company of at least one other person, who may also act as
> a marker. By the Rules of Golf. On a golf course with a current Course Rating and Slope Rating…
> On a golf course during its active season"

### G2.2(1)B — minimum holes

> "For a score to be acceptable as a **9-hole** score, **all holes** of the measured 9-hole course
> must have been played… For a score to be acceptable as an **18-hole** score **at least 10 holes**
> of the measured course must have been played. Scores of between 10 and 17 holes are scaled up to
> an 18-hole equivalent gross differential in accordance with Rule 3.2."

The 10-hole figure is a **2024 revision** change; it was 14 under the 2020 Rules, and 14 is what
CIAGA shipped with.

### Rules 3.1 / 3.2 — the two different kinds of missing hole

This distinction is the one most easily got wrong, and CIAGA had it wrong:

| Situation | Rule | Treatment |
|---|---|---|
| Hole **started**, not holed out (a pick-up) | 3.1 | Net double bogey (par + 2 + strokes received) |
| Hole **never started** | 3.2 | **Excluded from the AGS**; the differential is scaled up using the player's expected Score Differential |

GB&I Appendix I:
> "The approach taken is to generate an **average expected score based on the Handicap Index** of
> the player… **Note: The Holes Not Played adjustment is only relevant for 18-hole rounds.** For a
> 9-hole round to be acceptable for handicapping in GB&I all 9 holes must be played and a NDB
> adjustment would be applied to any holes started but not completed."

### G2.1a(1) / G5.10 — authorised formats

> "GB&I direct that individual scores from **Fourball Betterball** format for competition
> Strokeplay are acceptable for handicapping purposes."

Match play is acceptable only "in some Jurisdictions" (G3.3/1) — GB&I is not one of them. Formats
where the player does not play their own ball throughout (foursomes, greensomes, scramble) are not
authorised anywhere.

### G2.2(1)A — the initial award

> "In GB&I a minimum number of **54 holes** must be played in order to be awarded a Handicap
> Index; either **complete** 9-hole or **complete** 18-hole rounds… The **maximum hole score for
> new golfers is par + 5** strokes, and holes not completed or scoring above this will be adjusted
> to par + 5."

Two 9-hole scores are **combined** for the initial award. Once an index exists, every subsequent
9-hole score is **scaled up** immediately and never combined.

### G6.1a / Appendix I §II B — the 9-hole Course Handicap

> `CH = ((H.I. ÷ 2 (to 1dp)) × (9-hole SLOPE ÷ 113)) + (9-hole C.R. − 9-hole Par)`

Only the index is halved. `(CR − Par)` is already a 9-hole figure.

### Rules 5.7 / 5.8 / 5.9 — index mechanics

- **5.7** — "A Low Handicap Index is established once a player has at least **20 acceptable
  scores** in their scoring record." Below 20 there is no LHI, and therefore no caps.
- **5.8** — soft cap above +3.0 over LHI (excess halved); hard cap at +5.0.
- **5.9** — a differential **7.0–9.9** below the index reduces it by **1.0**; **10.0 or more**
  below reduces it by **2.0**. "A reduction… is applied by adjusting **each of the most recent 20
  Score Differentials**… which includes the exceptional score."

### GDef/1 — active season

> "Active and Inactive seasons are **not implemented in GB&I**. Golf should be played throughout
> [the year]…"

CIAGA has no active-season concept, which is correct here by omission.

---

## 2. Where it lives in the code

```
rounds.status → 'finished'   (trigger trg_compute_results_on_round_finish)
  → compute_results_for_round(round_id)
      → snapshots HI as of (round_date − 1) onto round_participants.handicap_index
      → upsert_handicap_round_result(participant_id)
          → compute_handicap_round_result   ← THE GATE
  → recalc_profiles_when_round_finishes
      → recalc_handicap_profile(profile_id)
          → reads view ciaga_scoring_record_stream  (WHERE accepted = true)
          → writes handicap_index_history
```

| Concern | Source of truth | TypeScript mirror |
|---|---|---|
| Is this round acceptable? | `compute_handicap_round_result`, `ciaga_is_authorised_format` | [`lib/whs/acceptability.ts`](../apps/app/lib/whs/acceptability.ts) |
| Expected-score scaling | `ciaga_expected_sd_per_hole` | — (server-side only) |
| Index from differentials | `recalc_handicap_profile` | [`lib/whs/handicapIndex.ts`](../apps/app/lib/whs/handicapIndex.ts) |
| Which differentials feed it | view `ciaga_scoring_record_stream` | — |

All of the SQL above was last rewritten in
[`20260824000000_whs_acceptability_gbi_alignment.sql`](../supabase/migrations/20260824000000_whs_acceptability_gbi_alignment.sql).

### `rejected_reason` values

Evaluated in this order, so the reason names the **first** thing that failed. `accepted` is derived
from it (`rejected_reason IS NULL`), so the two cannot disagree — they used to.

| Value | Meaning |
|---|---|
| `round_not_finished` | The round is still live or in draft |
| `format_not_authorised` | Scramble, greensomes or foursomes |
| `no_course_rating` | The tee snapshot has no Course Rating or Slope Rating |
| `no_hole_data` | The tee snapshot has no per-hole par |
| `min_holes_not_met_9` | Fewer than 9 holes played on a 9-hole tee |
| `min_holes_not_met_18` | Fewer than 10 holes played on an 18-hole tee |
| `incomplete_round_no_index` | Player has no index yet and the round was not complete |

---

## 3. What changed, and what it was before

The gate was written against the 2020 Rules. It both **rejected valid scores** and **accepted
invalid ones**.

| # | Topic | GB&I / R&A | CIAGA before | Status |
|---|---|---|---|---|
| 1 | 18-hole minimum | ≥ 10 holes | ≥ 14 started | **Fixed** |
| 2 | 9-hole minimum | all 9 played | ≥ 7 started | **Fixed** |
| 3 | Holes not played | Excluded from AGS, scaled up (3.2) | Given a net double bogey | **Fixed** |
| 4 | Holes not finished | Net double bogey (3.1) | Net double bogey | Was already right |
| 5 | Authorised formats | Shared-ball not acceptable | All 12 formats posted a differential | **Fixed** |
| 6 | Course Rating / Slope | Required | Nullable, unvalidated → NULL or divide-by-zero | **Fixed** |
| 7 | `accepted` vs finished | — | `accepted` didn't test `status='finished'`, `rejected_reason` did | **Fixed** |
| 8 | Pre-index max hole score | par + 5 (3.1a) | NDB off a fabricated Course Handicap of 54 | **Fixed** |
| 9 | Pre-index rounds | Must be complete | Partial rounds accepted | **Fixed** |
| 10 | 9-hole Course Handicap | `(HI÷2) × Slope9/113 + (CR9 − Par9)` | Halved the whole expression, `(CR − Par)` included | **Fixed** |
| 11 | Low Handicap Index | Established at 20 scores (5.7) | Established from the first index | **Fixed** |
| 12 | Exceptional Score Reduction | −1.0 / −2.0 (5.9) | `esr_applied` hard-coded `0` | **Fixed** |
| 13 | 20-score window cut | — | `order by played_at desc limit 20`, no tiebreak | **Fixed** — now `(played_at, round_id)` |
| 14 | Two 9s combined pre-index | Only for the initial award | `pending_9` → `combined_nines` | Was already right |
| 15 | 9-hole scale-up constant | Closed calculation | `0.52 × HI + 1.2` | Effectively right — see below |
| 16 | Active season | Not implemented in GB&I | Not implemented | Was already right |
| 17 | Best-8-of-20, adjustments, caps, 54.0 | Rules 5.2 / 5.7 / 5.8 | `ciaga_lowest_of_n_count`, `ciaga_hi_adjustment`, cap block | Was already right |

### Note on #13

`docs/projections.md` recorded this as "A known discrepancy": re-running the recalc could move a
player's index by up to ~0.4 with no new scores, because two rounds sharing a date could swap
across the 20-score boundary. Deterministic ordering was a **prerequisite** for Rule 5.9, which
needs a stable notion of "the most recent 20" — so it got fixed as part of this work rather than
as a nicety.

### Note on #15 — the expected-score approximation

WHS treats the expected Score Differential as a **closed calculation** and does not publish it.
CIAGA uses `0.52 × HI + 1.2` per 9 holes, which reproduces the GB&I worked examples (Appendix I
§II B) to within 0.1:

| Handicap Index | GB&I published | `0.52·HI + 1.2` |
|---|---|---|
| 20.5 | 11.8 | 11.86 |
| 22.1 | 12.6 | 12.69 |

The same constant now serves both the 9-hole scale-up and the Rule 3.2 holes-not-played scale-up
(`ciaga_expected_sd_per_hole` divides it by 9), so there is one model rather than two.

### The Rule 3.2 differential

For an 18-hole tee with `h` of `H` holes played:

```
SD = round(  (113 / Slope) × (AGS_played − CR × h / H)
           + expected_SD_per_hole(HI) × (H − h)
          , 1)
```

When `h = H` the pro-rated rating collapses to `CR` and the expected term to zero, so this is
**algebraically identical to the previous formula for complete rounds**. That is asserted directly
in the test suite — it is the property that confines this change to the cases it is meant to touch.

---

## 4. Deliberate divergences

These are decisions. They are not oversights, and they should not be "fixed" without a
conversation.

### 4.1 Match play still counts

GB&I does not authorise match play. CIAGA is a society where match play is common, and counting
those rounds was judged more useful than strict compliance. `ciaga_is_authorised_format` returns
`true` for `matchplay`, and both the SQL and the TypeScript mirror say so in a comment.

If this is ever revisited, it is a one-line change in two places plus a full replay.

### 4.2 PCC is not implemented

Rule 5.6's Playing Conditions Calculation adjusts every differential for how the field scored that
day:

```
Score Differential = (113 / Slope) × (AGS − CR − PCC)
```

CIAGA's differential has no PCC term. Implementing it needs a per-course-per-day field of
acceptable scores, which the society has for events but not for casual rounds. Out of scope by
decision; the effect is that CIAGA differentials are slightly harsher on hard days and slightly
kinder on easy ones than an official index would be.

### 4.3 Pre-registration and marker are documented, not enforced

Rule 2.1 requires a score to be played "in the company of at least one other person", and
G2.1a(2) requires pre-registration on the day. CIAGA implements neither as a gate, on the basis of
G2.1a(1):

> "Under WHS, for example, regular informal competitions, often organized as **roll-ups or society
> events**, would now fall into this category [organized competitions]… WHS requires that rounds in
> 'organized competitions' in an acceptable format are considered to have been pre-registered."

A CIAGA round is created in advance, has named participants, and is scored collaboratively — it is
an organised society event in exactly the sense G2.1a(1) describes. The marker requirement is not
checked; a genuinely solo round would still post a differential.

---

## 5. Known loose ends

- **`v_handicap_round_result_source`** (defined in
  `20260515000000_fix_plus_handicap_stroke_allocation.sql`, and before that in the base schema) is a
  dead parallel implementation of the whole gate. Nothing in the app reads it — a repo-wide search
  finds it only in migrations. It was **not** updated by the alignment work and is now definitively
  divergent. It should be dropped, but deleting a database object was outside the scope of that
  change.
- **`combined_from_9`** exists as a column on `handicap_round_results` and is never written.
- An odd, unpaired `pending_9` round is silently dropped from the scoring record until a partner
  9-hole round arrives. That is arguably correct — G2.2(1)A requires the pair — but it is invisible
  to the player.
- `soft_cap_delta` and `hard_cap_delta` are written with the same value. The split has always been
  informational.

---

## 6. Applying a rules change

Changing any of the above changes historical differentials, so the pipeline has to be replayed.
This is deliberately **not** run inside a migration — it walks every finished round.

**`ciaga_refresh_handicaps_from(null)` cannot be called over the API.** Two blockers, both found
the hard way on 2026-08-24:

1. The `p_from_date = NULL` branch runs `DELETE FROM handicap_round_results;` with no `WHERE`
   clause. Supabase's safe-update guard rejects that with **SQLSTATE 21000, "DELETE requires a
   WHERE clause"**. The function is atomic, so a failed attempt changes nothing.
2. Even with a qualified early date, replaying every round in one statement exceeds the PostgREST
   8-second statement timeout (**SQLSTATE 57014**).

Use the cursor-batched variant instead, which exists for exactly this and whose header states its
per-batch semantics are identical. Every finished round is after 1900, so this cutoff rebuilds
everything:

```js
let lastTs = null, lastId = null;
for (;;) {
  const { data } = await db.rpc("ciaga_refresh_handicaps_step", {
    p_from_date: "1900-01-01", p_after_ts: lastTs, p_after_id: lastId, p_max_rounds: 10,
  });
  lastTs = data.last_ts; lastId = data.last_id;
  if (data.remaining === 0 || data.processed === 0) break;
}
```

The one behavioural difference from the `NULL` branch: it leaves `handicap_round_results` rows for
**non-finished** rounds alone, rather than wiping the table wholesale. Those rows should not exist
anyway.

Snapshot `current_handicaps` and `handicap_round_results` before and after, and diff them, so the
size of the move is known before production sees it. On staging (428 rounds, 8 members) the replay
took ~46s in 43 batches. See `CLAUDE.md` for the migration ordering rules.
