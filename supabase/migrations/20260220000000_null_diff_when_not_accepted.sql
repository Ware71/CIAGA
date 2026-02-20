-- Fix: return NULL score_differential when round is not accepted (minimum holes not met)
-- Previously, a score_differential was computed even for rejected rounds.

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
      when (select hi from p) is null then 54
      else
        round(
          ((select hi from p) * (select slope from tee) / 113.0)
          + ((select cr from tee) - (select par_sum from par_total))
        )::int
    end as course_handicap_used
),
adjusted as (
  select
    h.*,
    ((select course_handicap_used from ch) / 18) as base_strokes,
    ((select course_handicap_used from ch) % 18) as rem_strokes
  from holes h
),
ags as (
  select
    sum(
      case a.hole_status
        when 'completed' then
          least(
            a.raw_strokes,
            a.par
            + 2
            + a.base_strokes
            + case when a.rem_strokes > 0 and a.stroke_index <= a.rem_strokes then 1 else 0 end
          )
        when 'picked_up' then
          a.par
          + 2
          + a.base_strokes
          + case when a.rem_strokes > 0 and a.stroke_index <= a.rem_strokes then 1 else 0 end
        else -- not_started
          0
      end
    )::int as adjusted_gross_score
  from adjusted a
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
