-- ============================================================================
-- Align "acceptable score" handling with the R&A Rules of Handicapping as
-- applied within GB&I (England Golf / CONGU guidance v2.8).
--
-- The gate was written against the 2020 Rules and has drifted. It both rejects
-- valid scores and accepts invalid ones. Full reasoning, citations and the
-- gap table live in docs/whs-acceptable-scores.md.
--
-- WHAT CHANGES
--
--   1. Minimum holes (G2.2(1)B). 18-hole score: >= 10 holes played (was 14).
--      9-hole score: ALL 9 must be played (was >= 7).
--
--   2. Holes never started are no longer given a net double bogey. NDB is
--      Rule 3.1, which governs holes STARTED and not finished. Holes not
--      played fall under Rule 3.2: they are excluded from the Adjusted Gross
--      Score and the differential is scaled up using the player's expected
--      Score Differential for the missing holes.
--
--   3. Authorised formats (G2.1a(1) / G5.10). Shared-ball formats — scramble,
--      greensomes, foursomes — no longer post a differential. The player does
--      not play their own ball, so the score is not theirs.
--
--   4. Course Rating / Slope must exist. Previously a tee with no rating
--      produced a NULL or divide-by-zero differential while still reading
--      accepted = true.
--
--   5. accepted now derives from rejected_reason, so the two can no longer
--      disagree (a live round used to read accepted = true alongside
--      rejected_reason = 'round_not_finished').
--
--   6. Pre-index players (Rule 3.1a / G2.2(1)A). Maximum hole score is
--      par + 5, not a net double bogey off a fabricated Course Handicap of
--      54, and the round must be complete to count toward the initial award.
--
--   7. 9-hole Course Handicap (G6.1a, Appendix I II B):
--        ((HI / 2 to 1dp) * Slope9 / 113) + (CR9 - Par9)
--      The previous form halved the whole expression, (CR - Par) included.
--
--   8. Low Handicap Index (Rule 5.7) is established only once the player has
--      20 acceptable scores. Soft/hard caps were biting new members who
--      should have had none.
--
--   9. Exceptional Score Reduction (Rule 5.9) is implemented. esr_applied
--      has existed as a column since the base schema and was always 0.
--
--  10. The 20-score window cut is deterministic. It was
--      `order by played_at desc limit 20` with no tiebreak, which let a
--      replay move an index by ~0.4 with no new scores
--      (docs/projections.md, "A known discrepancy").
--
-- DELIBERATE DIVERGENCES (decisions, not oversights — see the doc):
--   * Match play still posts a differential. GB&I does not authorise it;
--     CIAGA is a society where match play is common and the society has
--     chosen to keep counting it.
--   * PCC (Rule 5.6) is not implemented. The differential has no PCC term.
--   * The expected Score Differential is approximated by 0.52*HI + 1.2 per
--     9 holes. WHS's own figure is a closed calculation; see the helper.
--
-- NOT RUN HERE: the historical replay. Applying this migration changes the
-- rules but does not rebuild history. Run
--   select public.ciaga_refresh_handicaps_from(null);
-- separately (staging first) — it walks every finished round and is far too
-- slow for a migration transaction.
-- ============================================================================


-- ============================================================
-- 1. ciaga_is_authorised_format – Rule 2.1a / G2.1a(1), G5.10
-- ============================================================

CREATE OR REPLACE FUNCTION public.ciaga_is_authorised_format(
  p_format public.round_format_type
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  -- Shared-ball formats are not authorised anywhere: the player does not play
  -- their own ball throughout, so the returned score is not an individual one.
  --
  -- Everything else returns true. Note that this INCLUDES matchplay, which
  -- GB&I does not authorise (G3.3/1 notes match play counts only "in some
  -- Jurisdictions"). That is a deliberate society-level decision, not an
  -- oversight — see docs/whs-acceptable-scores.md.
  --
  -- Four-ball formats (pairs_stableford, team_bestball, team_strokeplay,
  -- team_stableford) are authorised per G5.10, which directs that individual
  -- scores from Fourball Betterball strokeplay are acceptable.
  --
  -- Compared as text so a future enum label cannot break this at parse time.
  select coalesce(p_format::text, '') not in ('scramble', 'greensomes', 'foursomes');
$function$;

COMMENT ON FUNCTION public.ciaga_is_authorised_format(public.round_format_type) IS
  'Rule 2.1a / GB&I G2.1a(1): is this round format acceptable for handicap
   purposes? False for shared-ball formats (scramble/greensomes/foursomes).
   Deliberately true for matchplay, which GB&I does not authorise — a society
   policy decision documented in docs/whs-acceptable-scores.md.';


-- ============================================================
-- 2. ciaga_expected_sd_per_hole – Rule 3.2 / 5.1b scaling
-- ============================================================

CREATE OR REPLACE FUNCTION public.ciaga_expected_sd_per_hole(p_hi numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
  -- The mean expected 9-hole Score Differential for a player of a given
  -- Handicap Index. WHS treats this as a closed calculation and does not
  -- publish it, but 0.52*HI + 1.2 reproduces the GB&I worked examples
  -- (Appendix I II B) to within 0.1:
  --     HI 20.5 -> GB&I 11.8, this 11.86
  --     HI 22.1 -> GB&I 12.6, this 12.69
  --
  -- Divided by 9 to give a per-hole contribution, so the same constant serves
  -- both the 9-hole scale-up and the Rule 3.2 holes-not-played scale-up rather
  -- than introducing a second model.
  --
  -- Not defined without an index: a player with no Handicap Index has no
  -- expected score, which is why G2.2(1)A requires complete rounds for the
  -- initial award.
  select case
    when p_hi is null then null
    else ((p_hi * 0.52) + 1.2) / 9.0
  end;
$function$;

COMMENT ON FUNCTION public.ciaga_expected_sd_per_hole(numeric) IS
  'Per-hole expected Score Differential contribution, (0.52*HI + 1.2)/9.
   Used to scale up rounds of 10-17 holes (Rule 3.2). NULL when the player
   has no Handicap Index.';


-- ============================================================
-- 3. compute_handicap_round_result – the acceptability gate
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_handicap_round_result(p_participant_id uuid)
 RETURNS TABLE(round_id uuid, participant_id uuid, profile_id uuid, played_at date, holes_started integer, holes_completed integer, is_9_hole boolean, accepted boolean, rejected_reason text, handicap_index_used numeric, course_handicap_used integer, tee_snapshot_id uuid, adjusted_gross_score integer, score_differential numeric, derived_from_9 boolean, pending_9 boolean)
 LANGUAGE sql
AS $function$with p as (
  select
    rp.id as participant_id,
    rp.round_id,
    rp.profile_id,
    rp.handicap_index as hi,
    rp.tee_snapshot_id,
    r.started_at,
    r.status,
    r.format_type
  from round_participants rp
  join rounds r on r.id = rp.round_id
  where rp.id = p_participant_id
),
tee as (
  select
    ts.id as tee_snapshot_id,
    ts.holes_count,
    ts.rating::numeric as cr,
    ts.slope::numeric as slope
  from round_tee_snapshots ts
  join p on p.tee_snapshot_id = ts.id
),
scores as (
  -- latest strokes per participant+hole (prevents fan-out)
  select distinct on (e.participant_id, e.hole_number)
    e.participant_id,
    e.hole_number,
    e.strokes
  from round_score_events e
  join p on p.participant_id = e.participant_id
  where e.strokes is not null
  order by e.participant_id, e.hole_number, e.created_at desc
),
holes as (
  select
    hs.participant_id,
    hs.round_id,
    hs.hole_number,
    hs.status as hole_status,
    h.par,
    h.stroke_index,
    s.strokes as raw_strokes
  from round_hole_states hs
  join p on p.participant_id = hs.participant_id

  -- correct join: hole snapshots belong to a tee snapshot
  join round_hole_snapshots h
    on h.round_tee_snapshot_id = p.tee_snapshot_id
   and h.hole_number = hs.hole_number

  left join scores s
    on s.participant_id = hs.participant_id
   and s.hole_number = hs.hole_number

  where
    -- for 9-hole tees, only include holes 1..9
    (select holes_count from tee) <> 9
    or hs.hole_number between 1 and 9
),
gate as (
  -- "Played" = started. A hole begun and picked up counts as played and is
  -- scored net double bogey (Rule 3.1). A hole never started does not count
  -- as played and is scaled up instead (Rule 3.2).
  select
    count(*) filter (where hole_status <> 'not_started') as holes_started,
    count(*) filter (where hole_status = 'completed') as holes_completed
  from holes
),
par_total as (
  -- Par over the WHOLE measured course, not just the holes played: the Course
  -- Handicap is always computed against the full tee (G6.1a).
  select sum(par)::int as par_sum
  from holes
),
ch as (
  -- coalesce to 0: handicap_round_results.course_handicap_used is NOT NULL, and
  -- a participant with no tee snapshot makes every term here NULL. Such a round
  -- is rejected as 'no_course_rating' anyway, but the row still has to insert.
  select coalesce(
    case
      when (select hi from p) is null then
        -- No Handicap Index: the maximum hole score is a flat par + 5
        -- (Rule 3.1a / G2.2(1)A), so no strokes are allocated and there is no
        -- meaningful Course Handicap. Recorded as 0 rather than the old
        -- fabricated 54, which made net totals read as gross - 54.
        0
      when (select holes_count from tee) = 9 then
        -- 9-hole Course Handicap, G6.1a / Appendix I II B:
        --   ((HI / 2 to 1dp) * Slope9 / 113) + (CR9 - Par9)
        -- Only the index is halved. (CR - Par) is a 9-hole figure already and
        -- must NOT be halved again — the previous implementation halved the
        -- whole expression.
        round(
          (round((select hi from p) / 2.0, 1) * (select slope from tee) / 113.0)
          + ((select cr from tee) - (select par_sum from par_total))
        )::int
      else
        round(
          ((select hi from p) * (select slope from tee) / 113.0)
          + ((select cr from tee) - (select par_sum from par_total))
        )::int
    end,
    0
  ) as course_handicap_used
),
reason as (
  -- Rule 2.1, evaluated in order so the reason names the FIRST thing that
  -- failed. accepted is derived from this below, so the two cannot disagree.
  select
    case
      when (select status from p) <> 'finished'
        then 'round_not_finished'

      when not public.ciaga_is_authorised_format((select format_type from p))
        then 'format_not_authorised'

      when (select cr from tee) is null
        or (select slope from tee) is null
        or (select slope from tee) = 0
        then 'no_course_rating'

      when (select par_sum from par_total) is null
        then 'no_hole_data'

      -- G2.2(1)B: all 9 holes of a measured 9-hole course must be played.
      when (select holes_count from tee) = 9 and g.holes_started < 9
        then 'min_holes_not_met_9'

      -- G2.2(1)B: at least 10 holes for an 18-hole score (2024 revision;
      -- this was 14 under the 2020 Rules).
      when (select holes_count from tee) <> 9 and g.holes_started < 10
        then 'min_holes_not_met_18'

      -- G2.2(1)A: the initial award is built from COMPLETE rounds only.
      -- Without an index there is no expected score to scale up with.
      when (select hi from p) is null
        and g.holes_started < coalesce((select holes_count from tee), 18)
        then 'incomplete_round_no_index'

      else null
    end as rejected_reason
  from gate g
),
ags as (
  -- Adjusted Gross Score over the holes actually PLAYED. Holes never started
  -- are excluded entirely and accounted for by the Rule 3.2 scale-up in the
  -- differential below.
  select
    sum(
      case
        when (select hi from p) is null then
          -- Rule 3.1a / G2.2(1)A: max hole score for a player without an
          -- index is par + 5, whether or not they holed out.
          case h.hole_status
            when 'completed' then least(h.raw_strokes, h.par + 5)
            else h.par + 5
          end
        else
          -- Rule 3.1: net double bogey.
          case h.hole_status
            when 'completed' then
              least(
                h.raw_strokes,
                h.par
                + 2
                + public.ciaga_strokes_received_on_hole(
                    (select course_handicap_used from ch),
                    h.stroke_index,
                    coalesce((select holes_count from tee), 18)
                  )
              )
            else
              h.par
              + 2
              + public.ciaga_strokes_received_on_hole(
                  (select course_handicap_used from ch),
                  h.stroke_index,
                  coalesce((select holes_count from tee), 18)
                )
          end
      end
    )::int as adjusted_gross_score
  from holes h
  where h.hole_status <> 'not_started'
)
select
  (select round_id from p) as round_id,
  (select participant_id from p) as participant_id,
  (select profile_id from p) as profile_id,
  ((select started_at from p)::date) as played_at,

  g.holes_started,
  g.holes_completed,
  ((select holes_count from tee) = 9) as is_9_hole,

  ((select rejected_reason from reason) is null) as accepted,
  (select rejected_reason from reason) as rejected_reason,

  (select hi from p) as handicap_index_used,
  (select course_handicap_used from ch) as course_handicap_used,
  (select tee_snapshot_id from p) as tee_snapshot_id,

  (select adjusted_gross_score from ags) as adjusted_gross_score,

  case
    when (select rejected_reason from reason) is not null then null

    -- 9-hole tee without an index: the raw 9-hole differential is read
    -- straight off adjusted_gross_score by ciaga_played9_sd, and two such
    -- rounds are COMBINED for the initial award (G2.2(1)A). Nothing to store
    -- here; the stream does the pairing.
    when (select holes_count from tee) = 9 and (select hi from p) is null then null

    -- 9-hole tee with an index: scale to an 18-hole equivalent by adding the
    -- expected Score Differential for the 9 holes not played (Rule 5.1b).
    when (select holes_count from tee) = 9 then
      round(
        (
          round(
            (
              (((select adjusted_gross_score from ags)::numeric - (select cr from tee)) * 113.0)
              / (select slope from tee)
            ),
            1
          )
          + round((((select hi from p) * 0.52) + 1.2), 1)
        ),
        1
      )

    -- Complete 18-hole round. Kept as its own branch so the arithmetic is
    -- byte-identical to the previous implementation for the overwhelming
    -- majority of the scoring record.
    when g.holes_started >= coalesce((select holes_count from tee), 18) then
      round(
        (
          (((select adjusted_gross_score from ags)::numeric - (select cr from tee)) * 113.0)
          / (select slope from tee)
        ),
        1
      )

    -- 10 to 17 holes: Rule 3.2 scale-up. The Course Rating is pro-rated over
    -- the holes played, and the holes not played contribute their expected
    -- Score Differential. When holes_started = holes_count this collapses
    -- exactly to the branch above.
    else
      round(
        (
          (
            ((select adjusted_gross_score from ags)::numeric
             - ((select cr from tee) * g.holes_started::numeric
                / coalesce((select holes_count from tee), 18)))
            * 113.0
          )
          / (select slope from tee)
        )
        + (
          public.ciaga_expected_sd_per_hole((select hi from p))
          * greatest(0, coalesce((select holes_count from tee), 18) - g.holes_started)
        ),
        1
      )
  end as score_differential,

  ((select holes_count from tee) = 9 and (select hi from p) is not null) as derived_from_9,
  ((select holes_count from tee) = 9 and (select hi from p) is null) as pending_9

from gate g;$function$
;


-- ============================================================
-- 4. ciaga_played9_sd – only ever read an ACCEPTED result
-- ============================================================

CREATE OR REPLACE FUNCTION public.ciaga_played9_sd(p_participant_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
  -- Raw (unscaled) 9-hole Score Differential, used only for the initial
  -- award, where two 9-hole scores are combined rather than scaled (G2.2(1)A).
  --
  -- The accepted filter is new: this previously read any 9-hole row, so a
  -- rejected round could still be paired into the scoring record.
  select round(
           (((hrr.adjusted_gross_score::numeric - ts.rating::numeric) * 113.0)
            / nullif(ts.slope::numeric, 0)),
           1
         )
  from handicap_round_results hrr
  join round_tee_snapshots ts on ts.id = hrr.tee_snapshot_id
  where hrr.participant_id = p_participant_id
    and hrr.is_9_hole = true
    and hrr.accepted = true;
$function$;


-- ============================================================
-- 5. ciaga_scoring_record_stream – expose round_id for a
--    deterministic window cut
-- ============================================================
--
-- round_id is APPENDED as the trailing column so this stays a legal
-- CREATE OR REPLACE. The view is therefore never dropped and its
-- GRANT SELECT survives. (Dropping a view resets its grants — the same
-- trap CLAUDE.md records for DROP FUNCTION.)

create or replace view "public"."ciaga_scoring_record_stream" as  WITH base AS (
         SELECT hrr.profile_id,
            hrr.participant_id,
            hrr.round_id,
            hrr.played_at,
            hrr.is_9_hole,
            hrr.accepted,
            hrr.pending_9,
            hrr.score_differential,
            hrr.tee_snapshot_id,
            hrr.adjusted_gross_score
           FROM public.handicap_round_results hrr
          WHERE (hrr.accepted = true)
        ), eighteen AS (
         SELECT base.profile_id,
            base.played_at,
            base.score_differential AS differential,
            false AS combined_from_9,
            base.round_id
           FROM base
          WHERE ((base.is_9_hole = false) AND (base.score_differential IS NOT NULL))
        ), nine_with_hi AS (
         SELECT base.profile_id,
            base.played_at,
            base.score_differential AS differential,
            false AS combined_from_9,
            base.round_id
           FROM base
          WHERE ((base.is_9_hole = true) AND (base.pending_9 = false) AND (base.score_differential IS NOT NULL))
        ), nine_pending AS (
         SELECT base.profile_id,
            base.played_at,
            base.participant_id,
            base.round_id,
            public.ciaga_played9_sd(base.participant_id) AS played9sd
           FROM base
          WHERE ((base.is_9_hole = true) AND (base.pending_9 = true))
        ), pending_pairs AS (
         SELECT nine_pending.profile_id,
            nine_pending.played_at,
            nine_pending.round_id,
            nine_pending.played9sd,
            row_number() OVER (PARTITION BY nine_pending.profile_id ORDER BY nine_pending.played_at, nine_pending.participant_id) AS rn
           FROM nine_pending
          WHERE (nine_pending.played9sd IS NOT NULL)
        ), combined_nines AS (
         SELECT a.profile_id,
            b.played_at,
            round(((a.played9sd + b.played9sd) / 2.0), 1) AS differential,
            true AS combined_from_9,
            b.round_id
           FROM (pending_pairs a
             JOIN pending_pairs b ON (((b.profile_id = a.profile_id) AND (b.rn = (a.rn + 1)))))
          WHERE ((a.rn % (2)::bigint) = 1)
        )
 SELECT eighteen.profile_id,
    eighteen.played_at,
    eighteen.differential,
    eighteen.combined_from_9,
    eighteen.round_id
   FROM eighteen
UNION ALL
 SELECT nine_with_hi.profile_id,
    nine_with_hi.played_at,
    nine_with_hi.differential,
    nine_with_hi.combined_from_9,
    nine_with_hi.round_id
   FROM nine_with_hi
UNION ALL
 SELECT combined_nines.profile_id,
    combined_nines.played_at,
    combined_nines.differential,
    combined_nines.combined_from_9,
    combined_nines.round_id
   FROM combined_nines;


-- ============================================================
-- 6. recalc_handicap_profile – LHI gate, ESR, deterministic cut
-- ============================================================

CREATE OR REPLACE FUNCTION public.recalc_handicap_profile(p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_version text;

  -- The scoring record, materialised once in deterministic chronological
  -- order. Walking it record-by-record (rather than date-by-date) is what
  -- makes Rule 5.9 expressible: an exceptional score is judged against the
  -- index in force at the moment it was posted.
  v_diffs numeric[];
  v_dates date[];
  v_esr   numeric[];

  i  int;
  lo int;
  n  int;
  wn int;
  k  int;
  adj numeric;
  win numeric[];

  base_hi   numeric;
  esr_total numeric;
  prev_hi   numeric;
  cur_hi    numeric;

  lhi        numeric;
  over_lhi   numeric;
  capped_hi  numeric;
  soft_delta numeric;
  hard_delta numeric;

  is_last_of_date boolean;
begin
  v_version := ciaga_current_handicap_version();

  -- wipe and rebuild (CIAGA scale: simplest + correct)
  delete from handicap_index_history
  where profile_id = p_profile_id;

  select array_agg(differential order by played_at, round_id),
         array_agg(played_at    order by played_at, round_id)
    into v_diffs, v_dates
  from ciaga_scoring_record_stream
  where profile_id = p_profile_id;

  n := coalesce(array_length(v_diffs, 1), 0);
  if n = 0 then
    return;
  end if;

  v_esr := array_fill(0::numeric, array[n]);

  prev_hi := null;

  for i in 1..n loop
    -- The most recent 20, deterministically cut. The old form was
    -- `order by played_at desc limit 20` with no tiebreak, so two rounds on
    -- the same date could swap across the boundary between replays.
    lo := greatest(1, i - 19);
    wn := i - lo + 1;

    -- ---------------------------------------------------------------
    -- Rule 5.9: is THIS score exceptional, judged against the index in
    -- force before it was posted?
    -- ---------------------------------------------------------------
    if prev_hi is not null then
      if prev_hi - v_diffs[i] >= 10.0 then
        v_esr[i] := 2.0;
      elsif prev_hi - v_diffs[i] >= 7.0 then
        v_esr[i] := 1.0;
      end if;
    end if;

    if wn < 3 then
      -- not enough to form a HI yet
      cur_hi     := null;
      lhi        := null;
      soft_delta := 0;
      hard_delta := 0;
      esr_total  := 0;
    else
      win := v_diffs[lo:i];

      k   := ciaga_lowest_of_n_count(wn);
      adj := ciaga_hi_adjustment(wn);

      select round((avg(v) + adj), 1)
        into base_hi
      from (
        select v from unnest(win) as v order by v asc limit k
      ) s;

      -- Rule 5.9 applies the reduction uniformly to ALL of the most recent 20
      -- differentials, so subtracting it once from the average of the lowest k
      -- is exactly equivalent to adjusting each differential — same result,
      -- without mutating stored data. The reduction dilutes naturally as the
      -- exceptional score falls out of the 20-score window.
      select coalesce(sum(e), 0)
        into esr_total
      from unnest(v_esr[lo:i]) as e;

      base_hi := round(base_hi - esr_total, 1);

      -- WHS max Handicap Index
      base_hi := least(54.0, base_hi);

      if wn < 20 then
        -- Rule 5.7: a Low Handicap Index is established only once the player
        -- has 20 acceptable scores. Until then the caps do not exist.
        capped_hi  := base_hi;
        lhi        := null;
        soft_delta := 0;
        hard_delta := 0;
      else
        -- LHI = lowest HI over the trailing 365 days (rows already written by
        -- earlier iterations of this loop).
        select min(handicap_index)
          into lhi
        from handicap_index_history
        where profile_id = p_profile_id
          and handicap_index is not null
          and as_of_date >= (v_dates[i] - interval '365 days')::date
          and as_of_date <= v_dates[i];

        if lhi is null then
          -- LHI has just become establishable but there is no prior index in
          -- the window to seed it from: seed and do not cap.
          capped_hi  := base_hi;
          lhi        := base_hi;
          soft_delta := 0;
          hard_delta := 0;
        else
          lhi := least(54.0, lhi);

          over_lhi := base_hi - lhi;

          if over_lhi <= 3 then
            capped_hi := base_hi;

          elsif over_lhi <= 5 then
            -- Rule 5.8 soft cap: excess above +3.0 reduced by 50%
            capped_hi := round(lhi + 3 + ((over_lhi - 3) * 0.5), 1);

          else
            -- Rule 5.8 hard cap: at most +5.0 over LHI
            capped_hi := round(lhi + 5, 1);
          end if;

          capped_hi := least(54.0, capped_hi);

          -- informational deltas (recomputed post-cap so they're always correct)
          soft_delta := round(greatest(0, base_hi - capped_hi), 1);
          hard_delta := soft_delta;
        end if;

        lhi := least(54.0, lhi);
      end if;

      cur_hi := capped_hi;
    end if;

    prev_hi := cur_hi;

    -- handicap_index_history is keyed by date, so write one row per date:
    -- the last record played on that date carries the day's index.
    is_last_of_date := (i = n) or (v_dates[i + 1] <> v_dates[i]);

    if is_last_of_date then
      insert into handicap_index_history(
        profile_id, as_of_date,
        handicap_index, low_handicap_index,
        soft_cap_delta, hard_cap_delta,
        esr_applied,
        calc_version, calculated_at
      )
      values (
        p_profile_id, v_dates[i],
        cur_hi, lhi,
        soft_delta, hard_delta,
        esr_total,
        v_version, now()
      );
    end if;
  end loop;
end
$function$
;

COMMENT ON FUNCTION public.recalc_handicap_profile(uuid) IS
  'Rebuilds handicap_index_history for one profile from
   ciaga_scoring_record_stream. Implements Rule 5.2 (best-of-k of the most
   recent 20 plus small-sample adjustment), Rule 5.7 (Low Handicap Index,
   established only at 20 acceptable scores), Rule 5.8 (soft/hard caps) and
   Rule 5.9 (Exceptional Score Reduction). The 20-score window cut is
   deterministic, ordered by (played_at, round_id).

   esr_applied stores the total Rule 5.9 reduction in force on that date.';
