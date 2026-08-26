-- ============================================================
-- Field size for a cut event counts everyone who played the cut round.
--
-- The formula points models scale to field size, counted as "players with a
-- submission for every round" (HAVING COUNT(*) >= num_rounds). With a cut that
-- is only the survivors, so winning a 40-player event with a cut to 10 scored
-- like winning a 10-player one.
--
-- With a cut, the field is everyone assessed at it — made or missed. That keeps
-- a cut event's points comparable to a non-cut event of the same size.
-- Events without a cut are unaffected.
--
-- Patches the installed definition via pg_get_functiondef rather than
-- reproducing ~450 lines of leaderboard SQL here.
-- ============================================================

DO $patch$
DECLARE
  r         record;
  v_def     text;
  v_new     text;
  v_patched integer := 0;
  v_anchor  text :=
'      SELECT COUNT(*) INTO v_field_size
      FROM (
        SELECT s.profile_id
        FROM event_round_submissions s
        WHERE s.event_id = p_event_id AND s.accepted = true
        GROUP BY s.profile_id
        HAVING COUNT(*) >= v_num_rounds
      ) completed_players;';
  v_replace text :=
'      -- With a cut, the field is everyone assessed at it (made or missed);
      -- otherwise it is the players who completed every round.
      IF EXISTS (SELECT 1 FROM events e2
                  WHERE e2.id = p_event_id AND e2.cut_config IS NOT NULL) THEN
        SELECT COUNT(*) INTO v_field_size
        FROM event_entries ee
        WHERE ee.event_id = p_event_id
          AND ee.cut_status IS NOT NULL;
      ELSE
        SELECT COUNT(*) INTO v_field_size
        FROM (
          SELECT s.profile_id
          FROM event_round_submissions s
          WHERE s.event_id = p_event_id AND s.accepted = true
          GROUP BY s.profile_id
          HAVING COUNT(*) >= v_num_rounds
        ) completed_players;
      END IF;';
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'ciaga_compute_event_leaderboard'
  LOOP
    v_def := pg_get_functiondef(r.oid);

    IF position(v_anchor IN v_def) = 0 THEN
      RAISE WARNING
        'cut field size: anchor not found in ciaga_compute_event_leaderboard, left unpatched';
      CONTINUE;
    END IF;

    v_new := replace(v_def, v_anchor, v_replace);
    EXECUTE v_new;
    v_patched := v_patched + 1;
  END LOOP;

  RAISE NOTICE 'cut field size: patched % definition(s)', v_patched;
END
$patch$;

-- Rebuild any event that already has cut results so its points reflect the
-- new field size.
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT DISTINCT ee.event_id
    FROM public.event_entries ee
    WHERE ee.cut_status IS NOT NULL
  LOOP
    PERFORM public.ciaga_compute_event_leaderboard(v_id);
  END LOOP;
END $$;
