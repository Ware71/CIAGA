-- ============================================================
-- Multi-round: give every submission a round identity.
--
-- event_round_submissions.event_round_id has been nullable since it was
-- introduced, and the manual submit-round route never populated it. No scoring
-- function reads it, so the frozen leaderboard and countback both fall back to
-- ordering by submitted_at — which a backfill or an admin re-accept can put out
-- of order, mislabelling R1/R2 and mis-clipping the frozen hole ranges.
--
-- This backfills it from the authoritative source (the tee time), so the
-- follow-up migration can order by round_number instead.
-- ============================================================

-- ── 1. From the tee time, which carries event_round_id ────────
UPDATE public.event_round_submissions ers
SET event_round_id = ett.event_round_id
FROM public.event_tee_times ett
WHERE ers.event_round_id IS NULL
  AND ett.round_id = ers.round_id
  AND ett.event_id = ers.event_id
  AND ett.event_round_id IS NOT NULL;

-- ── 2. Single-round events: the sole round is unambiguous ─────
-- Deliberately scoped to events with exactly one non-cancelled round. For a
-- multi-round event a guess would stamp round 2's card as round 1, which is
-- worse than leaving it NULL (the ordering falls back to submitted_at).
UPDATE public.event_round_submissions ers
SET event_round_id = sole.id
FROM (
  SELECT er.event_id, MIN(er.id::text)::uuid AS id
  FROM public.event_rounds er
  WHERE er.status <> 'cancelled'
  GROUP BY er.event_id
  HAVING COUNT(*) = 1
) sole
WHERE ers.event_round_id IS NULL
  AND sole.event_id = ers.event_id;

-- ── 3. Report what could not be resolved ──────────────────────
DO $$
DECLARE
  v_remaining integer;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM public.event_round_submissions
  WHERE event_round_id IS NULL;

  IF v_remaining > 0 THEN
    RAISE NOTICE
      'event_round_submissions: % row(s) still have a NULL event_round_id (multi-round events whose tee time never recorded the round). These fall back to submitted_at ordering.',
      v_remaining;
  END IF;
END $$;

-- Ordering by round_number needs this join to be cheap.
CREATE INDEX IF NOT EXISTS idx_ers_event_round
  ON public.event_round_submissions(event_id, event_round_id);
