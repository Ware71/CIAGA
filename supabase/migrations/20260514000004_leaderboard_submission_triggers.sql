-- ============================================================
-- Add missing competition leaderboard recompute triggers:
--   1. When a round submission is accepted → recompute leaderboard
--   2. When a round status changes to 'finished' → recompute leaderboard
-- Both triggers cascade through ciaga_compute_competition_leaderboard
-- which already cascades to season standings when appropriate.
-- ============================================================

-- ── Trigger: recompute on submission accepted ─────────────────
CREATE OR REPLACE FUNCTION public.ciaga_on_submission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only act when accepted flips to true
  IF NEW.accepted = true AND (OLD IS NULL OR OLD.accepted IS DISTINCT FROM true) THEN
    PERFORM ciaga_compute_competition_leaderboard(NEW.competition_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_submission_accepted_recompute ON public.competition_round_submissions;
CREATE TRIGGER trg_submission_accepted_recompute
  AFTER INSERT OR UPDATE ON public.competition_round_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_on_submission_change();

-- ── Trigger: recompute when round finishes ───────────────────
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
     AND NEW.competition_tee_time_id IS NOT NULL
  THEN
    SELECT competition_id INTO v_competition_id
    FROM competition_tee_times
    WHERE id = NEW.competition_tee_time_id;

    IF v_competition_id IS NOT NULL THEN
      PERFORM ciaga_compute_competition_leaderboard(v_competition_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_round_finished_recompute ON public.rounds;
CREATE TRIGGER trg_round_finished_recompute
  AFTER UPDATE ON public.rounds
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_on_round_finished();
