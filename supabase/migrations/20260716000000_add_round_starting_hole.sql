-- Adds a semi-automatic "starting hole" to rounds.
--
-- The first hole with a non-removed entry (round_hole_states.status IN
-- ('completed','picked_up')) becomes the round's starting_hole, unless the
-- round owner/scorer has manually overridden it (starting_hole_source =
-- 'manual'). This matters for matchplay: dormie/"match decided" detection
-- and per-hole running state need the true chronological hole order, which
-- isn't 1..18 when a group didn't tee off on hole 1.

ALTER TABLE public.rounds
  ADD COLUMN starting_hole integer NOT NULL DEFAULT 1,
  ADD COLUMN starting_hole_source text NOT NULL DEFAULT 'auto';

ALTER TABLE public.rounds
  ADD CONSTRAINT rounds_starting_hole_range CHECK (starting_hole BETWEEN 1 AND 18);

ALTER TABLE public.rounds
  ADD CONSTRAINT rounds_starting_hole_source_check CHECK (starting_hole_source IN ('auto', 'manual'));

CREATE OR REPLACE FUNCTION public.ciaga_sync_round_starting_hole()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.rounds
  SET starting_hole = COALESCE(
    (
      SELECT MIN(hole_number)
      FROM public.round_hole_states
      WHERE round_id = NEW.round_id
        AND status IN ('completed', 'picked_up')
    ),
    1
  )
  WHERE id = NEW.round_id
    AND starting_hole_source = 'auto';

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ciaga_sync_round_starting_hole IS
  'Keeps rounds.starting_hole in sync with the earliest hole that has a completed/picked_up entry, as long as the round has not been manually overridden (starting_hole_source = ''manual'').';

DROP TRIGGER IF EXISTS trg_sync_round_starting_hole ON public.round_hole_states;

CREATE TRIGGER trg_sync_round_starting_hole
AFTER INSERT OR UPDATE OF status ON public.round_hole_states
FOR EACH ROW
EXECUTE FUNCTION public.ciaga_sync_round_starting_hole();

-- Surface starting_hole/starting_hole_source in the round detail snapshot RPC.
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
        'course_name', c.name,
        'event_tee_time_id', r.event_tee_time_id,
        'starting_hole', r.starting_hole,
        'starting_hole_source', r.starting_hole_source
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
   Includes: round meta (incl. event_tee_time_id, starting_hole, starting_hole_source),
   participants (with resolved handicaps), participant extras (playing_handicap_used, team_id),
   teams (with playing_handicap_used), tee snapshot, hole snapshots, current scores, and hole states.';

-- Surface starting_hole in the live-rounds batch feed RPC too, so matchplay
-- feed cards for in-progress rounds use the correct chronological hole order.
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
      'starting_hole', r.starting_hole,
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
  'Batch returns all data needed for live round feed cards: round meta (incl. starting_hole),
   participants, teams, tee snapshot, holes, current scores, hole states, and profiles.
   Used by getLiveRoundsAsFeedItems() to avoid per-round query fan-out.';
