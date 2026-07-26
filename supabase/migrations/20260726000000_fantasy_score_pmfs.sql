-- Fantasy Picks V5.1 — persist each refresh's exact per-score distribution
-- (gross + net) per player, so cash-out and settlement of score_band /
-- score_total picks can price a pick's OWN band/value ("cumulative of the exact
-- scores") from the current book — independent of the drifting offered set.
--
-- One row per (event, player, basis), overwritten each refresh. pmf_probs[i] =
-- P(total = pmf_min + i). Service-role only (written by the refresh job, read by
-- the cash-out path via supabaseAdmin); clients never read it directly.

CREATE TABLE IF NOT EXISTS public.fantasy_score_pmfs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  basis         text NOT NULL CHECK (basis IN ('gross', 'net')),
  pmf_min       integer NOT NULL,
  pmf_probs     jsonb NOT NULL,
  event_version bigint NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fantasy_score_pmfs
  ON public.fantasy_score_pmfs (event_id, profile_id, basis);

ALTER TABLE public.fantasy_score_pmfs ENABLE ROW LEVEL SECURITY;
-- RLS on with no policy ⇒ only service_role (which bypasses RLS) may access.
GRANT ALL ON public.fantasy_score_pmfs TO service_role;
