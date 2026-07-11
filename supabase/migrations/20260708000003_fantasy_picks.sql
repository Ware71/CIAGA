-- Fantasy Picks — Phase 3: picks + atomic money-critical RPCs.
--
--   fantasy_picks                    — placed picks, odds locked at placement
--   ciaga_fantasy_place_pick         — balance check + pick + stake, atomic
--   ciaga_fantasy_apply_settlement   — idempotent settlement application
--
-- Registry logic (which selection wins, placement eligibility, self-cashout
-- rules) runs in TypeScript; these functions enforce only the invariants that
-- must hold under concurrency: no overspending, no stale-odds sniping, no
-- double settlement.

CREATE TABLE IF NOT EXISTS public.fantasy_picks (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id                  uuid NOT NULL REFERENCES public.fantasy_markets(id) ON DELETE CASCADE,
  event_id                   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  group_id                   uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  profile_id                 uuid NOT NULL REFERENCES public.profiles(id),
  selection_key              text NOT NULL,
  stake                      numeric(12,2) NOT NULL CHECK (stake >= 1 AND stake = round(stake)),
  decimal_odds               numeric(8,2) NOT NULL CHECK (decimal_odds >= 1.00),
  potential_return           numeric(12,2) NOT NULL,
  odds_snapshot_id           uuid REFERENCES public.fantasy_odds_snapshots(id) ON DELETE SET NULL,
  event_version_at_placement bigint NOT NULL,
  pick_version               integer NOT NULL DEFAULT 1,
  status                     text NOT NULL DEFAULT 'open' CHECK (
                               status IN ('open', 'cashed_out', 'won', 'lost', 'void')
                             ),
  cashout_value              numeric(12,2),
  placed_at                  timestamptz NOT NULL DEFAULT now(),
  settled_at                 timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fantasy_picks_event ON public.fantasy_picks(event_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_picks_market ON public.fantasy_picks(market_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_picks_profile ON public.fantasy_picks(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_fantasy_picks_group ON public.fantasy_picks(group_id);

ALTER TABLE public.fantasy_picks ENABLE ROW LEVEL SECURITY;

-- Picks are group-visible by design (transparency in a friends game; the PnL
-- leaderboard needs them anyway).
CREATE POLICY "fantasy_picks_select" ON public.fantasy_picks
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.major_group_memberships m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = fantasy_picks.group_id
        AND m.status = 'active'
        AND p.owner_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

GRANT SELECT ON public.fantasy_picks TO authenticated;
GRANT ALL ON public.fantasy_picks TO service_role;

-- Ledger rows can now reference their pick.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fantasy_wallet_transactions_pick_id_fkey'
  ) THEN
    ALTER TABLE public.fantasy_wallet_transactions
      ADD CONSTRAINT fantasy_wallet_transactions_pick_id_fkey
      FOREIGN KEY (pick_id) REFERENCES public.fantasy_picks(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- ─── Place pick ───────────────────────────────────────────────────────────────
-- Atomicity: an advisory xact lock per (group, profile, wallet scope)
-- serializes concurrent placements so the balance check can't be raced.
-- Anti-sniping: the priced snapshot must still be active AND belong to the
-- CURRENT event version — a score submitted between viewing odds and
-- confirming the pick bumps the version and rejects the placement.
-- p_group_season_id: the scope season (NULL for event/lifetime-scoped wallets).
-- p_scope_event: true when the group budget is per-event.
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_place_pick(
  p_profile_id uuid,
  p_market_id uuid,
  p_selection_key text,
  p_stake numeric,
  p_snapshot_id uuid,
  p_group_season_id uuid,
  p_scope_event boolean
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
  v_scope_key text;
BEGIN
  IF p_stake IS NULL OR p_stake < 1 OR p_stake <> round(p_stake) THEN
    RAISE EXCEPTION 'Stake must be a whole number of points (min 1)';
  END IF;

  SELECT id, event_id, group_id, status
    INTO v_market
    FROM fantasy_markets
   WHERE id = p_market_id;
  IF v_market.id IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status <> 'open' THEN
    RAISE EXCEPTION 'Market is not open';
  END IF;

  SELECT id, probability, decimal_odds, event_version, status, selection_key, market_id
    INTO v_snapshot
    FROM fantasy_odds_snapshots
   WHERE id = p_snapshot_id;
  IF v_snapshot.id IS NULL
     OR v_snapshot.market_id <> p_market_id
     OR v_snapshot.selection_key <> p_selection_key
     OR v_snapshot.status <> 'active' THEN
    RAISE EXCEPTION 'Odds are no longer available — refresh and try again';
  END IF;

  SELECT version INTO v_version
    FROM fantasy_event_state
   WHERE event_id = v_market.event_id;
  IF v_version IS NULL OR v_version <> v_snapshot.event_version THEN
    RAISE EXCEPTION 'Odds are stale — refresh and try again';
  END IF;

  v_scope_key := CASE
    WHEN p_scope_event THEN 'e:' || v_market.event_id::text
    WHEN p_group_season_id IS NOT NULL THEN 's:' || p_group_season_id::text
    ELSE 'g'
  END;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_market.group_id::text || '|' || p_profile_id::text || '|' || v_scope_key, 0)
  );

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM fantasy_wallet_transactions
   WHERE group_id = v_market.group_id
     AND profile_id = p_profile_id
     AND (
       (p_scope_event AND event_id = v_market.event_id)
       OR (NOT p_scope_event AND p_group_season_id IS NOT NULL AND group_season_id = p_group_season_id)
       OR (NOT p_scope_event AND p_group_season_id IS NULL)
     );
  IF v_balance < p_stake THEN
    RAISE EXCEPTION 'Insufficient points balance';
  END IF;

  INSERT INTO fantasy_picks (
    market_id, event_id, group_id, profile_id, selection_key,
    stake, decimal_odds, potential_return, odds_snapshot_id,
    event_version_at_placement
  ) VALUES (
    p_market_id, v_market.event_id, v_market.group_id, p_profile_id, p_selection_key,
    p_stake, v_snapshot.decimal_odds, round(p_stake * v_snapshot.decimal_odds, 2), p_snapshot_id,
    v_snapshot.event_version
  )
  RETURNING id INTO v_pick_id;

  INSERT INTO fantasy_wallet_transactions (
    group_id, profile_id, group_season_id, event_id, pick_id, type, amount, note
  ) VALUES (
    v_market.group_id, p_profile_id, p_group_season_id, v_market.event_id, v_pick_id,
    'stake', -p_stake, 'Pick stake'
  );

  RETURN v_pick_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ciaga_fantasy_place_pick(uuid, uuid, text, numeric, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_place_pick(uuid, uuid, text, numeric, uuid, uuid, boolean) TO service_role;

-- ─── Apply settlement ─────────────────────────────────────────────────────────
-- p_outcomes: [{"pick_id": "...", "outcome": "won"|"lost"|"void"}, ...]
-- Idempotent: only 'open' picks transition; re-runs are no-ops. Payout/refund
-- ledger rows copy the scope columns from the pick's stake row so balances
-- stay consistent for every budget scope.
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_apply_settlement(
  p_event_id uuid,
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
  v_season uuid;
  v_won integer := 0;
  v_lost integer := 0;
  v_void integer := 0;
BEGIN
  FOR rec IN
    SELECT (o->>'pick_id')::uuid AS pick_id, o->>'outcome' AS outcome
    FROM jsonb_array_elements(p_outcomes) AS o
  LOOP
    IF rec.outcome NOT IN ('won', 'lost', 'void') THEN
      CONTINUE;
    END IF;

    UPDATE fantasy_picks
       SET status = rec.outcome,
           settled_at = now()
     WHERE id = rec.pick_id
       AND event_id = p_event_id
       AND status = 'open'
    RETURNING id, group_id, profile_id, event_id, stake, potential_return
      INTO v_pick;

    IF v_pick.id IS NULL THEN
      CONTINUE; -- already settled/cashed out (idempotent re-run)
    END IF;

    SELECT group_season_id INTO v_season
      FROM fantasy_wallet_transactions
     WHERE pick_id = v_pick.id AND type = 'stake'
     LIMIT 1;

    IF rec.outcome = 'won' THEN
      v_won := v_won + 1;
      INSERT INTO fantasy_wallet_transactions (
        group_id, profile_id, group_season_id, event_id, pick_id, type, amount, note
      ) VALUES (
        v_pick.group_id, v_pick.profile_id, v_season, v_pick.event_id, v_pick.id,
        'payout', v_pick.potential_return, 'Pick won'
      );
    ELSIF rec.outcome = 'void' THEN
      v_void := v_void + 1;
      INSERT INTO fantasy_wallet_transactions (
        group_id, profile_id, group_season_id, event_id, pick_id, type, amount, note
      ) VALUES (
        v_pick.group_id, v_pick.profile_id, v_season, v_pick.event_id, v_pick.id,
        'void_refund', v_pick.stake, 'Pick voided — stake returned'
      );
    ELSE
      v_lost := v_lost + 1;
    END IF;
  END LOOP;

  UPDATE fantasy_markets
     SET status = 'settled', settled_at = now(), updated_at = now()
   WHERE event_id = p_event_id
     AND id = ANY(p_market_ids)
     AND status IN ('open', 'suspended');

  UPDATE fantasy_event_state
     SET is_final = true,
         odds_stale = false,
         changed_reason = 'settled',
         updated_at = now()
   WHERE event_id = p_event_id;

  RETURN jsonb_build_object('won', v_won, 'lost', v_lost, 'void', v_void);
END;
$$;

REVOKE ALL ON FUNCTION public.ciaga_fantasy_apply_settlement(uuid, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_apply_settlement(uuid, jsonb, uuid[]) TO service_role;
