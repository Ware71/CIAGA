-- ============================================================
-- Fantasy Picks V3 — correlated accumulators (joint pricing)
--
-- Two players both finishing top-3 are NEGATIVELY correlated (limited top-3
-- slots), so the acca price can't be the product of the two marginal prices.
-- The simulation already produces each iteration's finishing positions; we
-- persist a compact per-iteration positions matrix per (event, version) so the
-- app can compute the TRUE joint probability for the finishing-position family
-- of legs (top-N / winner / finish-position / finish-range), while independent
-- legs (birdies, over/unders …) still multiply in.
--
--   fantasy_joint_samples  — gzipped Int8 positions matrix, one active row per
--                            event version, superseded/purged like snapshots.
--   fantasy_parlays.joint_priced — combined odds came from the joint, so
--                            settlement pays stake × combined_decimal_odds
--                            (not the product of won-leg odds).
--   ciaga_fantasy_place_parlay  — new signature: app passes the joint combined
--                            odds; RPC keeps per-leg anti-sniping + balance,
--                            drops the blunt one-subject-per-event guard (the
--                            nuanced co-occurrence rule is enforced app-side).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fantasy_joint_samples (
  event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_version bigint NOT NULL,
  group_id      uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  -- Column index in the matrix → profile_id.
  player_ids    uuid[] NOT NULL,
  sim_count     integer NOT NULL,
  -- gzip(Int8[players × sim_count]) as base64 (reliable through PostgREST).
  matrix_b64    text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, event_version)
);

CREATE INDEX IF NOT EXISTS idx_fantasy_joint_samples_active
  ON public.fantasy_joint_samples(event_id) WHERE status = 'active';

-- Service-role only: written by the odds service, read by the pricing lib
-- (which runs service-role). No authenticated GRANT — never client-read.
ALTER TABLE public.fantasy_joint_samples ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.fantasy_joint_samples TO service_role;

ALTER TABLE public.fantasy_parlays
  ADD COLUMN IF NOT EXISTS joint_priced boolean NOT NULL DEFAULT false;

-- ─── Place parlay (joint-aware) ──────────────────────────────────────────────
-- Signature change → DROP + CREATE (per the security-audit note: DROP resets
-- EXECUTE grants, so the REVOKE/GRANT is re-applied below).
DROP FUNCTION IF EXISTS public.ciaga_fantasy_place_parlay(uuid, uuid, numeric, jsonb, uuid, boolean);

CREATE FUNCTION public.ciaga_fantasy_place_parlay(
  p_profile_id uuid,
  p_group_id uuid,
  p_stake numeric,
  p_legs jsonb,
  p_group_season_id uuid,
  p_scope_event boolean,
  p_combined_odds numeric,
  p_joint_priced boolean
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
  v_product numeric := 1;   -- independent product (fallback + sanity)
  v_max_leg numeric := 1;   -- longest single-leg odds (joint must be ≥ this)
  v_combined numeric;
  v_balance numeric;
  v_parlay_id uuid;
  v_scope_key text;
  v_single_event uuid;
  v_events uuid[] := '{}';
  v_pairs text[] := '{}';   -- (market_id | selection_key) — reject exact dupes
  v_pair text;
BEGIN
  IF p_stake IS NULL OR p_stake < 1 OR p_stake <> round(p_stake) THEN
    RAISE EXCEPTION 'Stake must be a whole number of points (min 1)';
  END IF;

  v_leg_count := jsonb_array_length(p_legs);
  IF v_leg_count IS NULL OR v_leg_count < 2 OR v_leg_count > 8 THEN
    RAISE EXCEPTION 'An acca needs between 2 and 8 legs';
  END IF;

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

    -- Money-safety backstop: reject the exact same selection twice. The full
    -- co-occurrence rule (one player per event in the finishing markets, etc.)
    -- is enforced app-side in placeParlay before this call.
    v_pair := v_market.id::text || '|' || (leg->>'selection_key');
    IF v_pair = ANY(v_pairs) THEN
      RAISE EXCEPTION 'Duplicate selection in the acca';
    END IF;
    v_pairs := v_pairs || v_pair;
    v_events := v_events || v_market.event_id;

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

    v_product := v_product * v_snapshot.decimal_odds;
    IF v_snapshot.decimal_odds > v_max_leg THEN
      v_max_leg := v_snapshot.decimal_odds;
    END IF;
  END LOOP;

  -- Trust the app's joint combined odds when supplied, else the product. Guard:
  -- the combined must be ≥ the longest single leg (holds for any joint, since a
  -- joint probability ≤ each marginal) and ≥ 1.
  v_combined := COALESCE(p_combined_odds, v_product);
  IF v_combined < 1 OR v_combined < v_max_leg - 0.01 THEN
    RAISE EXCEPTION 'Combined odds are invalid — refresh and try again';
  END IF;

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
    group_season_id, event_id, joint_priced
  ) VALUES (
    p_group_id, p_profile_id, p_stake, round(v_combined, 2),
    round(p_stake * v_combined, 2), p_group_season_id,
    v_single_event,
    COALESCE(p_joint_priced, false) AND p_combined_odds IS NOT NULL
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

REVOKE ALL ON FUNCTION public.ciaga_fantasy_place_parlay(uuid, uuid, numeric, jsonb, uuid, boolean, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_place_parlay(uuid, uuid, numeric, jsonb, uuid, boolean, numeric, boolean) TO service_role;

-- ─── Settle parlay legs (joint-aware) ────────────────────────────────────────
-- Joint-priced parlays pay stake × combined_decimal_odds when every leg wins;
-- ANY void leg voids the whole parlay (the survivors' joint can't be recomputed
-- once the matrix is purged, and voids only happen on player withdrawal).
-- Non-joint parlays keep the classic product-of-won-legs behaviour.
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_settle_parlay_legs(
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
  v_void integer;
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
    SELECT id, group_id, profile_id, group_season_id, event_id, stake, status,
           combined_decimal_odds, joint_priced
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
      COUNT(*) FILTER (WHERE status = 'void'),
      COUNT(*) FILTER (WHERE status = 'won'),
      COALESCE(EXP(SUM(LN(decimal_odds)) FILTER (WHERE status = 'won')), 1)
      INTO v_open, v_lost, v_void, v_won_legs, v_won_odds
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
    ELSIF v_parlay.joint_priced AND v_void > 0 THEN
      -- A joint-priced combo with a withdrawn player → void (refund stake).
      UPDATE fantasy_parlays
         SET status = 'void', settled_at = now()
       WHERE id = v_pid;
      INSERT INTO fantasy_wallet_transactions (
        group_id, profile_id, group_season_id, event_id, parlay_id, type, amount, note
      ) VALUES (
        v_parlay.group_id, v_parlay.profile_id, v_parlay.group_season_id, v_parlay.event_id,
        v_pid, 'void_refund', v_parlay.stake, 'Acca voided — stake returned'
      );
    ELSIF NOT v_parlay.joint_priced AND v_won_legs = 0 THEN
      -- Non-joint, every leg void → refund the stake.
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
      -- Won. Joint parlays pay the locked joint price; non-joint pay the
      -- product of the won legs (void legs already dropped to 1.0).
      v_payout := round(
        v_parlay.stake * CASE WHEN v_parlay.joint_priced THEN v_parlay.combined_decimal_odds ELSE v_won_odds END,
        2
      );
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
