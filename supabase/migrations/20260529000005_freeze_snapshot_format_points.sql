-- ============================================================
-- Add format_points to event_player_freeze_snapshots.
--
-- After the stableford net-equivalent change, net_score in the
-- snapshot stores net-stroke equivalents (lower = better), not
-- raw stableford points. The UI still needs to display the actual
-- stableford point total as a secondary label (e.g., "37 pts").
-- format_points carries that value through the snapshot.
--
-- Also update both freeze trigger functions to write format_points.
-- ============================================================

ALTER TABLE public.event_player_freeze_snapshots
  ADD COLUMN IF NOT EXISTS format_points numeric;

-- ── Update ciaga_on_freeze_state_change ──────────────────────
-- Fires when leaderboard_freeze_state transitions to 'frozen'.
-- Now copies format_points from event_leaderboard_entries.
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
    RETURN NEW;
  END IF;
  IF NEW.leaderboard_freeze_last_holes IS NULL THEN
    RETURN NEW;
  END IF;

  v_threshold := COALESCE(NEW.num_rounds, 1) * 18 - NEW.leaderboard_freeze_last_holes;

  BEGIN
    INSERT INTO public.event_player_freeze_snapshots
      (event_id, profile_id, gross_score, net_score, to_par, format_points,
       holes_shown, actual_holes_completed, is_live, position)
    SELECT
      cle.event_id,
      cle.profile_id,
      cle.gross_score,
      cle.net_score,
      cle.to_par,
      cle.format_points,
      v_threshold,
      cle.holes_completed,
      cle.is_live,
      cle.position
    FROM public.event_leaderboard_entries cle
    WHERE cle.event_id = NEW.id
      AND cle.holes_completed >= v_threshold
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ciaga_on_freeze_state_change: failed to snapshot for %: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ── Update ciaga_auto_snapshot_on_threshold ───────────────────
-- Fires after each recompute of event_leaderboard_entries.
-- When the event is already frozen and a player crosses the
-- threshold, snapshot them. Now includes format_points.
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
  FROM public.events
  WHERE id = NEW.event_id;

  IF v_freeze_state IS DISTINCT FROM 'frozen' OR v_freeze_last_holes IS NULL THEN
    RETURN NEW;
  END IF;

  v_threshold := COALESCE(v_num_rounds, 1) * 18 - v_freeze_last_holes;

  IF NEW.holes_completed < v_threshold THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.event_player_freeze_snapshots
    (event_id, profile_id, gross_score, net_score, to_par, format_points,
     holes_shown, actual_holes_completed, is_live, position)
  VALUES
    (NEW.event_id, NEW.profile_id,
     NEW.gross_score, NEW.net_score, NEW.to_par, NEW.format_points,
     v_threshold,
     NEW.holes_completed,
     NEW.is_live, NEW.position)
  ON CONFLICT (event_id, profile_id) DO NOTHING;

  RETURN NEW;
END;
$$;
