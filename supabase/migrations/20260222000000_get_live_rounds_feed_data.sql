-- Performance Phase 2: batch RPC for live round feed data.
-- Returns all data needed by getLiveRoundsAsFeedItems() for multiple rounds
-- in a single call, eliminating the 30+ query fan-out.

CREATE OR REPLACE FUNCTION public.get_live_rounds_feed_data(_round_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _result jsonb;
BEGIN
  SELECT jsonb_agg(round_data) INTO _result
  FROM (
    SELECT jsonb_build_object(
      'round_id', r.id,
      'format_type', r.format_type,
      'format_config', r.format_config,
      'side_games', r.side_games,
      'started_at', r.started_at,
      'course_name', (
        SELECT rcs.course_name
        FROM round_course_snapshots rcs
        WHERE rcs.round_id = r.id
        ORDER BY rcs.created_at DESC
        LIMIT 1
      ),

      'participants', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', rp.id,
          'profile_id', rp.profile_id,
          'is_guest', rp.is_guest,
          'display_name', rp.display_name,
          'role', rp.role,
          'tee_snapshot_id', rp.tee_snapshot_id,
          'team_id', rp.team_id,
          'handicap_index', rp.handicap_index,
          'playing_handicap_used', rp.playing_handicap_used,
          'course_handicap_used', rp.course_handicap_used
        ) ORDER BY rp.created_at), '[]'::jsonb)
        FROM round_participants rp
        WHERE rp.round_id = r.id
      ),

      'teams', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', t.id,
          'round_id', t.round_id,
          'name', t.name,
          'team_number', t.team_number
        ) ORDER BY t.team_number), '[]'::jsonb)
        FROM round_teams t
        WHERE t.round_id = r.id
      ),

      'tee_snapshot', (
        SELECT jsonb_build_object(
          'id', ts.id,
          'rating', ts.rating,
          'slope', ts.slope,
          'par_total', ts.par_total
        )
        FROM round_tee_snapshots ts
        WHERE ts.id = (
          SELECT rp2.tee_snapshot_id
          FROM round_participants rp2
          WHERE rp2.round_id = r.id AND rp2.tee_snapshot_id IS NOT NULL
          LIMIT 1
        )
      ),

      'holes', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'hole_number', h.hole_number,
          'par', h.par,
          'yardage', h.yardage,
          'stroke_index', h.stroke_index
        ) ORDER BY h.hole_number), '[]'::jsonb)
        FROM round_hole_snapshots h
        WHERE h.round_tee_snapshot_id = (
          SELECT rp3.tee_snapshot_id
          FROM round_participants rp3
          WHERE rp3.round_id = r.id AND rp3.tee_snapshot_id IS NOT NULL
          LIMIT 1
        )
      ),

      'scores', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'participant_id', s.participant_id,
          'hole_number', s.hole_number,
          'strokes', s.strokes,
          'created_at', s.created_at
        )), '[]'::jsonb)
        FROM round_current_scores s
        WHERE s.round_id = r.id
      ),

      'hole_states', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'participant_id', hs.participant_id,
          'hole_number', hs.hole_number,
          'status', hs.status
        )), '[]'::jsonb)
        FROM round_hole_states hs
        WHERE hs.round_id = r.id
      ),

      'profiles', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'avatar_url', p.avatar_url
        )), '[]'::jsonb)
        FROM profiles p
        WHERE p.id IN (
          SELECT rp4.profile_id
          FROM round_participants rp4
          WHERE rp4.round_id = r.id AND rp4.profile_id IS NOT NULL
        )
      )
    ) AS round_data
    FROM rounds r
    WHERE r.id = ANY(_round_ids)
  ) sub;

  RETURN COALESCE(_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_live_rounds_feed_data IS
  'Batch returns all data needed for live round feed cards: round meta, participants,
   teams, tee snapshot, holes, current scores, hole states, and profiles.
   Used by getLiveRoundsAsFeedItems() to avoid per-round query fan-out.';
