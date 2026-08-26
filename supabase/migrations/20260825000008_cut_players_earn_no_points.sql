-- ============================================================
-- A player who missed the cut earns no season points.
--
-- event_leaderboard_entries is re-inserted wholesale by
-- ciaga_compute_event_leaderboard, so anything written after the fact is wiped
-- on the next recompute — the same trap that made playoff_final_position
-- unreliable (see eventLeaderboardPayload.applyCompletedPlayoff).
--
-- A BEFORE trigger therefore beats a post-hoc UPDATE: it re-applies itself on
-- every recompute, and needs no rewrite of the (very large) leaderboard
-- function. Season standings SUM(points_earned), so nulling it here is enough
-- to keep cut players out of the order of merit.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ciaga_null_points_for_cut_players()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.points_earned IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_entries ee
    WHERE ee.event_id = NEW.event_id
      AND ee.profile_id = NEW.profile_id
      AND ee.cut_status = 'missed'
  ) THEN
    NEW.points_earned := NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ciaga_null_points_for_cut_players() IS
  'Strips season points from players who missed the cut, on every write to
   event_leaderboard_entries so a recompute cannot restore them.';

DROP TRIGGER IF EXISTS trg_null_points_for_cut_players ON public.event_leaderboard_entries;

CREATE TRIGGER trg_null_points_for_cut_players
  BEFORE INSERT OR UPDATE ON public.event_leaderboard_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_null_points_for_cut_players();

-- Applying a cut to an event that has already been scored needs the standings
-- rebuilt, so re-run the leaderboard for any event that has cut results.
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT DISTINCT ee.event_id
    FROM public.event_entries ee
    WHERE ee.cut_status = 'missed'
  LOOP
    PERFORM public.ciaga_compute_event_leaderboard(v_id);
  END LOOP;
END $$;
