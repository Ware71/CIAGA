-- ============================================================
-- Fantasy V2 Phase D: accumulators ("Acca" in UI copy; internal name parlay).
--
--   fantasy_parlays / fantasy_parlay_legs — one stake, 2–8 legs, combined
--   odds = product of leg odds locked at placement.
--   ciaga_fantasy_place_parlay      — atomic balance + per-leg anti-sniping +
--                                     correlation guard (no two legs on the
--                                     same market, or the same subject within
--                                     one event).
--   ciaga_fantasy_settle_parlay_legs — idempotent leg resolution; a parlay
--                                     finalizes when no legs remain open:
--                                     any lost → lost; void legs drop to 1.0;
--                                     all void → stake refunded.
--
-- Conventions per the 2026-07 security audit: RLS via profiles.owner_user_id
-- indirection for reads, money ops service-role-only with explicit REVOKEs.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fantasy_parlays (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  profile_id            uuid NOT NULL REFERENCES public.profiles(id),
  stake                 numeric(12,2) NOT NULL CHECK (stake >= 1 AND stake = round(stake)),
  combined_decimal_odds numeric(12,2) NOT NULL CHECK (combined_decimal_odds >= 1.00),
  potential_return      numeric(14,2) NOT NULL,
  status                text NOT NULL DEFAULT 'open' CHECK (
                          status IN ('open', 'won', 'lost', 'void')
                        ),
  group_season_id       uuid REFERENCES public.group_seasons(id) ON DELETE SET NULL,
  -- Set only when every leg shares one event (required for event-scope budgets).
  event_id              uuid REFERENCES public.events(id) ON DELETE SET NULL,
  placed_at             timestamptz NOT NULL DEFAULT now(),
  settled_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fantasy_parlays_profile ON public.fantasy_parlays(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_fantasy_parlays_group ON public.fantasy_parlays(group_id);

CREATE TABLE IF NOT EXISTS public.fantasy_parlay_legs (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parlay_id                  uuid NOT NULL REFERENCES public.fantasy_parlays(id) ON DELETE CASCADE,
  market_id                  uuid NOT NULL REFERENCES public.fantasy_markets(id) ON DELETE CASCADE,
  event_id                   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  selection_key              text NOT NULL,
  odds_snapshot_id           uuid REFERENCES public.fantasy_odds_snapshots(id) ON DELETE SET NULL,
  decimal_odds               numeric(8,2) NOT NULL CHECK (decimal_odds >= 1.00),
  event_version_at_placement bigint NOT NULL,
  -- Correlation identities (subject player / selected player / 'field:<kind>')
  -- computed by the registry app-side; the RPC enforces uniqueness per event.
  subject_keys               text[] NOT NULL DEFAULT '{}',
  status                     text NOT NULL DEFAULT 'open' CHECK (
                               status IN ('open', 'won', 'lost', 'void')
                             ),
  settled_at                 timestamptz,
  UNIQUE (parlay_id, market_id)
);

CREATE INDEX IF NOT EXISTS idx_fantasy_parlay_legs_parlay ON public.fantasy_parlay_legs(parlay_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_parlay_legs_event ON public.fantasy_parlay_legs(event_id, status);
CREATE INDEX IF NOT EXISTS idx_fantasy_parlay_legs_market ON public.fantasy_parlay_legs(market_id);

ALTER TABLE public.fantasy_parlays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fantasy_parlay_legs ENABLE ROW LEVEL SECURITY;

-- Group-visible like picks (transparency in a friends game).
CREATE POLICY "fantasy_parlays_select" ON public.fantasy_parlays
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.major_group_memberships m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = fantasy_parlays.group_id
        AND m.status = 'active'
        AND p.owner_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

CREATE POLICY "fantasy_parlay_legs_select" ON public.fantasy_parlay_legs
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.fantasy_parlays fp
      JOIN public.major_group_memberships m ON m.group_id = fp.group_id AND m.status = 'active'
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE fp.id = fantasy_parlay_legs.parlay_id
        AND p.owner_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

GRANT SELECT ON public.fantasy_parlays TO authenticated;
GRANT SELECT ON public.fantasy_parlay_legs TO authenticated;
GRANT ALL ON public.fantasy_parlays TO service_role;
GRANT ALL ON public.fantasy_parlay_legs TO service_role;

-- Ledger rows can reference their parlay (stake/payout/void_refund).
ALTER TABLE public.fantasy_wallet_transactions
  ADD COLUMN IF NOT EXISTS parlay_id uuid REFERENCES public.fantasy_parlays(id) ON DELETE SET NULL;

-- ─── Place parlay ─────────────────────────────────────────────────────────────
-- p_legs: [{"market_id": "...", "selection_key": "...", "snapshot_id": "...",
--           "subject_keys": ["..."]}]
-- Same advisory-lock + balance pattern as ciaga_fantasy_place_pick; each leg
-- re-validates market open, snapshot active, and event version (anti-sniping
-- per event). Correlation guard: distinct markets AND distinct
-- (event, subject_key) pairs. Cross-group legs are rejected.
CREATE FUNCTION public.ciaga_fantasy_place_parlay(
  p_profile_id uuid,
  p_group_id uuid,
  p_stake numeric,
  p_legs jsonb,
  p_group_season_id uuid,
  p_scope_event boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  leg jsonb;
  v_market record;
  v_snapshot record;
  v_version bigint;
  v_leg_count integer;
  v_combined numeric := 1;
  v_balance numeric;
  v_parlay_id uuid;
  v_scope_key text;
  v_single_event uuid;
  v_events uuid[] := '{}';
  v_market_ids uuid[] := '{}';
  v_subject_pairs text[] := '{}';
  v_key text;
BEGIN
  IF p_stake IS NULL OR p_stake < 1 OR p_stake <> round(p_stake) THEN
    RAISE EXCEPTION 'Stake must be a whole number of points (min 1)';
  END IF;

  v_leg_count := jsonb_array_length(p_legs);
  IF v_leg_count IS NULL OR v_leg_count < 2 OR v_leg_count > 8 THEN
    RAISE EXCEPTION 'An acca needs between 2 and 8 legs';
  END IF;

  -- Validate every leg before writing anything.
  FOR leg IN SELECT * FROM jsonb_array_elements(p_legs)
  LOOP
    SELECT id, event_id, group_id, status
      INTO v_market
      FROM fantasy_markets
     WHERE id = (leg->>'market_id')::uuid;
    IF v_market.id IS NULL THEN
      RAISE EXCEPTION 'Market not found';
    END IF;
    IF v_market.group_id <> p_group_id THEN
      RAISE EXCEPTION 'All legs must come from the same group';
    END IF;
    IF v_market.status <> 'open' THEN
      RAISE EXCEPTION 'A market in this acca is no longer open';
    END IF;

    IF v_market.id = ANY(v_market_ids) THEN
      RAISE EXCEPTION 'Duplicate legs on the same market are not allowed';
    END IF;
    v_market_ids := v_market_ids || v_market.id;
    v_events := v_events || v_market.event_id;

    -- Correlation guard: one leg per subject per event.
    FOR v_key IN SELECT jsonb_array_elements_text(COALESCE(leg->'subject_keys', '[]'::jsonb))
    LOOP
      IF (v_market.event_id::text || '|' || v_key) = ANY(v_subject_pairs) THEN
        RAISE EXCEPTION 'Correlated legs — only one pick per player per event in an acca';
      END IF;
      v_subject_pairs := v_subject_pairs || (v_market.event_id::text || '|' || v_key);
    END LOOP;

    SELECT id, decimal_odds, event_version, status, selection_key, market_id
      INTO v_snapshot
      FROM fantasy_odds_snapshots
     WHERE id = (leg->>'snapshot_id')::uuid;
    IF v_snapshot.id IS NULL
       OR v_snapshot.market_id <> v_market.id
       OR v_snapshot.selection_key <> (leg->>'selection_key')
       OR v_snapshot.status <> 'active' THEN
      RAISE EXCEPTION 'Odds are no longer available — refresh and try again';
    END IF;

    SELECT version INTO v_version
      FROM fantasy_event_state
     WHERE event_id = v_market.event_id;
    IF v_version IS NULL OR v_version <> v_snapshot.event_version THEN
      RAISE EXCEPTION 'Odds are stale — refresh and try again';
    END IF;

    v_combined := v_combined * v_snapshot.decimal_odds;
  END LOOP;

  -- Event-scope budgets can only fund single-event accas.
  SELECT CASE WHEN COUNT(DISTINCT e) = 1 THEN MIN(e::text)::uuid ELSE NULL END
    INTO v_single_event
    FROM unnest(v_events) AS e;
  IF p_scope_event AND v_single_event IS NULL THEN
    RAISE EXCEPTION 'This group budgets per event — acca legs must all be from one event';
  END IF;

  v_scope_key := CASE
    WHEN p_scope_event THEN 'e:' || v_single_event::text
    WHEN p_group_season_id IS NOT NULL THEN 's:' || p_group_season_id::text
    ELSE 'g'
  END;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_group_id::text || '|' || p_profile_id::text || '|' || v_scope_key, 0)
  );

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM fantasy_wallet_transactions
   WHERE group_id = p_group_id
     AND profile_id = p_profile_id
     AND (
       (p_scope_event AND event_id = v_single_event)
       OR (NOT p_scope_event AND p_group_season_id IS NOT NULL AND group_season_id = p_group_season_id)
       OR (NOT p_scope_event AND p_group_season_id IS NULL)
     );
  IF v_balance < p_stake THEN
    RAISE EXCEPTION 'Insufficient points balance';
  END IF;

  INSERT INTO fantasy_parlays (
    group_id, profile_id, stake, combined_decimal_odds, potential_return,
    group_season_id, event_id
  ) VALUES (
    p_group_id, p_profile_id, p_stake, round(v_combined, 2),
    round(p_stake * v_combined, 2), p_group_season_id,
    v_single_event  -- set whenever all legs share one event; required for event scope
  )
  RETURNING id INTO v_parlay_id;

  FOR leg IN SELECT * FROM jsonb_array_elements(p_legs)
  LOOP
    INSERT INTO fantasy_parlay_legs (
      parlay_id, market_id, event_id, selection_key, odds_snapshot_id,
      decimal_odds, event_version_at_placement, subject_keys
    )
    SELECT
      v_parlay_id, m.id, m.event_id, leg->>'selection_key', s.id,
      s.decimal_odds, s.event_version,
      COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(COALESCE(leg->'subject_keys', '[]'::jsonb)) AS x),
        '{}'
      )
    FROM fantasy_markets m, fantasy_odds_snapshots s
    WHERE m.id = (leg->>'market_id')::uuid
      AND s.id = (leg->>'snapshot_id')::uuid;
  END LOOP;

  INSERT INTO fantasy_wallet_transactions (
    group_id, profile_id, group_season_id, event_id, parlay_id, type, amount, note
  ) VALUES (
    p_group_id, p_profile_id, p_group_season_id,
    CASE WHEN p_scope_event THEN v_single_event ELSE NULL END,
    v_parlay_id, 'stake', -p_stake, 'Acca stake'
  );

  RETURN v_parlay_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ciaga_fantasy_place_parlay(uuid, uuid, numeric, jsonb, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_place_parlay(uuid, uuid, numeric, jsonb, uuid, boolean) TO service_role;

-- ─── Settle parlay legs ───────────────────────────────────────────────────────
-- p_leg_outcomes: [{"leg_id": "...", "outcome": "won"|"lost"|"void"}]
-- Idempotent: only 'open' legs transition; a parlay finalizes once no legs
-- remain open. Void legs drop out (odds 1.0); all-void refunds the stake.
CREATE FUNCTION public.ciaga_fantasy_settle_parlay_legs(
  p_leg_outcomes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec record;
  v_parlay record;
  v_parlay_ids uuid[] := '{}';
  v_pid uuid;
  v_open integer;
  v_lost integer;
  v_won_odds numeric;
  v_won_legs integer;
  v_payout numeric;
  v_finalized integer := 0;
  v_finalized_ids uuid[] := '{}';
BEGIN
  FOR rec IN
    SELECT (o->>'leg_id')::uuid AS leg_id, o->>'outcome' AS outcome
    FROM jsonb_array_elements(p_leg_outcomes) AS o
  LOOP
    IF rec.outcome NOT IN ('won', 'lost', 'void') THEN
      CONTINUE;
    END IF;
    UPDATE fantasy_parlay_legs
       SET status = rec.outcome, settled_at = now()
     WHERE id = rec.leg_id AND status = 'open'
    RETURNING parlay_id INTO v_pid;
    IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_parlay_ids)) THEN
      v_parlay_ids := v_parlay_ids || v_pid;
    END IF;
  END LOOP;

  FOREACH v_pid IN ARRAY v_parlay_ids
  LOOP
    SELECT id, group_id, profile_id, group_season_id, event_id, stake, status
      INTO v_parlay
      FROM fantasy_parlays
     WHERE id = v_pid
       FOR UPDATE;
    IF v_parlay.id IS NULL OR v_parlay.status <> 'open' THEN
      CONTINUE;
    END IF;

    SELECT
      COUNT(*) FILTER (WHERE status = 'open'),
      COUNT(*) FILTER (WHERE status = 'lost'),
      COUNT(*) FILTER (WHERE status = 'won'),
      COALESCE(EXP(SUM(LN(decimal_odds)) FILTER (WHERE status = 'won')), 1)
      INTO v_open, v_lost, v_won_legs, v_won_odds
      FROM fantasy_parlay_legs
     WHERE parlay_id = v_pid;

    IF v_open > 0 THEN
      CONTINUE; -- still running
    END IF;

    v_finalized := v_finalized + 1;
    v_finalized_ids := v_finalized_ids || v_pid;

    IF v_lost > 0 THEN
      UPDATE fantasy_parlays
         SET status = 'lost', settled_at = now()
       WHERE id = v_pid;
    ELSIF v_won_legs = 0 THEN
      -- Every leg void → refund the stake.
      UPDATE fantasy_parlays
         SET status = 'void', settled_at = now()
       WHERE id = v_pid;
      INSERT INTO fantasy_wallet_transactions (
        group_id, profile_id, group_season_id, event_id, parlay_id, type, amount, note
      ) VALUES (
        v_parlay.group_id, v_parlay.profile_id, v_parlay.group_season_id, v_parlay.event_id,
        v_pid, 'void_refund', v_parlay.stake, 'Acca voided — stake returned'
      );
    ELSE
      v_payout := round(v_parlay.stake * v_won_odds, 2);
      UPDATE fantasy_parlays
         SET status = 'won', settled_at = now(),
             potential_return = v_payout
       WHERE id = v_pid;
      INSERT INTO fantasy_wallet_transactions (
        group_id, profile_id, group_season_id, event_id, parlay_id, type, amount, note
      ) VALUES (
        v_parlay.group_id, v_parlay.profile_id, v_parlay.group_season_id, v_parlay.event_id,
        v_pid, 'payout', v_payout, 'Acca won'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'finalized', v_finalized,
    'parlay_ids', to_jsonb(v_finalized_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ciaga_fantasy_settle_parlay_legs(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_settle_parlay_legs(jsonb) TO service_role;
