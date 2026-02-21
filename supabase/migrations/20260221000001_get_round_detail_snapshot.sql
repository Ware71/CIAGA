-- Performance Phase 1: single-call round detail snapshot.
-- Combines round meta, participants (via existing get_round_participants RPC),
-- participant extras, teams, tee snapshot, hole snapshots, current scores,
-- and hole states into one JSONB payload.

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
        'team_number', t.team_number
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
          'par_total', ts.par_total
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
   participant extras (playing_handicap_used, team_id), teams, tee snapshot, hole snapshots,
   current scores, and hole states.';
