-- ============================================================
-- Fix: ciaga_get_frozen_leaderboard raises "column reference
-- profile_id is ambiguous" when called from a DO block or
-- trigger context for certain competitions.
--
-- The snapshot no longer calls ciaga_get_frozen_leaderboard.
-- Instead it reads competition_leaderboard_entries directly,
-- which is freshly recomputed by ciaga_compute_competition_leaderboard
-- moments before the freeze transition fires. This gives each
-- player's current score at the exact instant of freeze — which
-- IS the correct frozen value:
--   · Players still live at the threshold → score through threshold
--   · Players behind the threshold → score through current hole
--   · Players already finished → their full final score
--
-- The dynamic ciaga_get_frozen_leaderboard path is kept as the
-- API fallback for any competition where the snapshot is absent.
-- ============================================================

-- ── Fix trigger function ──────────────────────────────────────
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
    RAISE WARNING 'ciaga_on_freeze_state_change: failed to snapshot leaderboard for competition %: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ── Re-run backfill for frozen competitions ───────────────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id
    FROM public.competitions
    WHERE leaderboard_freeze_state = 'frozen'
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.competition_player_freeze_snapshots
      WHERE competition_id = v_id
      LIMIT 1
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
