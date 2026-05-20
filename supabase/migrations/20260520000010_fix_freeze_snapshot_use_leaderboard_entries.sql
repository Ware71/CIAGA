-- ============================================================
-- Fix: ciaga_on_freeze_state_change (from 20260520000008/009)
-- called ciaga_get_frozen_leaderboard which raises
-- "column reference profile_id is ambiguous" from a trigger /
-- DO-block context for some competitions.
--
-- Simpler approach: read competition_leaderboard_entries directly.
-- Those entries are freshly recomputed by
-- ciaga_compute_competition_leaderboard immediately before the
-- freeze transition fires, so they accurately represent each
-- player's score at the instant of freeze.
-- ============================================================

-- ── Replace trigger function ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.ciaga_on_freeze_state_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.leaderboard_freeze_state IS DISTINCT FROM 'frozen' THEN
    RETURN NEW;
  END IF;
  IF OLD.leaderboard_freeze_state = 'frozen' THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.competition_player_freeze_snapshots
      (competition_id, profile_id, gross_score, net_score, to_par,
       holes_shown, actual_holes_completed, is_live, position)
    SELECT
      cle.competition_id,
      cle.profile_id,
      cle.gross_score,
      cle.net_score,
      cle.to_par,
      cle.holes_completed,
      cle.holes_completed,
      cle.is_live,
      cle.position
    FROM public.competition_leaderboard_entries cle
    WHERE cle.competition_id = NEW.id
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ciaga_on_freeze_state_change: failed to snapshot for competition %: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ── Backfill any frozen competitions still missing a snapshot ─
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM public.competitions WHERE leaderboard_freeze_state = 'frozen'
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.competition_player_freeze_snapshots
      WHERE competition_id = v_id LIMIT 1
    );

    BEGIN
      INSERT INTO public.competition_player_freeze_snapshots
        (competition_id, profile_id, gross_score, net_score, to_par,
         holes_shown, actual_holes_completed, is_live, position)
      SELECT
        cle.competition_id,
        cle.profile_id,
        cle.gross_score,
        cle.net_score,
        cle.to_par,
        cle.holes_completed,
        cle.holes_completed,
        cle.is_live,
        cle.position
      FROM public.competition_leaderboard_entries cle
      WHERE cle.competition_id = v_id
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'backfill freeze snapshot failed for competition %: %', v_id, SQLERRM;
    END;
  END LOOP;
END;
$$;
