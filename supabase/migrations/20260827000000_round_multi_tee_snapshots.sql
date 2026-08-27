-- Multi-tee rounds: deterministic default tee, and every tee in the payload.
--
-- get_round_detail_snapshot and get_live_rounds_feed_data both resolved "the"
-- tee snapshot with a bare LIMIT 1 over round_participants and no ORDER BY, so
-- Postgres was free to hand back any player's tee. In a round with 3 men on
-- Robin Hood White and 1 woman on Robin Hood Red, the scorecard's Par/Yds/SI
-- columns showed whichever tee came back first (Red, in the round that prompted
-- this). The leaderboard SQL already joins per player, so the two disagreed.
--
-- The snapshot data has always been per-player and correct: /api/rounds/start
-- writes a round_tee_snapshots row plus a full round_hole_snapshots set for
-- every distinct tee, and round_participants.tee_snapshot_id points each player
-- at their own. Only these two read paths collapsed it.
--
-- Three changes:
--
--   1. Deterministic default tee: prefer the snapshot taken from the round's own
--      tee (rounds.pending_tee_box_id), then oldest, then id. Restricted to tees
--      a participant is actually on, so a default-tee snapshot nobody played
--      can't win.
--   2. New `tee_snapshots` key on get_round_detail_snapshot: every tee in play,
--      each with its own hole array, so the client can render each player's own
--      par/SI and offer a tee toggle.
--   3. Restore `holes_count` on `tee_snapshot` and add name/gender/yards_total/
--      source_tee_box_id. holes_count was added by 20260401104823 and silently
--      dropped by 20260507000002 rebuilding the function from a stale base;
--      `name` was never there. useRoundDetail reads both and has been getting
--      undefined — which is why the "Default tee" row never rendered on a live
--      round, and why the 9-hole halving in the client CH fallback never applied.
--
-- `holes` and `tee_snapshot` keep their existing shape and meaning (the default
-- tee) so an un-migrated client and a migrated database interoperate both ways.
--
-- CREATE OR REPLACE with unchanged signatures — no DROP, so EXECUTE grants are
-- not reset (see the 2026-07 security audit note in CLAUDE.md).

CREATE OR REPLACE FUNCTION public.get_round_detail_snapshot(_round_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _result jsonb;
  _pending_tee_box_id uuid;
  _default_tee_id uuid;
BEGIN
  SELECT r.pending_tee_box_id INTO _pending_tee_box_id
  FROM rounds r
  WHERE r.id = _round_id;

  -- Deterministic default tee. The round's own tee wins; otherwise the oldest
  -- snapshot, then id. Only tees a participant is actually on are eligible.
  SELECT rts.id INTO _default_tee_id
  FROM round_tee_snapshots rts
  WHERE rts.id IN (
    SELECT rp.tee_snapshot_id
    FROM round_participants rp
    WHERE rp.round_id = _round_id
      AND rp.tee_snapshot_id IS NOT NULL
  )
  ORDER BY
    (rts.source_tee_box_id IS NOT DISTINCT FROM _pending_tee_box_id) DESC,
    rts.created_at ASC,
    rts.id ASC
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

    -- Backwards-compatible: still the single default tee, now carrying the
    -- fields the client has always tried to read.
    'tee_snapshot', (
      SELECT CASE WHEN _default_tee_id IS NULL THEN NULL
      ELSE (
        SELECT jsonb_build_object(
          'id', ts.id,
          'source_tee_box_id', ts.source_tee_box_id,
          'name', ts.name,
          'gender', ts.gender,
          'rating', ts.rating,
          'slope', ts.slope,
          'par_total', ts.par_total,
          'yards_total', ts.yards_total,
          'holes_count', ts.holes_count
        )
        FROM round_tee_snapshots ts
        WHERE ts.id = _default_tee_id
      )
      END
    ),

    -- Backwards-compatible: still the default tee's holes.
    'holes', (
      SELECT CASE WHEN _default_tee_id IS NULL THEN '[]'::jsonb
      ELSE (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'hole_number', h.hole_number,
          'par', h.par,
          'yardage', h.yardage,
          'stroke_index', h.stroke_index
        ) ORDER BY h.hole_number), '[]'::jsonb)
        FROM round_hole_snapshots h
        WHERE h.round_tee_snapshot_id = _default_tee_id
      )
      END
    ),

    -- Every tee in play, default first, each with its own hole array. The client
    -- maps players onto these via participants[].tee_snapshot_id, so no
    -- participant list is emitted here — a second source of truth would drift.
    'tee_snapshots', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ts.id,
          'source_tee_box_id', ts.source_tee_box_id,
          'name', ts.name,
          'gender', ts.gender,
          'rating', ts.rating,
          'slope', ts.slope,
          'par_total', ts.par_total,
          'yards_total', ts.yards_total,
          'holes_count', ts.holes_count,
          'is_default', (ts.id = _default_tee_id),
          'holes', COALESCE(hh.holes, '[]'::jsonb)
        )
        ORDER BY (ts.id = _default_tee_id) DESC, ts.created_at ASC, ts.id ASC
      )
      FROM round_tee_snapshots ts
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'hole_number', rhs.hole_number,
          'par', rhs.par,
          'yardage', rhs.yardage,
          'stroke_index', rhs.stroke_index
        ) ORDER BY rhs.hole_number) AS holes
        FROM round_hole_snapshots rhs
        WHERE rhs.round_tee_snapshot_id = ts.id
      ) hh ON TRUE
      WHERE ts.id IN (
        SELECT rp.tee_snapshot_id
        FROM round_participants rp
        WHERE rp.round_id = _round_id
          AND rp.tee_snapshot_id IS NOT NULL
      )
    ), '[]'::jsonb),

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
   teams (with playing_handicap_used), current scores, and hole states.
   Tees: `tee_snapshots` lists EVERY tee in play, each with its own hole array — a round can
   have players on different tees, with different par, yardage and stroke index. `tee_snapshot`
   and `holes` remain the single default tee (round pending_tee_box_id, else oldest, else id)
   for backwards compatibility; prefer `tee_snapshots` and map players via tee_snapshot_id.';

-- Same deterministic tee for live feed cards. A single LEFT JOIN LATERAL replaces
-- the two duplicated LIMIT 1 subqueries, so the tee and its holes cannot disagree.
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

      -- CASE guard, not a bare jsonb_build_object: over a null lateral row that
      -- would produce {"id": null, ...}, which the caller's `?? null` treats as
      -- a real tee snapshot.
      'tee_snapshot', CASE WHEN dt.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', dt.id,
        'name', dt.name,
        'rating', dt.rating,
        'slope', dt.slope,
        'par_total', dt.par_total,
        'holes_count', dt.holes_count
      ) END,

      'holes', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'hole_number', h.hole_number,
          'par', h.par,
          'yardage', h.yardage,
          'stroke_index', h.stroke_index
        ) ORDER BY h.hole_number), '[]'::jsonb)
        FROM round_hole_snapshots h
        WHERE h.round_tee_snapshot_id = dt.id
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
    LEFT JOIN LATERAL (
      SELECT rts.id, rts.name, rts.rating, rts.slope, rts.par_total, rts.holes_count
      FROM round_tee_snapshots rts
      WHERE rts.id IN (
        SELECT rp2.tee_snapshot_id
        FROM round_participants rp2
        WHERE rp2.round_id = r.id AND rp2.tee_snapshot_id IS NOT NULL
      )
      ORDER BY
        (rts.source_tee_box_id IS NOT DISTINCT FROM r.pending_tee_box_id) DESC,
        rts.created_at ASC,
        rts.id ASC
      LIMIT 1
    ) dt ON TRUE
    WHERE r.id = ANY(_round_ids)
  ) sub;

  RETURN COALESCE(_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_live_rounds_feed_data IS
  'Batch returns all data needed for live round feed cards: round meta (incl. starting_hole),
   participants, teams, tee snapshot, holes, current scores, hole states, and profiles.
   Used by getLiveRoundsAsFeedItems() to avoid per-round query fan-out.
   The tee snapshot is the round default (pending_tee_box_id, else oldest, else id) and is
   deterministic, but feed cards remain single-tee: par/SI shown for a multi-tee round are the
   default tee''s for every player.';
