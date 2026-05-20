-- ============================================================
-- Per-player freeze snapshot.
--
-- Root cause: leaderboard_freeze_state is a single flag on the
-- competitions table. Once set, every API call recomputes the
-- frozen leaderboard dynamically via ciaga_get_frozen_leaderboard,
-- applying the same global threshold to all players. Players
-- below the threshold at freeze time keep updating on the "frozen"
-- leaderboard as they continue scoring.
--
-- Fix: snapshot each player's score at the moment the competition
-- freezes, then serve the snapshot on every subsequent request.
-- The dynamic function is called once (at freeze time) rather than
-- on every page load.
-- ============================================================

-- ── Snapshot table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competition_player_freeze_snapshots (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id         uuid        NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  profile_id             uuid        NOT NULL REFERENCES public.profiles(id),
  gross_score            integer,
  net_score              integer,
  to_par                 integer,
  holes_shown            integer     NOT NULL DEFAULT 0,
  actual_holes_completed integer,
  is_live                boolean     NOT NULL DEFAULT false,
  position               integer,
  snapshotted_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, profile_id)
);

-- ── Trigger function ──────────────────────────────────────────
-- Fires after any UPDATE to competitions. When leaderboard_freeze_state
-- transitions to 'frozen' with a valid freeze_last_holes config,
-- populate the snapshot table for every player in the competition.
--
-- Wrapped in an exception block so that if ciaga_get_frozen_leaderboard
-- fails (e.g. a bug in that function), the competitions row is still
-- committed with freeze_state='frozen' and the API falls back to the
-- dynamic path gracefully.
CREATE OR REPLACE FUNCTION public.ciaga_on_freeze_state_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only act on the live→frozen transition.
  IF NEW.leaderboard_freeze_state IS DISTINCT FROM 'frozen' THEN
    RETURN NEW;
  END IF;
  IF OLD.leaderboard_freeze_state = 'frozen' THEN
    RETURN NEW;  -- already frozen, don't re-snapshot
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

DROP TRIGGER IF EXISTS trg_on_competition_freeze ON public.competitions;
CREATE TRIGGER trg_on_competition_freeze
  AFTER UPDATE ON public.competitions
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_on_freeze_state_change();

-- ── Backfill existing frozen competitions ─────────────────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM public.competitions WHERE leaderboard_freeze_state = 'frozen'
  LOOP
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
