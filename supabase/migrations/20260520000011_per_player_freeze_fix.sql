-- ============================================================
-- Per-player freeze fix.
--
-- Previous behaviour: ciaga_on_freeze_state_change snapshotted
-- ALL players at freeze time, including those below the hole
-- threshold. The API served the snapshot for everyone, so
-- below-threshold players appeared frozen instead of live.
--
-- Fix:
--   1. ciaga_on_freeze_state_change now only snapshots players
--      whose holes_completed >= threshold.
--   2. New trigger on competition_leaderboard_entries snapshots
--      each player as they individually cross the threshold
--      while the competition is already frozen.
-- ============================================================

-- ── 1. Replace ciaga_on_freeze_state_change ───────────────────
CREATE OR REPLACE FUNCTION public.ciaga_on_freeze_state_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_threshold integer;
BEGIN
  IF NEW.leaderboard_freeze_state IS DISTINCT FROM 'frozen' THEN
    RETURN NEW;
  END IF;
  IF OLD.leaderboard_freeze_state = 'frozen' THEN
    RETURN NEW;  -- already frozen, don't re-snapshot
  END IF;
  IF NEW.leaderboard_freeze_last_holes IS NULL THEN
    RETURN NEW;  -- no freeze configured
  END IF;

  v_threshold := COALESCE(NEW.num_rounds, 1) * 18 - NEW.leaderboard_freeze_last_holes;

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
      v_threshold,           -- cap display at threshold hole
      cle.holes_completed,   -- record actual progress
      cle.is_live,
      cle.position
    FROM public.competition_leaderboard_entries cle
    WHERE cle.competition_id = NEW.id
      AND cle.holes_completed >= v_threshold  -- only at-or-above threshold
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ciaga_on_freeze_state_change: failed to snapshot for %: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ── 2. Auto-snapshot players as they cross threshold ──────────
-- Fires after every recompute of competition_leaderboard_entries.
-- When the competition is already frozen and a player's
-- holes_completed reaches the threshold for the first time,
-- insert their snapshot row (ON CONFLICT DO NOTHING so existing
-- snapshots are preserved).
CREATE OR REPLACE FUNCTION public.ciaga_auto_snapshot_on_threshold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_freeze_state      text;
  v_freeze_last_holes integer;
  v_num_rounds        integer;
  v_threshold         integer;
BEGIN
  SELECT leaderboard_freeze_state, leaderboard_freeze_last_holes, num_rounds
    INTO v_freeze_state, v_freeze_last_holes, v_num_rounds
  FROM public.competitions
  WHERE id = NEW.competition_id;

  -- Only act when competition is frozen with a threshold configured
  IF v_freeze_state IS DISTINCT FROM 'frozen' OR v_freeze_last_holes IS NULL THEN
    RETURN NEW;
  END IF;

  v_threshold := COALESCE(v_num_rounds, 1) * 18 - v_freeze_last_holes;

  IF NEW.holes_completed < v_threshold THEN
    RETURN NEW;  -- player hasn't reached the freeze line yet
  END IF;

  INSERT INTO public.competition_player_freeze_snapshots
    (competition_id, profile_id, gross_score, net_score, to_par,
     holes_shown, actual_holes_completed, is_live, position)
  VALUES
    (NEW.competition_id, NEW.profile_id,
     NEW.gross_score, NEW.net_score, NEW.to_par,
     v_threshold,          -- cap display at threshold hole
     NEW.holes_completed,  -- record actual progress
     NEW.is_live, NEW.position)
  ON CONFLICT (competition_id, profile_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_snapshot_on_threshold ON public.competition_leaderboard_entries;
CREATE TRIGGER trg_auto_snapshot_on_threshold
  AFTER INSERT OR UPDATE ON public.competition_leaderboard_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_auto_snapshot_on_threshold();
