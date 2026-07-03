-- CIAGA Calendar v6: richer score data.
-- - get_calendar_rounds: add score_differential (card shows AGS + diff).
-- - get_calendar_round_info: per-participant raw strokes, par played, AGS,
--   course handicap and score differential (UI derives Net + Score-to-Par).

-- ---------------------------------------------------------------------------
-- get_calendar_rounds — add score_differential (return columns change → DROP).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_calendar_rounds(uuid[], timestamptz, timestamptz);

CREATE FUNCTION public.get_calendar_rounds(
  _profile_ids uuid[],
  _from timestamptz,
  _to timestamptz
)
RETURNS TABLE (
  round_id           uuid,
  profile_id         uuid,
  participant_id     uuid,
  name               text,
  course_name        text,
  scheduled_at       timestamptz,
  started_at         timestamptz,
  finished_at        timestamptz,
  status             public.round_status,
  format_type        public.round_format_type,
  gross              integer,
  course_handicap    integer,
  score_differential numeric,
  player_names       text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    r.id            AS round_id,
    rp.profile_id   AS profile_id,
    rp.id           AS participant_id,
    r.name          AS name,
    c.name          AS course_name,
    r.scheduled_at  AS scheduled_at,
    r.started_at    AS started_at,
    r.finished_at   AS finished_at,
    r.status        AS status,
    r.format_type   AS format_type,
    COALESCE(hrr.adjusted_gross_score, rct.total_strokes) AS gross,
    hrr.course_handicap_used AS course_handicap,
    hrr.score_differential   AS score_differential,
    (
      SELECT array_agg(p2.name ORDER BY p2.name)
      FROM round_participants rp2
      JOIN profiles p2 ON p2.id = rp2.profile_id
      WHERE rp2.round_id = r.id
    ) AS player_names
  FROM round_participants rp
  JOIN rounds r ON r.id = rp.round_id
  LEFT JOIN courses c ON c.id = r.course_id
  LEFT JOIN handicap_round_results hrr
    ON hrr.participant_id = rp.id AND hrr.round_id = r.id
  LEFT JOIN round_current_totals rct ON rct.participant_id = rp.id
  WHERE rp.profile_id = ANY(_profile_ids)
    AND (
      (r.status IN ('scheduled', 'starting', 'live')
        AND r.scheduled_at IS NOT NULL
        AND r.scheduled_at >= _from AND r.scheduled_at < _to)
      OR
      (r.status = 'finished'
        AND r.finished_at IS NOT NULL
        AND r.finished_at >= _from AND r.finished_at < _to)
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_calendar_rounds(uuid[], timestamptz, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- get_calendar_round_info — richer per-participant score block for the popup.
-- raw_strokes / par_played are summed over the holes the player actually
-- scored (handles 9-hole / partial rounds); UI derives Net + Score-to-Par.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_calendar_round_info(_round_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'round_id', r.id,
    'name', r.name,
    'course_name', c.name,
    'status', r.status,
    'format_type', r.format_type,
    'scheduled_at', r.scheduled_at,
    'started_at', r.started_at,
    'finished_at', r.finished_at,
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'profile_id', rp.profile_id,
        'name', p.name,
        'raw_strokes', tot.raw_strokes,
        'par_played', tot.par_played,
        'ags', hrr.adjusted_gross_score,
        'course_handicap', hrr.course_handicap_used,
        'score_differential', hrr.score_differential
      ) ORDER BY p.name)
      FROM round_participants rp
      JOIN profiles p ON p.id = rp.profile_id
      LEFT JOIN handicap_round_results hrr
        ON hrr.participant_id = rp.id AND hrr.round_id = r.id
      LEFT JOIN LATERAL (
        SELECT SUM(rcs.strokes)::int AS raw_strokes,
               SUM(rhs.par)::int     AS par_played
        FROM round_current_scores rcs
        JOIN round_hole_snapshots rhs
          ON rhs.round_tee_snapshot_id = rp.tee_snapshot_id
         AND rhs.hole_number = rcs.hole_number
        WHERE rcs.participant_id = rp.id AND rcs.round_id = r.id
      ) tot ON true
      WHERE rp.round_id = r.id
    ), '[]'::jsonb)
  )
  FROM rounds r
  LEFT JOIN courses c ON c.id = r.course_id
  WHERE r.id = _round_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_calendar_round_info(uuid) TO authenticated;
