-- Fix: Live scorecards show full 18-hole course handicap for 9-hole rounds.
-- For 9-hole rounds the handicap index should be halved before applying the
-- standard WHS formula (using the 9-hole tee's own rating, slope, and par).

-- Fix get_round_participants: add holes_count to tee CTE and halve HI for 9-hole rounds.
CREATE OR REPLACE FUNCTION public.get_round_participants(_round_id uuid)
 RETURNS TABLE(id uuid, profile_id uuid, is_guest boolean, display_name text, role text, tee_snapshot_id uuid, handicap_index numeric, course_handicap numeric, handicap_index_computed numeric, course_handicap_computed numeric, handicap_index_used numeric, course_handicap_used numeric, name text, email text, avatar_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with r as (
  select
    id as round_id,
    coalesce(started_at::date, created_at::date) as round_date
  from rounds
  where id = _round_id
  limit 1
),
tee as (
  -- Pick the tee snapshot used by this round
  select
    rts.id as tee_snapshot_id,
    rts.rating::numeric as rating,
    rts.slope::numeric as slope,
    rts.par_total::numeric as par_total,
    rts.holes_count
  from round_participants rp
  join round_tee_snapshots rts
    on rts.id = rp.tee_snapshot_id
  where rp.round_id = _round_id
    and rp.tee_snapshot_id is not null
  limit 1
),
computed_hi as (
  -- HI per participant as-of the day before the round date
  select
    rp.id as round_participant_id,
    rp.profile_id,
    (
      select h.handicap_index::numeric
      from handicap_index_history h
      join r on true
      where h.profile_id = rp.profile_id
        and h.as_of_date <= (r.round_date - 1)
      order by h.as_of_date desc nulls last
      limit 1
    ) as handicap_index_computed
  from round_participants rp
  where rp.round_id = _round_id
    and rp.profile_id is not null
),
computed_ch as (
  select
    c.round_participant_id,
    c.profile_id,
    c.handicap_index_computed,
    case
      when c.handicap_index_computed is null then null
      when (select slope from tee) is null then null
      when (select rating from tee) is null then null
      when (select par_total from tee) is null then null
      -- For 9-hole rounds: halve the handicap index before applying the WHS formula
      when (select holes_count from tee) = 9 then
        round(
          ((c.handicap_index_computed / 2.0) * ((select slope from tee) / 113.0))
          + ((select rating from tee) - (select par_total from tee))
        )
      else
        round(
          (c.handicap_index_computed * ((select slope from tee) / 113.0))
          + ((select rating from tee) - (select par_total from tee))
        )
    end as course_handicap_computed
  from computed_hi c
),
used_vals as (
  -- Values actually applied for the round (typically populated for finished/accepted handicap rows)
  select
    hrr.participant_id as round_participant_id,
    hrr.handicap_index_used::numeric as handicap_index_used,
    hrr.course_handicap_used::numeric as course_handicap_used
  from handicap_round_results hrr
  where hrr.round_id = _round_id
)
select
  rp.id,
  rp.profile_id,
  rp.is_guest,
  rp.display_name,
  rp.role::text,
  rp.tee_snapshot_id,

  -- resolved: prefer used, fallback to computed
  coalesce(u.handicap_index_used, cc.handicap_index_computed) as handicap_index,
  coalesce(u.course_handicap_used, cc.course_handicap_computed) as course_handicap,

  -- both
  cc.handicap_index_computed,
  cc.course_handicap_computed,
  u.handicap_index_used,
  u.course_handicap_used,

  p.name,
  p.email,
  p.avatar_url
from round_participants rp
left join profiles p
  on p.id = rp.profile_id
left join computed_ch cc
  on cc.round_participant_id = rp.id
left join used_vals u
  on u.round_participant_id = rp.id
where rp.round_id = _round_id
order by rp.created_at asc;
$function$
;

-- Fix get_round_detail_snapshot: expose holes_count in tee_snapshot so the
-- frontend computeCH fallback can also apply the 9-hole adjustment.
CREATE OR REPLACE FUNCTION public.get_round_detail_snapshot(_round_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _result jsonb;
  _first_tee_id uuid;
BEGIN
  -- Resolve first tee snapshot id (shared across participants)
  SELECT rp.tee_snapshot_id INTO _first_tee_id
  FROM round_participants rp
  WHERE rp.round_id = _round_id
    AND rp.tee_snapshot_id IS NOT NULL
  LIMIT 1;

  SELECT jsonb_build_object(
    'round', (
      SELECT jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'status', r.status,
        'started_at', r.started_at,
        'created_at', r.created_at,
        'format_type', r.format_type,
        'format_config', r.format_config,
        'side_games', r.side_games,
        'course_name', c.name
      )
      FROM rounds r
      LEFT JOIN courses c ON c.id = r.course_id
      WHERE r.id = _round_id
    ),

    'participants', (
      SELECT COALESCE(jsonb_agg(row_to_json(p)::jsonb), '[]'::jsonb)
      FROM get_round_participants(_round_id) p
    ),

    'participant_extras', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', rp.id,
        'playing_handicap_used', rp.playing_handicap_used,
        'team_id', rp.team_id,
        'handicap_index', rp.handicap_index
      )), '[]'::jsonb)
      FROM round_participants rp
      WHERE rp.round_id = _round_id
    ),

    'teams', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', t.id,
        'round_id', t.round_id,
        'name', t.name,
        'team_number', t.team_number,
        'playing_handicap_used', t.playing_handicap_used
      ) ORDER BY t.team_number), '[]'::jsonb)
      FROM round_teams t
      WHERE t.round_id = _round_id
    ),

    'tee_snapshot', (
      SELECT CASE WHEN _first_tee_id IS NULL THEN NULL
      ELSE (
        SELECT jsonb_build_object(
          'id', ts.id,
          'rating', ts.rating,
          'slope', ts.slope,
          'par_total', ts.par_total,
          'holes_count', ts.holes_count
        )
        FROM round_tee_snapshots ts
        WHERE ts.id = _first_tee_id
      )
      END
    ),

    'holes', (
      SELECT CASE WHEN _first_tee_id IS NULL THEN '[]'::jsonb
      ELSE (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'hole_number', h.hole_number,
          'par', h.par,
          'yardage', h.yardage,
          'stroke_index', h.stroke_index
        ) ORDER BY h.hole_number), '[]'::jsonb)
        FROM round_hole_snapshots h
        WHERE h.round_tee_snapshot_id = _first_tee_id
      )
      END
    ),

    'scores', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'participant_id', s.participant_id,
        'hole_number', s.hole_number,
        'strokes', s.strokes,
        'created_at', s.created_at
      )), '[]'::jsonb)
      FROM round_current_scores s
      WHERE s.round_id = _round_id
    ),

    'hole_states', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'participant_id', hs.participant_id,
        'hole_number', hs.hole_number,
        'status', hs.status
      )), '[]'::jsonb)
      FROM round_hole_states hs
      WHERE hs.round_id = _round_id
    )
  ) INTO _result;

  RETURN _result;
END;
$$;

COMMENT ON FUNCTION public.get_round_detail_snapshot IS
  'Returns all data needed by the round detail page in a single call.
   Includes: round meta, participants (with resolved handicaps via get_round_participants),
   participant extras (playing_handicap_used, team_id), teams (with playing_handicap_used),
   tee snapshot (including holes_count), hole snapshots, current scores, and hole states.';
