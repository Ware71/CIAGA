-- ============================================================
-- Multi-round: stop assuming every round is 18 holes.
--
-- The freeze threshold is computed as `num_rounds * 18 - freeze_last_holes` in
-- three functions, while the leaderboard's own hole accounting already handles
-- 9-hole rounds (CASE WHEN hrr.is_9_hole THEN 9 ELSE 18 END). A 9-hole leg in a
-- multi-round event therefore makes the threshold unreachable and auto-freeze
-- never fires.
--
-- ciaga_get_frozen_leaderboard's per-round hole RANGES were fixed in
-- 20260825000001 (they now sum the rounds actually played). This handles the
-- planned total, which has to be known before the rounds exist.
--
-- The three call sites were rewritten in place by the rename migration
-- (20260528004504), so rather than reproduce their bodies here — and risk
-- reintroducing pre-rename table names — this patches whatever is currently
-- installed via pg_get_functiondef, the same technique the rename used.
-- ============================================================

-- ── 1a. Planned holes per round ───────────────────────────────
-- The client needs these too (to decode a cumulative hole count back into
-- "R2 thru 7"), so this is the one place that knows how many holes a round is.
CREATE OR REPLACE FUNCTION public.ciaga_event_round_holes(p_event_id uuid)
RETURNS TABLE(round_number integer, holes integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    er.round_number,
    COALESCE(tb.holes_count, 18)::integer AS holes
  FROM public.event_rounds er
  LEFT JOIN public.course_tee_boxes tb
    ON tb.id = COALESCE(er.default_tee_box_id_male, er.default_tee_box_id_female)
  WHERE er.event_id = p_event_id
    AND er.status <> 'cancelled'

  UNION ALL

  -- Legacy events whose rounds were never initialised: synthesise num_rounds
  -- rounds of 18. Only fires when there are no event_rounds rows at all.
  SELECT
    gs.n::integer AS round_number,
    18            AS holes
  FROM public.events e
  CROSS JOIN LATERAL generate_series(1, GREATEST(COALESCE(e.num_rounds, 1), 1)) AS gs(n)
  WHERE e.id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM public.event_rounds er2
      WHERE er2.event_id = p_event_id AND er2.status <> 'cancelled'
    )

  ORDER BY 1;
$$;

COMMENT ON FUNCTION public.ciaga_event_round_holes(uuid) IS
  'Planned hole count per non-cancelled event round, from its default tee''s
   holes_count (18 when unknown). Falls back to num_rounds rounds of 18 for
   events whose rounds were never initialised.';

GRANT EXECUTE ON FUNCTION public.ciaga_event_round_holes(uuid) TO authenticated, service_role;

-- ── 1b. Planned total, derived from the same source ───────────
CREATE OR REPLACE FUNCTION public.ciaga_event_total_holes(p_event_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(h.holes), 18)::integer
  FROM public.ciaga_event_round_holes(p_event_id) h;
$$;

COMMENT ON FUNCTION public.ciaga_event_total_holes(uuid) IS
  'Planned total holes for an event. Replaces the num_rounds * 18 assumption in
   the freeze thresholds, which a 9-hole leg made unreachable.';

GRANT EXECUTE ON FUNCTION public.ciaga_event_total_holes(uuid) TO authenticated, service_role;

-- ── 2. Patch the three freeze-threshold call sites ────────────
DO $patch$
DECLARE
  r            record;
  v_def        text;
  v_new        text;
  v_anchor     text;
  v_replace    text;
  v_event_ref  text;
  v_patched    integer := 0;
  v_names      text[] := ARRAY[
    'ciaga_check_leaderboard_auto_freeze',
    'ciaga_on_freeze_state_change',
    'ciaga_auto_snapshot_on_threshold'
  ];
  i            integer;
BEGIN
  FOR i IN 1 .. array_length(v_names, 1) LOOP
    FOR r IN
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_names[i]
    LOOP
      v_def := pg_get_functiondef(r.oid);

      IF v_names[i] = 'ciaga_on_freeze_state_change' THEN
        -- Trigger on events, so NEW is the event row.
        v_anchor    := 'COALESCE(NEW.num_rounds, 1) * 18 - NEW.leaderboard_freeze_last_holes';
        v_replace   := 'public.ciaga_event_total_holes(NEW.id) - NEW.leaderboard_freeze_last_holes';
      ELSIF v_names[i] = 'ciaga_auto_snapshot_on_threshold' THEN
        -- Trigger on event_leaderboard_entries, so NEW carries event_id.
        v_anchor    := 'COALESCE(v_num_rounds, 1) * 18 - v_freeze_last_holes';
        v_replace   := 'public.ciaga_event_total_holes(NEW.event_id) - v_freeze_last_holes';
      ELSE
        -- The rename migration (20260528004504) did a blanket
        -- 'competition_id' -> 'event_id' over function bodies, which also
        -- renamed this one's PARAMETER. Detect it rather than assume.
        v_event_ref := CASE
          WHEN position('p_event_id' IN v_def) > 0 THEN 'p_event_id'
          ELSE 'p_competition_id'
        END;
        v_anchor  := 'v_num_rounds * 18 - v_freeze_last_holes';
        v_replace := 'public.ciaga_event_total_holes(' || v_event_ref || ') - v_freeze_last_holes';
      END IF;

      IF position(v_anchor IN v_def) = 0 THEN
        -- Loud, not silent: a missed anchor means the threshold is still
        -- num_rounds * 18 and a 9-hole leg will not auto-freeze.
        RAISE WARNING
          'ciaga_event_total_holes: anchor not found in %(), threshold left unpatched. Expected: %',
          v_names[i], v_anchor;
        CONTINUE;
      END IF;

      v_new := replace(v_def, v_anchor, v_replace);
      EXECUTE v_new;
      v_patched := v_patched + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'ciaga_event_total_holes: patched % freeze-threshold call site(s)', v_patched;
END
$patch$;
