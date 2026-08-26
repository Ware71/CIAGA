-- ============================================================
-- A player who missed the cut ranks BELOW everyone who survived it.
--
-- The leaderboard ranks on cumulative net, ascending. A cut player stopped
-- after the cut round, so their total covers fewer rounds and is therefore
-- LOWER than any survivor's — which put them near the top of the board. On a
-- 4-round event cut to 2 rounds, a cut player came out 2nd.
--
-- That is not just cosmetic: season standings count wins as
-- `COUNT(*) FILTER (WHERE position = 1)`, so a cut player could be credited
-- with winning the event.
--
-- Sorting them last keeps their total visible (they did post it) while placing
-- them where they belong. They already earn no points (20260825000008).
--
-- Patches the installed definition via pg_get_functiondef.
-- ============================================================

DO $patch$
DECLARE
  r         record;
  v_def     text;
  v_new     text;
  v_patched integer := 0;
  v_anchor  text :=
'        ELSE RANK() OVER (
          ORDER BY
            agg.net_score ASC NULLS LAST,
            agg.holes_completed DESC';
  v_replace text :=
'        ELSE RANK() OVER (
          ORDER BY
            -- Missed the cut => below the whole surviving field, whatever the
            -- raw total says. Their score covers fewer rounds, so it is lower
            -- by construction.
            (SELECT CASE WHEN ee.cut_status = ''missed'' THEN 1 ELSE 0 END
               FROM event_entries ee
              WHERE ee.event_id = p_event_id
                AND ee.profile_id = agg.profile_id) ASC NULLS FIRST,
            agg.net_score ASC NULLS LAST,
            agg.holes_completed DESC';
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
      RAISE WARNING 'cut ranking: anchor not found, left unpatched';
      CONTINUE;
    END IF;

    v_new := replace(v_def, v_anchor, v_replace);
    EXECUTE v_new;
    v_patched := v_patched + 1;
  END LOOP;

  RAISE NOTICE 'cut ranking: patched % definition(s)', v_patched;
END
$patch$;

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
