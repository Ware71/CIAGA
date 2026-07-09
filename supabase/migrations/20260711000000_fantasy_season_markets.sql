-- ============================================================
-- Fantasy Picks V3 — Season markets (bet on the season standings).
--
-- Parallel to the per-event tables (kept separate so the hot event path is
-- untouched, and because a season pick has no event_id):
--   fantasy_season_state          — versioning/staleness per group_season
--   fantasy_season_markets        — season_outright / season_top_n
--   fantasy_season_odds_snapshots — priced selections per season version
--   fantasy_season_picks          — season-scoped picks (no event_id)
--
-- Pricing simulates the REMAINING events (reusing their joint matrices) onto
-- the current standings; settlement resolves against the final standings when
-- the season closes. Season picks draw from the season wallet, so this is only
-- offered for season-budget groups. RLS + service-role conventions mirror the
-- event side (2026-07 security audit).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fantasy_season_state (
  group_season_id  uuid PRIMARY KEY REFERENCES public.group_seasons(id) ON DELETE CASCADE,
  group_id         uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  version          bigint NOT NULL DEFAULT 1,
  odds_stale       boolean NOT NULL DEFAULT true,
  is_final         boolean NOT NULL DEFAULT false,
  changed_reason   text,
  narrative        text,
  last_refreshed_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fantasy_season_markets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  group_season_id  uuid NOT NULL REFERENCES public.group_seasons(id) ON DELETE CASCADE,
  market_type      text NOT NULL CHECK (market_type IN ('season_outright', 'season_top_n')),
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'suspended', 'settled')),
  settled_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fantasy_season_markets_shape
  ON public.fantasy_season_markets(group_season_id, market_type, params);

CREATE TABLE IF NOT EXISTS public.fantasy_season_odds_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_market_id uuid NOT NULL REFERENCES public.fantasy_season_markets(id) ON DELETE CASCADE,
  group_season_id  uuid NOT NULL REFERENCES public.group_seasons(id) ON DELETE CASCADE,
  group_id         uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  selection_key    text NOT NULL,
  season_version   bigint NOT NULL,
  probability      numeric(8,6) NOT NULL,
  decimal_odds     numeric(8,2) NOT NULL,
  simulation_count integer NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_market_id, selection_key, season_version)
);
CREATE INDEX IF NOT EXISTS idx_fantasy_season_snapshots_active
  ON public.fantasy_season_odds_snapshots(season_market_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.fantasy_season_picks (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_market_id            uuid NOT NULL REFERENCES public.fantasy_season_markets(id) ON DELETE CASCADE,
  group_season_id             uuid NOT NULL REFERENCES public.group_seasons(id) ON DELETE CASCADE,
  group_id                    uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  profile_id                  uuid NOT NULL REFERENCES public.profiles(id),
  selection_key               text NOT NULL,
  stake                       numeric(12,2) NOT NULL CHECK (stake >= 1 AND stake = round(stake)),
  decimal_odds                numeric(8,2) NOT NULL CHECK (decimal_odds >= 1.00),
  potential_return            numeric(12,2) NOT NULL,
  odds_snapshot_id            uuid REFERENCES public.fantasy_season_odds_snapshots(id) ON DELETE SET NULL,
  season_version_at_placement bigint NOT NULL,
  status                      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'void')),
  placed_at                   timestamptz NOT NULL DEFAULT now(),
  settled_at                  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_fantasy_season_picks_profile ON public.fantasy_season_picks(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_fantasy_season_picks_season ON public.fantasy_season_picks(group_season_id);

-- Ledger rows can reference their season pick (stake/payout/void_refund).
ALTER TABLE public.fantasy_wallet_transactions
  ADD COLUMN IF NOT EXISTS season_pick_id uuid REFERENCES public.fantasy_season_picks(id) ON DELETE SET NULL;

-- ─── RLS: group-visible reads, service-role writes ──────────────────────────
ALTER TABLE public.fantasy_season_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fantasy_season_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fantasy_season_odds_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fantasy_season_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fantasy_season_state_select" ON public.fantasy_season_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.major_group_memberships m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = fantasy_season_state.group_id AND m.status = 'active' AND p.owner_user_id = auth.uid()
    ) OR auth.role() = 'service_role'
  );
CREATE POLICY "fantasy_season_markets_select" ON public.fantasy_season_markets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.major_group_memberships m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = fantasy_season_markets.group_id AND m.status = 'active' AND p.owner_user_id = auth.uid()
    ) OR auth.role() = 'service_role'
  );
CREATE POLICY "fantasy_season_snapshots_select" ON public.fantasy_season_odds_snapshots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.major_group_memberships m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = fantasy_season_odds_snapshots.group_id AND m.status = 'active' AND p.owner_user_id = auth.uid()
    ) OR auth.role() = 'service_role'
  );
CREATE POLICY "fantasy_season_picks_select" ON public.fantasy_season_picks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.major_group_memberships m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = fantasy_season_picks.group_id AND m.status = 'active' AND p.owner_user_id = auth.uid()
    ) OR auth.role() = 'service_role'
  );

GRANT SELECT ON public.fantasy_season_state TO authenticated;
GRANT SELECT ON public.fantasy_season_markets TO authenticated;
GRANT SELECT ON public.fantasy_season_odds_snapshots TO authenticated;
GRANT SELECT ON public.fantasy_season_picks TO authenticated;
GRANT ALL ON public.fantasy_season_state TO service_role;
GRANT ALL ON public.fantasy_season_markets TO service_role;
GRANT ALL ON public.fantasy_season_odds_snapshots TO service_role;
GRANT ALL ON public.fantasy_season_picks TO service_role;

-- Realtime: clients subscribe to season odds refreshes (mirror event state).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'fantasy_season_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fantasy_season_state;
  END IF;
END;
$$;

-- ─── Mark a season stale (clock/constituent-event nudge) ────────────────────
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_mark_season_stale(p_group_season_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE fantasy_season_state
     SET version = version + 1,
         odds_stale = true,
         changed_reason = p_reason,
         updated_at = now()
   WHERE group_season_id = p_group_season_id
     AND is_final = false;
END;
$$;
REVOKE ALL ON FUNCTION public.ciaga_fantasy_mark_season_stale(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_mark_season_stale(uuid, text) TO service_role;

-- ─── Place a season pick (season wallet, anti-snipe on season version) ──────
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_place_season_pick(
  p_profile_id uuid,
  p_season_market_id uuid,
  p_selection_key text,
  p_stake numeric,
  p_snapshot_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_market record;
  v_snapshot record;
  v_version bigint;
  v_balance numeric;
  v_pick_id uuid;
BEGIN
  IF p_stake IS NULL OR p_stake < 1 OR p_stake <> round(p_stake) THEN
    RAISE EXCEPTION 'Stake must be a whole number of points (min 1)';
  END IF;

  SELECT id, group_id, group_season_id, status
    INTO v_market FROM fantasy_season_markets WHERE id = p_season_market_id;
  IF v_market.id IS NULL THEN RAISE EXCEPTION 'Market not found'; END IF;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Market is not open'; END IF;

  SELECT id, decimal_odds, season_version, status, selection_key, season_market_id
    INTO v_snapshot FROM fantasy_season_odds_snapshots WHERE id = p_snapshot_id;
  IF v_snapshot.id IS NULL
     OR v_snapshot.season_market_id <> p_season_market_id
     OR v_snapshot.selection_key <> p_selection_key
     OR v_snapshot.status <> 'active' THEN
    RAISE EXCEPTION 'Odds are no longer available — refresh and try again';
  END IF;

  SELECT version INTO v_version FROM fantasy_season_state WHERE group_season_id = v_market.group_season_id;
  IF v_version IS NULL OR v_version <> v_snapshot.season_version THEN
    RAISE EXCEPTION 'Odds are stale — refresh and try again';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_market.group_id::text || '|' || p_profile_id::text || '|s:' || v_market.group_season_id::text, 0)
  );

  -- Season wallet: all rows scoped to this season pool.
  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM fantasy_wallet_transactions
   WHERE group_id = v_market.group_id
     AND profile_id = p_profile_id
     AND group_season_id = v_market.group_season_id;
  IF v_balance < p_stake THEN RAISE EXCEPTION 'Insufficient points balance'; END IF;

  INSERT INTO fantasy_season_picks (
    season_market_id, group_season_id, group_id, profile_id, selection_key,
    stake, decimal_odds, potential_return, odds_snapshot_id, season_version_at_placement
  ) VALUES (
    p_season_market_id, v_market.group_season_id, v_market.group_id, p_profile_id, p_selection_key,
    p_stake, v_snapshot.decimal_odds, round(p_stake * v_snapshot.decimal_odds, 2), p_snapshot_id, v_snapshot.season_version
  )
  RETURNING id INTO v_pick_id;

  INSERT INTO fantasy_wallet_transactions (
    group_id, profile_id, group_season_id, season_pick_id, type, amount, note
  ) VALUES (
    v_market.group_id, p_profile_id, v_market.group_season_id, v_pick_id, 'stake', -p_stake, 'Season pick stake'
  );

  RETURN v_pick_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ciaga_fantasy_place_season_pick(uuid, uuid, text, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_place_season_pick(uuid, uuid, text, numeric, uuid) TO service_role;

-- ─── Apply season settlement (against final standings) ──────────────────────
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_apply_season_settlement(
  p_group_season_id uuid,
  p_outcomes jsonb,
  p_market_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec record;
  v_pick record;
  v_won integer := 0;
  v_lost integer := 0;
  v_void integer := 0;
BEGIN
  FOR rec IN
    SELECT (o->>'pick_id')::uuid AS pick_id, o->>'outcome' AS outcome
    FROM jsonb_array_elements(p_outcomes) AS o
  LOOP
    IF rec.outcome NOT IN ('won', 'lost', 'void') THEN CONTINUE; END IF;

    UPDATE fantasy_season_picks
       SET status = rec.outcome, settled_at = now()
     WHERE id = rec.pick_id AND group_season_id = p_group_season_id AND status = 'open'
    RETURNING id, group_id, profile_id, group_season_id, stake, potential_return INTO v_pick;
    IF v_pick.id IS NULL THEN CONTINUE; END IF;

    IF rec.outcome = 'won' THEN
      v_won := v_won + 1;
      INSERT INTO fantasy_wallet_transactions (group_id, profile_id, group_season_id, season_pick_id, type, amount, note)
      VALUES (v_pick.group_id, v_pick.profile_id, v_pick.group_season_id, v_pick.id, 'payout', v_pick.potential_return, 'Season pick won');
    ELSIF rec.outcome = 'void' THEN
      v_void := v_void + 1;
      INSERT INTO fantasy_wallet_transactions (group_id, profile_id, group_season_id, season_pick_id, type, amount, note)
      VALUES (v_pick.group_id, v_pick.profile_id, v_pick.group_season_id, v_pick.id, 'void_refund', v_pick.stake, 'Season pick voided — stake returned');
    ELSE
      v_lost := v_lost + 1;
    END IF;
  END LOOP;

  UPDATE fantasy_season_markets
     SET status = 'settled', settled_at = now(), updated_at = now()
   WHERE group_season_id = p_group_season_id AND id = ANY(p_market_ids) AND status IN ('open', 'suspended');

  UPDATE fantasy_season_state
     SET is_final = true, odds_stale = false, changed_reason = 'settled', updated_at = now()
   WHERE group_season_id = p_group_season_id;

  RETURN jsonb_build_object('won', v_won, 'lost', v_lost, 'void', v_void);
END;
$$;
REVOKE ALL ON FUNCTION public.ciaga_fantasy_apply_season_settlement(uuid, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_apply_season_settlement(uuid, jsonb, uuid[]) TO service_role;
