-- Fix plus-handicap stroke allocation throughout:
--
-- Under WHS, a plus-handicap player's strokes are assigned to the EASIEST holes
-- (highest stroke index: SI 18, 17, 16…), not the hardest holes as with normal
-- handicaps. The previous implementation applied strokes to the hardest holes for
-- all players, which is wrong for plus handicaps.
--
-- Fixes:
-- 1. ciaga_strokes_received_on_hole: detect negative course_handicap and flip
--    the remainder allocation to easiest holes (highest SI).
--
-- 2. compute_handicap_round_result: replace the inline base_strokes/rem_strokes
--    NDB-cap expression with a call to ciaga_strokes_received_on_hole so the
--    AGS calculation respects plus-handicap hole allocation.
--
-- 3. v_handicap_round_result_source: same – replace inline expressions with
--    ciaga_strokes_received_on_hole so the view-based AGS path is consistent.
--
-- 4. Rebuild handicap_round_results to pick up corrected values.

-- ============================================================
-- 1. ciaga_strokes_received_on_hole – fix plus-handicap allocation
-- ============================================================

CREATE OR REPLACE FUNCTION public.ciaga_strokes_received_on_hole(
  course_handicap integer,
  hole_si integer,
  hole_count integer DEFAULT 18
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
  select
    case
      when hole_si is null or hole_si < 1 or hole_si > hole_count then 0
      when course_handicap < 0 then
        -- Plus handicap: strokes assigned to easiest holes (highest SI)
        -(abs(course_handicap) / hole_count)
        - case when hole_si > hole_count - (abs(course_handicap) % hole_count) then 1 else 0 end
      else
        -- Normal handicap: strokes assigned to hardest holes (lowest SI)
        (course_handicap / hole_count)
        + case when (course_handicap % hole_count) >= hole_si then 1 else 0 end
    end;
$function$;

-- ============================================================
-- 2. compute_handicap_round_result – use function for NDB cap
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
    r.status
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
  select
    count(*) filter (where hole_status <> 'not_started') as holes_started,
    count(*) filter (where hole_status = 'completed') as holes_completed
  from holes
),
par_total as (
  select sum(par)::int as par_sum
  from holes
),
ch as (
  select
    case
      when (select hi from p) is null then
        -- No HI: use 54 max for 18-hole, 27 (50% of 54) for 9-hole
        case when (select holes_count from tee) = 9 then 27 else 54 end
      when (select holes_count from tee) = 9 then
        -- 9-hole: apply 50% handicap allowance (WHS stroke play 9-hole allowance)
        round(
          round(
            ((select hi from p) * (select slope from tee) / 113.0)
            + ((select cr from tee) - (select par_sum from par_total))
          ) / 2.0
        )::int
      else
        round(
          ((select hi from p) * (select slope from tee) / 113.0)
          + ((select cr from tee) - (select par_sum from par_total))
        )::int
    end as course_handicap_used
),
ags as (
  select
    sum(
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
        when 'picked_up' then
          h.par
          + 2
          + public.ciaga_strokes_received_on_hole(
              (select course_handicap_used from ch),
              h.stroke_index,
              coalesce((select holes_count from tee), 18)
            )
        else -- not_started: assign NDB same as picked_up (WHS Rule 3.1)
          h.par
          + 2
          + public.ciaga_strokes_received_on_hole(
              (select course_handicap_used from ch),
              h.stroke_index,
              coalesce((select holes_count from tee), 18)
            )
      end
    )::int as adjusted_gross_score
  from holes h
)
select
  (select round_id from p) as round_id,
  (select participant_id from p) as participant_id,
  (select profile_id from p) as profile_id,
  ((select started_at from p)::date) as played_at,

  g.holes_started,
  g.holes_completed,
  ((select holes_count from tee) = 9) as is_9_hole,

  case
    when (select holes_count from tee) = 9 then (g.holes_started >= 7)
    else (g.holes_started >= 14)
  end as accepted,

  case
    when (select status from p) <> 'finished' then 'round_not_finished'
    when (select holes_count from tee) = 9 and g.holes_started < 7 then 'min_holes_not_met_9'
    when (select holes_count from tee) <> 9 and g.holes_started < 14 then 'min_holes_not_met_18'
    else null
  end as rejected_reason,

  (select hi from p) as handicap_index_used,
  (select course_handicap_used from ch) as course_handicap_used,
  (select tee_snapshot_id from p) as tee_snapshot_id,

  (select adjusted_gross_score from ags) as adjusted_gross_score,

  case
    when (select status from p) <> 'finished' then null

    -- NULL when minimum holes not met (round not accepted)
    when (select holes_count from tee) = 9  and g.holes_started < 7  then null
    when (select holes_count from tee) <> 9 and g.holes_started < 14 then null

    when (select holes_count from tee) = 9 and (select hi from p) is null then null

    when (select holes_count from tee) = 9 and (select hi from p) is not null then
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

    else
      round(
        (
          (((select adjusted_gross_score from ags)::numeric - (select cr from tee)) * 113.0)
          / (select slope from tee)
        ),
        1
      )
  end as score_differential,

  ((select holes_count from tee) = 9 and (select hi from p) is not null) as derived_from_9,
  ((select holes_count from tee) = 9 and (select hi from p) is null) as pending_9

from gate g;$function$
;

-- ============================================================
-- 3. v_handicap_round_result_source – use function for AGS
-- ============================================================

create or replace view "public"."v_handicap_round_result_source" as  WITH base AS (
         SELECT rp.id AS participant_id,
            rp.round_id,
            rp.profile_id,
            rp.tee_snapshot_id,
            COALESCE(r.finished_at, r.started_at, r.created_at) AS played_at,
            rp.handicap_index AS handicap_index_used,
            ts.holes_count,
            ts.rating AS course_rating,
            ts.slope AS slope_rating,
            ts.par_total
           FROM ((public.round_participants rp
             JOIN public.rounds r ON ((r.id = rp.round_id)))
             LEFT JOIN public.round_tee_snapshots ts ON ((ts.id = rp.tee_snapshot_id)))
        ), hole_counts AS (
         SELECT b.participant_id,
            (count(DISTINCT rcs.hole_number))::integer AS holes_started,
            (count(DISTINCT rcs.hole_number) FILTER (WHERE (rcs.strokes IS NOT NULL)))::integer AS holes_completed
           FROM (base b
             LEFT JOIN public.round_current_scores rcs ON (((rcs.round_id = b.round_id) AND (rcs.participant_id = b.participant_id))))
          GROUP BY b.participant_id
        ), prepared AS (
         SELECT b.participant_id,
            b.round_id,
            b.profile_id,
            b.tee_snapshot_id,
            b.played_at,
            b.handicap_index_used,
            b.holes_count,
            b.course_rating,
            b.slope_rating,
            b.par_total,
            hc.holes_started,
            hc.holes_completed,
            (COALESCE(b.holes_count, 18) = 9) AS is_9_hole,
            -- hole_count used for stroke allocation: 9 or 18
            CASE WHEN (COALESCE(b.holes_count, 18) = 9) THEN 9 ELSE 18 END AS hole_count,
                CASE
                    WHEN (COALESCE(b.holes_count, 18) = 9) THEN (hc.holes_started >= 7)
                    ELSE (hc.holes_started >= 14)
                END AS accepted,
                CASE
                    WHEN ((COALESCE(b.holes_count, 18) = 9) AND (hc.holes_started < 7)) THEN (('acceptability_gate_failed: started '::text || hc.holes_started) || ' of 7'::text)
                    WHEN ((COALESCE(b.holes_count, 18) <> 9) AND (hc.holes_started < 14)) THEN (('acceptability_gate_failed: started '::text || hc.holes_started) || ' of 14'::text)
                    ELSE NULL::text
                END AS rejected_reason,
                -- course_handicap_used: for 9-hole rounds apply 50% allowance (WHS stroke play)
                CASE
                    WHEN (b.handicap_index_used IS NULL) THEN
                        CASE WHEN (COALESCE(b.holes_count, 18) = 9) THEN 27 ELSE 54 END
                    WHEN ((b.slope_rating IS NULL) OR (b.course_rating IS NULL) OR (b.par_total IS NULL)) THEN NULL::integer
                    WHEN (COALESCE(b.holes_count, 18) = 9) THEN
                        (round(
                            round((((b.handicap_index_used * (b.slope_rating)::numeric) / 113.0) + (b.course_rating - (b.par_total)::numeric)))
                            / 2.0
                        ))::integer
                    ELSE (round((((b.handicap_index_used * (b.slope_rating)::numeric) / 113.0) + (b.course_rating - (b.par_total)::numeric))))::integer
                END AS course_handicap_used
           FROM (base b
             JOIN hole_counts hc USING (participant_id))
        ), ags_calc AS (
         SELECT p.participant_id,
                CASE
                    WHEN p.accepted THEN ( SELECT (sum(x.adjusted_score))::integer AS sum
                       FROM ( SELECT hs.hole_number,
                                hs.par,
                                hs.stroke_index,
                                rcs.strokes AS raw_score,
                                    CASE
WHEN (rcs.hole_number IS NULL) THEN 'not_started'::text
WHEN (rcs.strokes IS NULL) THEN 'picked_up'::text
ELSE 'completed'::text
                                    END AS hole_status,
                                public.ciaga_strokes_received_on_hole(
                                  p.course_handicap_used,
                                  hs.stroke_index,
                                  p.hole_count
                                ) AS strokes_received,
                                    CASE
WHEN (rcs.hole_number IS NULL) THEN (hs.par + public.ciaga_strokes_received_on_hole(p.course_handicap_used, hs.stroke_index, p.hole_count))
WHEN (rcs.strokes IS NULL) THEN ((hs.par + 2) + public.ciaga_strokes_received_on_hole(p.course_handicap_used, hs.stroke_index, p.hole_count))
ELSE LEAST(rcs.strokes, ((hs.par + 2) + public.ciaga_strokes_received_on_hole(p.course_handicap_used, hs.stroke_index, p.hole_count)))
                                    END AS adjusted_score
                               FROM (public.round_hole_snapshots hs
                                 LEFT JOIN public.round_current_scores rcs ON (((rcs.round_id = p.round_id) AND (rcs.participant_id = p.participant_id) AND (rcs.hole_number = hs.hole_number))))
                              WHERE (hs.round_tee_snapshot_id = p.tee_snapshot_id)) x)
                    ELSE NULL::integer
                END AS adjusted_gross_score
           FROM prepared p
        ), final AS (
         SELECT p.round_id,
            p.participant_id,
            p.profile_id,
            p.played_at,
            p.holes_started,
            p.holes_completed,
            p.is_9_hole,
            p.accepted,
            p.rejected_reason,
            p.handicap_index_used,
            p.course_handicap_used,
            p.tee_snapshot_id,
            a.adjusted_gross_score,
            (p.accepted AND p.is_9_hole AND (p.handicap_index_used IS NULL)) AS pending_9,
            (p.accepted AND p.is_9_hole AND (p.handicap_index_used IS NOT NULL)) AS derived_from_9,
                CASE
                    WHEN (NOT p.accepted) THEN NULL::numeric
                    WHEN (p.is_9_hole AND (p.handicap_index_used IS NULL)) THEN NULL::numeric
                    WHEN (p.is_9_hole AND (p.handicap_index_used IS NOT NULL)) THEN public.round1((public.round1(((((a.adjusted_gross_score)::numeric - p.course_rating) * 113.0) / (NULLIF(p.slope_rating, 0))::numeric)) + public.round1(((p.handicap_index_used * 0.52) + 1.2))))
                    ELSE public.round1(((((a.adjusted_gross_score)::numeric - p.course_rating) * 113.0) / (NULLIF(p.slope_rating, 0))::numeric))
                END AS score_differential
           FROM (prepared p
             LEFT JOIN ags_calc a ON ((a.participant_id = p.participant_id)))
        )
 SELECT round_id,
    participant_id,
    profile_id,
    played_at,
    holes_started,
    holes_completed,
    is_9_hole,
    accepted,
    rejected_reason,
    handicap_index_used,
    course_handicap_used,
    tee_snapshot_id,
    adjusted_gross_score,
    pending_9,
    derived_from_9,
    score_differential
   FROM final;

-- ============================================================
-- 4. Rebuild handicap_round_results for all rounds
--    (picks up corrected stroke allocation for plus handicaps)
-- ============================================================

SELECT public.ciaga_refresh_handicaps_from(NULL);
