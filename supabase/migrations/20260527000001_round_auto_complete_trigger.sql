-- Migration: round auto-complete via trigger + deadline column
--
-- Instead of computing eligibility at cron-time (expensive scan of all live
-- rounds), each round maintains its own deadline in auto_complete_at.
--
-- Three triggers keep it current:
--   1. round_score_events INSERT   — a score was entered
--   2. round_hole_states  INSERT/UPDATE — a hole was marked completed/picked_up
--   3. rounds UPDATE (→ live)      — round just started; sets initial 24h deadline
--
-- The cron query becomes a trivial indexed lookup:
--   SELECT id, created_by FROM rounds
--   WHERE status = 'live' AND auto_complete_at <= now()


-- ─── 1. Column ─────────────────────────────────────────────────────────────

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS auto_complete_at timestamptz;

-- Partial index: only live rounds matter for the cron query
CREATE INDEX IF NOT EXISTS idx_rounds_auto_complete_at
  ON public.rounds (auto_complete_at)
  WHERE status = 'live';


-- ─── 2. Trigger function ────────────────────────────────────────────────────
--
-- Recomputes auto_complete_at for the affected round.
-- Called from all three triggers; TG_TABLE_NAME distinguishes the caller.
--
-- auto_complete_at = NOW() + threshold_hours
--   (activity just happened, so the clock resets from now)
--
-- threshold_hours = 1 + (1 − completion_ratio) × 23
--   100% done → 1 h,  0% done → 24 h

CREATE OR REPLACE FUNCTION public.ciaga_set_round_auto_complete_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_round_id          uuid;
  v_number_of_holes   integer;
  v_participant_count numeric;
  v_completed_count   numeric;
  v_completion_ratio  numeric;
  v_threshold_hours   numeric;
BEGIN
  -- ── Identify the round ──────────────────────────────────────────────────
  IF TG_TABLE_NAME = 'rounds' THEN
    -- Only care about transitions into 'live'
    IF NEW.status <> 'live' THEN
      RETURN NEW;
    END IF;
    v_round_id := NEW.id;
  ELSE
    v_round_id := NEW.round_id;
  END IF;

  -- ── Guard: only update live rounds ──────────────────────────────────────
  SELECT number_of_holes
  INTO   v_number_of_holes
  FROM   public.rounds
  WHERE  id = v_round_id
    AND  status = 'live';

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- ── Compute completion ratio ─────────────────────────────────────────────
  SELECT COUNT(*)::numeric
  INTO   v_participant_count
  FROM   public.round_participants
  WHERE  round_id = v_round_id;

  SELECT COUNT(*)::numeric
  INTO   v_completed_count
  FROM   public.round_hole_states
  WHERE  round_id = v_round_id
    AND  status IN ('completed', 'picked_up');

  IF v_participant_count = 0 OR COALESCE(v_number_of_holes, 0) = 0 THEN
    v_completion_ratio := 0;
  ELSE
    v_completion_ratio := LEAST(
      v_completed_count / (v_number_of_holes::numeric * v_participant_count),
      1.0
    );
  END IF;

  v_threshold_hours := 1.0 + (1.0 - v_completion_ratio) * 23.0;

  -- ── Set deadline ─────────────────────────────────────────────────────────
  UPDATE public.rounds
  SET    auto_complete_at = NOW() + (v_threshold_hours * INTERVAL '1 hour')
  WHERE  id = v_round_id;

  RETURN NEW;
END;
$$;


-- ─── 3. Triggers ────────────────────────────────────────────────────────────

-- Score entered
CREATE OR REPLACE TRIGGER trg_score_event_auto_complete
  AFTER INSERT ON public.round_score_events
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_set_round_auto_complete_at();

-- Hole marked completed or picked up (covers cases with no score event, e.g. pick-up)
CREATE OR REPLACE TRIGGER trg_hole_state_auto_complete
  AFTER INSERT OR UPDATE ON public.round_hole_states
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_set_round_auto_complete_at();

-- Round goes live → sets initial 24h deadline (0% complete at start).
-- WHEN clause prevents recursion: subsequent UPDATEs to auto_complete_at
-- leave status unchanged (live→live), so the condition is false and the
-- trigger does not re-fire.
CREATE OR REPLACE TRIGGER trg_round_live_auto_complete
  AFTER UPDATE ON public.rounds
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'live')
  EXECUTE FUNCTION public.ciaga_set_round_auto_complete_at();


-- ─── 4. Replace the complex cron query with a simple indexed lookup ─────────

-- Drop old signature first (return type changed — CREATE OR REPLACE cannot change it)
DROP FUNCTION IF EXISTS public.ciaga_get_rounds_for_auto_complete();

CREATE OR REPLACE FUNCTION public.ciaga_get_rounds_for_auto_complete()
RETURNS TABLE (
  round_id         uuid,
  owner_profile_id uuid
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id AS round_id, created_by AS owner_profile_id
  FROM   public.rounds
  WHERE  status = 'live'
    AND  auto_complete_at IS NOT NULL
    AND  auto_complete_at <= NOW();
$$;


-- ─── 5. Backfill any currently-live rounds ───────────────────────────────────
-- They pre-date the trigger so have no auto_complete_at yet.
-- Give them a 24h window from started_at (safest default — 0% completion
-- assumed since we can't retroactively know their last activity precisely).

UPDATE public.rounds
SET    auto_complete_at = COALESCE(started_at, created_at) + INTERVAL '24 hours'
WHERE  status = 'live'
  AND  auto_complete_at IS NULL;
