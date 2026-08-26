# Multi-round events — how it actually works

`docs/majors.md` is the product spec. This is the implementation: what a
36-hole championship or a two-day weekend does today, and the decisions behind
it. Written 2026-08-25 alongside the multi-round remediation.

## Entities

`competitions` is the recurring template ("The Invitational"); `events` is one
instance ("The Invitational 2026").

```
events (num_rounds, cut_config, handicap_locked_at)
  └── event_rounds          round_number, name, scheduled_date, course_id, default tees, status
        └── event_tee_times  event_round_id, round_id, tee_time
              └── rounds     the physical scorecard
                    └── event_round_submissions  event_id, event_round_id, round_id, profile_id
                          └── event_leaderboard_entries  one row per player per EVENT
```

- **Entry is per event** (`event_entries`, unique on `(event_id, profile_id)`).
- **Participation is per round** — a player holds one tee time per `event_round`.
- A tee time creates its `rounds` row **eagerly**, on the round's own course.
- **`round_number` is always 1..N, contiguous.** Both the add and delete routes
  call `ciaga_renumber_event_rounds` afterwards, and the client numbers new
  rounds by array position. This is an invariant, not a nicety:
  `cut_config.after_round` matches on `round_number`, so a gap means a cut set
  for "after round 1" never fires. The International 2026 was found numbering
  its two rounds **5 and 6** — earlier rounds had been deleted and the survivors
  never shifted down, because new rounds took `max(round_number) + 1` and
  deletes renumbered nothing. Migration `20260825000012` repaired every event
  and realigned default `Round N` names.

## Per-round course

Each `event_round` may have its own `course_id` and default tees. The tee-time
route resolves `event_round.course_id ?? event.course_id` when creating the
played round, and the tee-box picker follows the selected round's course.

Changing a round's course afterwards propagates to its linked rounds, but only
those still `draft`/`scheduled` — a started round has already snapshotted its
tee, par and stroke indexes, and re-pointing it would invalidate entered scores.

## Round identity

`event_round_submissions.event_round_id` is the authority for which round a card
belongs to, and both submission paths (`finishRound`, `submit-round`) set it via
`resolveEventRoundForRound`. It deliberately does **not** guess for multi-round
events: stamping round 2's card as round 1 is worse than leaving it null.

Anything that needs "the player's final round" — countback, the playoff's
quoted handicap, the leaderboard's scorecard link — orders by
`event_rounds.round_number`, never by `submitted_at`. Wall-clock order is not
round order: an admin re-accepting round 1 after round 2 was in used to switch
the countback onto round 1.

## Completion

Completion is a property of **one** event round: it needs its own tee times, and
every round played off them must have finished
(`lib/majors/eventRoundCompletion.ts`). The event completes only when every
non-cancelled round has.

This matters for the **deferred draw** — round 2 drawn after round 1 is played,
which is how a day-2 re-draw by standings works. Testing completion across the
whole event used to mark the event complete the moment round 1's last card was
signed, which settled the fantasy book irreversibly (settlement only touches
`open` picks) and published season standings on half an event.
`settleFantasyEvent` additionally refuses a multi-round event with a non-terminal
round, as a second line of defence.

## Handicaps

Each entrant's Handicap Index is **fixed when the first round starts** —
`ciaga_persist_playing_handicaps` calls `ciaga_lock_event_handicaps`, which reads
every entrant's index **from `current_handicaps` at that moment** into
`event_entries.locked_handicap_index`. Every round of the event then plays off
that value.

The lock is performed by persist itself, in the same transaction, rather than by
the start route beforehand: the scorecard starts a round on first score entry
and can fire that concurrently, which once let a round's handicaps be written
against a lock the other request had not yet committed.

`event_entries.assigned_handicap_index` is the **entry-time** snapshot and is
only a fallback for a player with no index at all. Reading it first was the
original bug — it is NOT NULL, so it always won and the live index was never
consulted; a player who entered months earlier locked at a stale figure.

Precedence in `ciaga_persist_playing_handicaps`:

```
round_participants.assigned_handicap_index   -- per-round admin override
  -> event_entries.locked_handicap_index     -- the event lock
  -> round_participants.handicap_index       -- existing snapshot
  -> current_handicaps                       -- the player's live index
```

Without the lock, finishing round 1 triggers `recalc_handicap_profile`, which
writes today's index, and round 2 was then played off an index that had already
absorbed round 1. A committee fixes handicaps for the duration of a competition.

**Deliberate consequence**: a two-day event uses the day-1 index for both rounds
rather than letting WHS's overnight revision move it. A late entrant locks at
their own entry index.

## Holes per round

Rounds are not assumed to be 18 holes. `ciaga_event_round_holes` is the single
source of truth (each round's default tee `holes_count`, 18 when unknown), and
`ciaga_event_total_holes` sums it. The freeze threshold, the frozen board's
per-round hole ranges, and the client's "R2 thru 7" decoding all derive from it.

## Cut

`events.cut_config`, or null for no cut:

```json
{ "after_round": 2, "top_n": 10, "include_ties": true, "within_strokes": null }
```

`ciaga_apply_event_cut` runs when a round completes — a no-op unless the cut
round is that round, and idempotent. It writes `event_entries.cut_status`
(`made` | `missed`), which survives leaderboard recomputes.

A cut player:

- **keeps their through-the-cut total** — they posted it;
- **ranks below the whole surviving field**, whatever the raw total says. Their
  score covers fewer rounds so it is lower by construction; without this a cut
  player came 2nd on a 4-round event, and season standings count wins as
  `position = 1`;
- **earns no season points** — enforced by a `BEFORE` trigger, because a
  post-hoc update would be wiped by the next recompute;
- **counts toward field size**. The field for points is everyone assessed at the
  cut, not just the survivors, so a cut event's points stay comparable to a
  non-cut event of the same size;
- **is treated as finished** for tie detection and event completion, and can
  never form a first-place tie;
- **is not offered** for tee times in rounds after the cut.

### Cut and fantasy

**Everything settles; nothing voids.** A cut player's markets settle on their
through-the-cut total, and round markets for rounds they did not play settle on
zero. This is the existing settlement path — no cut-specific handling — chosen
deliberately for predictability over the alternative of voiding player props.

## Round-by-round leaderboard

`ciaga_event_round_leaderboard(event_round_id)` returns standings for one round:
every non-guest player in it, live or finished. Scores come from
`round_effective_scores`, the same view the cumulative board uses, so a picked-up
hole scores net double bogey identically on both and the two cannot disagree.

Verified on staging: per-round nets sum exactly to the cumulative event total.

Exposed at `GET /api/majors/events/[id]/round-leaderboard?event_round_id=…`,
which returns nothing while the board is frozen — a per-round view would show
exactly the holes the freeze is withholding.

## Dates

`events.event_date` is the start. A multi-day event's span lives on
`event_rounds.scheduled_date`; `lib/majors/eventDates.ts` derives the range for
display. There is no `end_date` column — the rounds are the source of truth.

## Known gaps

- **Same-day WHS ordering.** `recalc_handicap_profile` orders the scoring record
  by `(played_at, round_id)`, where `played_at` is a **date** and `round_id` is a
  random v4 UUID. Two rounds on one day are therefore deterministic but ordered
  arbitrarily with respect to actual play, which matters for Rule 5.9 (each
  score is judged against the index in force before it). Fixing it means adding
  `started_at` to `ciaga_scoring_record_stream`, changing the recalc and its TS
  mirror, re-capturing the equivalence fixtures, and replaying every handicap
  profile. The event handicap lock above means this no longer affects an event's
  own scoring — only the player's onward record.
- **Matchplay league/knockout** is schema + two API routes, no UI.
  `matchplay_fixtures.round_number` is a bracket stage, unrelated to
  `event_rounds`.
- **Cut config is edit-sheet only** — not in the create wizard.
