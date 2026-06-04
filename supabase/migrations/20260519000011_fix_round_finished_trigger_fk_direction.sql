-- ============================================================
-- Fix ciaga_on_round_finished to use the reliable FK direction.
--
-- Bug: the trigger used rounds.competition_tee_time_id (back-link)
-- to find the competition_id. This column is set without error
-- handling in the tee-times API and may be NULL, causing the
-- trigger to silently skip the leaderboard recompute when a
-- round finishes.
--
-- Fix: use competition_tee_times.round_id = NEW.id (reliable
-- direction, always set when a tee-time-linked round is created)
-- to find the competition.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ciaga_on_round_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_competition_id uuid;
BEGIN
  IF NEW.status = 'finished'
     AND (OLD.status IS DISTINCT FROM 'finished')
  THEN
    -- Use reliable FK direction: ctt.round_id → rounds.id
    SELECT ctt.competition_id INTO v_competition_id
    FROM competition_tee_times ctt
    WHERE ctt.round_id = NEW.id;

    IF v_competition_id IS NOT NULL THEN
      PERFORM ciaga_compute_competition_leaderboard(v_competition_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
