-- Fantasy Picks — Phase 2: profiles, markets, odds snapshots, refresh jobs,
-- stale-detection triggers.
--
-- Odds lifecycle:
--   * fantasy_event_state.version increments on every meaningful change
--     (ciaga_fantasy_mark_stale), snapshots are keyed to the version they
--     were simulated at, and a debounced refresh job coalesces bursts.
--   * There is no queue runner: the next viewer request past debounce_until
--     claims the job (single-statement UPDATE) and refreshes inline.
--   * If a change lands while a refresh is running, mark_stale flips the job
--     back to 'pending' and bumps the version; the running refresh finishes
--     but its "mark fresh" update is version-guarded, so odds stay stale and
--     the next request re-runs. No locks needed beyond the job claim.
--
-- Triggers are gated on fantasy_event_state row existence (= fantasy active
-- for the event) so casual rounds pay one indexed lookup at most.

-- ─── Player performance profiles ─────────────────────────────────────────────
-- Built from historical round_score_events × hole snapshots; consumed by the
-- Monte Carlo engine. hole_splits carries avg-vs-par + birdie/bogey rates
-- bucketed by (par type × length band) and stroke-index band — the foundation
-- for future hole-specific markets. overrides (admin) are merged at read time.
CREATE TABLE IF NOT EXISTS public.fantasy_player_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  profile_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  handicap_index          numeric,
  avg_gross               numeric,
  avg_net                 numeric,
  score_stddev            numeric,
  recent_form             numeric,
  birdies_per_round       numeric,
  pars_per_round          numeric,
  bogeys_per_round        numeric,
  doubles_plus_per_round  numeric,
  par3_avg_vs_par         numeric,
  par4_avg_vs_par         numeric,
  par5_avg_vs_par         numeric,
  hole_splits             jsonb,
  sample_size             integer NOT NULL DEFAULT 0,
  confidence              text NOT NULL DEFAULT 'low' CHECK (confidence IN ('low', 'medium', 'high')),
  overrides               jsonb,
  computed_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_fantasy_player_profiles_group
  ON public.fantasy_player_profiles(group_id);

-- ─── Markets ──────────────────────────────────────────────────────────────────
-- One row per (event, market_type, subject/params). The selection lives on the
-- pick (selection_key): outright/top_n pick a profile uuid; O/U pick
-- 'over'/'under'; birdies pick 'yes'; h2h pick 'a'/'b'.
CREATE TABLE IF NOT EXISTS public.fantasy_markets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  group_id            uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  market_type         text NOT NULL CHECK (
                        market_type IN ('outright_winner', 'top_n', 'gross_ou', 'net_ou', 'birdies', 'h2h')
                      ),
  subject_profile_id  uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  opponent_profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  params              jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'open' CHECK (
                        status IN ('open', 'suspended', 'settled', 'void')
                      ),
  settled_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fantasy_markets_event ON public.fantasy_markets(event_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_markets_group ON public.fantasy_markets(group_id);

-- Idempotent market generation: one market per shape.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fantasy_markets_shape
  ON public.fantasy_markets(
    event_id, market_type,
    COALESCE(subject_profile_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(opponent_profile_id, '00000000-0000-0000-0000-000000000000'::uuid),
    params
  );

-- ─── Odds snapshots ───────────────────────────────────────────────────────────
-- Probability clamped by the engine to [0.005, 0.995] → decimal odds ≤ 200.
CREATE TABLE IF NOT EXISTS public.fantasy_odds_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id        uuid NOT NULL REFERENCES public.fantasy_markets(id) ON DELETE CASCADE,
  event_id         uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  group_id         uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  selection_key    text NOT NULL,
  event_version    bigint NOT NULL,
  probability      numeric(8,6) NOT NULL CHECK (probability > 0 AND probability < 1),
  decimal_odds     numeric(8,2) NOT NULL CHECK (decimal_odds >= 1.00 AND decimal_odds <= 200.00),
  simulation_count integer NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (market_id, selection_key, event_version)
);

CREATE INDEX IF NOT EXISTS idx_fantasy_odds_market_active
  ON public.fantasy_odds_snapshots(market_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_fantasy_odds_event
  ON public.fantasy_odds_snapshots(event_id, event_version);

-- ─── Refresh jobs ─────────────────────────────────────────────────────────────
-- At most one live (pending/running) job per event; claimed atomically by the
-- next request past debounce_until. Wedged 'running' jobs are reclaimable
-- after 90s (claim query) and failed by the daily cron after 10 min.
CREATE TABLE IF NOT EXISTS public.fantasy_refresh_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (
                   status IN ('pending', 'running', 'done', 'failed')
                 ),
  debounce_until timestamptz NOT NULL DEFAULT now(),
  attempts       integer NOT NULL DEFAULT 0,
  locked_at      timestamptz,
  locked_by      text,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fantasy_refresh_jobs_live
  ON public.fantasy_refresh_jobs(event_id)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS idx_fantasy_refresh_jobs_due
  ON public.fantasy_refresh_jobs(debounce_until)
  WHERE status = 'pending';

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.fantasy_player_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fantasy_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fantasy_odds_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fantasy_refresh_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fantasy_player_profiles_select" ON public.fantasy_player_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.major_group_memberships m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = fantasy_player_profiles.group_id
        AND m.status = 'active'
        AND p.owner_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

CREATE POLICY "fantasy_markets_select" ON public.fantasy_markets
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.major_group_memberships m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = fantasy_markets.group_id
        AND m.status = 'active'
        AND p.owner_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

CREATE POLICY "fantasy_odds_snapshots_select" ON public.fantasy_odds_snapshots
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.major_group_memberships m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = fantasy_odds_snapshots.group_id
        AND m.status = 'active'
        AND p.owner_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

-- Refresh jobs are internal: no authenticated policy (deny), service_role only.

GRANT SELECT ON public.fantasy_player_profiles TO authenticated;
GRANT SELECT ON public.fantasy_markets TO authenticated;
GRANT SELECT ON public.fantasy_odds_snapshots TO authenticated;
GRANT ALL ON public.fantasy_player_profiles TO service_role;
GRANT ALL ON public.fantasy_markets TO service_role;
GRANT ALL ON public.fantasy_odds_snapshots TO service_role;
GRANT ALL ON public.fantasy_refresh_jobs TO service_role;

-- ─── Stale marking ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_mark_stale(p_event_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE fantasy_event_state
     SET version = version + 1,
         odds_stale = true,
         changed_reason = p_reason,
         updated_at = now()
   WHERE event_id = p_event_id
     AND NOT is_final;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN; -- fantasy not active for this event, or already settled
  END IF;

  INSERT INTO fantasy_refresh_jobs (event_id, reason, status, debounce_until)
  VALUES (p_event_id, p_reason, 'pending', now() + interval '60 seconds')
  ON CONFLICT (event_id) WHERE status IN ('pending', 'running')
  DO UPDATE SET
    debounce_until = excluded.debounce_until,
    reason = excluded.reason,
    -- If a refresh is mid-flight it finishes for a now-stale version; its
    -- version-guarded "mark fresh" no-ops and this pending job re-runs it.
    status = 'pending',
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.ciaga_fantasy_mark_stale(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_mark_stale(uuid, text) TO service_role;

-- ─── Trigger functions ────────────────────────────────────────────────────────

-- Score submitted/edited/deleted (round_score_events is append-only, so
-- INSERT covers all three). Casual rounds resolve no event and exit fast.
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_on_score_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  SELECT ett.event_id INTO v_event_id
  FROM rounds r
  JOIN event_tee_times ett ON ett.id = r.event_tee_time_id
  WHERE r.id = NEW.round_id;

  IF v_event_id IS NOT NULL THEN
    PERFORM ciaga_fantasy_mark_stale(v_event_id, 'score_submitted');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fantasy_score_event ON public.round_score_events;
CREATE TRIGGER trg_fantasy_score_event
  AFTER INSERT ON public.round_score_events
  FOR EACH ROW EXECUTE FUNCTION public.ciaga_fantasy_on_score_event();

-- Round completes.
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_on_round_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  SELECT ett.event_id INTO v_event_id
  FROM event_tee_times ett
  WHERE ett.id = NEW.event_tee_time_id;

  IF v_event_id IS NOT NULL THEN
    PERFORM ciaga_fantasy_mark_stale(v_event_id, 'round_complete');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fantasy_round_finished ON public.rounds;
CREATE TRIGGER trg_fantasy_round_finished
  AFTER UPDATE OF status ON public.rounds
  FOR EACH ROW
  WHEN (NEW.status = 'finished' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.event_tee_time_id IS NOT NULL)
  EXECUTE FUNCTION public.ciaga_fantasy_on_round_finished();

-- Submission lifecycle changes (accept/reject/supersede/withdraw/dq).
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_on_submission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM ciaga_fantasy_mark_stale(NEW.event_id, 'submission_change');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fantasy_submission_change ON public.event_round_submissions;
CREATE TRIGGER trg_fantasy_submission_change
  AFTER INSERT OR UPDATE OF submission_status ON public.event_round_submissions
  FOR EACH ROW EXECUTE FUNCTION public.ciaga_fantasy_on_submission_change();

-- Field changes: entries added/withdrawn/deleted or assigned handicaps edited.
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_on_entry_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM ciaga_fantasy_mark_stale(COALESCE(NEW.event_id, OLD.event_id), 'field_change');
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_fantasy_entry_change ON public.event_entries;
CREATE TRIGGER trg_fantasy_entry_change
  AFTER INSERT OR DELETE
    OR UPDATE OF entry_status, assigned_handicap_index, assigned_course_handicap, assigned_playing_handicap
  ON public.event_entries
  FOR EACH ROW EXECUTE FUNCTION public.ciaga_fantasy_on_entry_change();

-- Handicap index recalculated: stale every active fantasy event the player is
-- entered in. fantasy_event_state only holds active fantasy events, so this
-- scan is tiny.
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_on_handicap_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT fes.event_id
    FROM fantasy_event_state fes
    JOIN event_entries ee ON ee.event_id = fes.event_id AND ee.profile_id = NEW.profile_id
    WHERE NOT fes.is_final
  LOOP
    PERFORM ciaga_fantasy_mark_stale(rec.event_id, 'handicap_change');
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fantasy_handicap_change ON public.handicap_index_history;
CREATE TRIGGER trg_fantasy_handicap_change
  AFTER INSERT ON public.handicap_index_history
  FOR EACH ROW EXECUTE FUNCTION public.ciaga_fantasy_on_handicap_change();
