-- Fantasy Picks — atomic refresh-job claim.
-- One statement so concurrent viewers can't stampede the simulator: the first
-- request wins the row lock, everyone else gets NULL and serves cached odds.
-- p_ignore_debounce is the force path (cash-out pricing, admin refresh,
-- post-generation) — it may also create the job row when none was queued.

CREATE OR REPLACE FUNCTION public.ciaga_fantasy_claim_refresh_job(
  p_event_id uuid,
  p_ignore_debounce boolean,
  p_locked_by text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE fantasy_refresh_jobs
     SET status = 'running',
         locked_at = now(),
         locked_by = p_locked_by,
         attempts = attempts + 1,
         updated_at = now()
   WHERE event_id = p_event_id
     AND (
       (status = 'pending' AND (p_ignore_debounce OR debounce_until <= now()))
       OR (status = 'running' AND locked_at < now() - interval '90 seconds')
     )
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  IF p_ignore_debounce THEN
    BEGIN
      INSERT INTO fantasy_refresh_jobs
        (event_id, reason, status, debounce_until, attempts, locked_at, locked_by)
      VALUES
        (p_event_id, 'forced', 'running', now(), 1, now(), p_locked_by)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      v_id := NULL; -- another request holds the live job
    END;
    RETURN v_id;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.ciaga_fantasy_claim_refresh_job(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_claim_refresh_job(uuid, boolean, text) TO service_role;
