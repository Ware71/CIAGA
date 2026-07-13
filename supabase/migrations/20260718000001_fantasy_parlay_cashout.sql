-- ============================================================
-- Fantasy Picks — acca (parlay) cash-out.
--
-- Accas gain the same cash-out flow single picks have had since V1:
--   value = P(all still-open legs win jointly) × effective return × 0.90,
-- priced app-side from the extended joint samples (20260718000000), quoted as
-- a 15s offer, accepted through a version-checked RPC.
--
--   fantasy_parlays.cashout_value / status 'cashed_out' — mirror fantasy_picks.
--   fantasy_parlays.parlay_version — concurrency token: bumped whenever a leg
--     settles (even if the parlay stays open) and on cash-out, so an offer
--     quoted before a leg resolved can never be accepted after.
--   fantasy_cashout_offers — unified table: pick offers keep their columns,
--     parlay offers pin parlay_version + a {event_id: version} map (an acca
--     can span several events; every one must be unmoved at accept).
--   ciaga_fantasy_accept_parlay_cashout — mirrors ciaga_fantasy_accept_cashout.
--   ciaga_fantasy_settle_parlay_legs — replaced (same signature → grants
--     preserved) to bump parlay_version for every parlay whose legs changed.
--     Its status <> 'open' guard already prevents paying a cashed-out parlay.
-- ============================================================

-- ─── Parlay columns + status ─────────────────────────────────────────────────

ALTER TABLE public.fantasy_parlays
  ADD COLUMN IF NOT EXISTS cashout_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS parlay_version integer NOT NULL DEFAULT 1;

-- Swap the status CHECK to admit 'cashed_out' (constraint located by
-- definition, like 20260714's unique-constraint swap, in case the auto-name
-- ever differed).
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'public.fantasy_parlays'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.fantasy_parlays DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE public.fantasy_parlays
  ADD CONSTRAINT fantasy_parlays_status_check
  CHECK (status IN ('open', 'won', 'lost', 'void', 'cashed_out'));

-- ─── Unified cash-out offers ─────────────────────────────────────────────────
-- Extending the existing table (rather than a second one) keeps the cron
-- expiry/purge sweeps, the accept endpoint and the TTL/discount vocabulary
-- shared. The CHECK keeps every row exactly one of pick-offer / parlay-offer.

ALTER TABLE public.fantasy_cashout_offers
  ALTER COLUMN pick_id DROP NOT NULL,
  ALTER COLUMN event_id DROP NOT NULL,
  ALTER COLUMN event_version DROP NOT NULL,
  ALTER COLUMN pick_version DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS parlay_id uuid REFERENCES public.fantasy_parlays(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS parlay_version integer,
  -- {event_id: fantasy_event_state.version} for every event with an open leg.
  ADD COLUMN IF NOT EXISTS event_versions jsonb;

ALTER TABLE public.fantasy_cashout_offers
  ADD CONSTRAINT fantasy_cashout_offers_target_check CHECK (
    (
      pick_id IS NOT NULL AND parlay_id IS NULL
      AND event_id IS NOT NULL AND event_version IS NOT NULL AND pick_version IS NOT NULL
    )
    OR (
      parlay_id IS NOT NULL AND pick_id IS NULL
      AND event_versions IS NOT NULL AND parlay_version IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_fantasy_cashout_offers_parlay
  ON public.fantasy_cashout_offers(parlay_id, status)
  WHERE parlay_id IS NOT NULL;

-- Owner-only visibility gains the parlay arm.
DROP POLICY IF EXISTS "fantasy_cashout_offers_select" ON public.fantasy_cashout_offers;
CREATE POLICY "fantasy_cashout_offers_select" ON public.fantasy_cashout_offers
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.fantasy_picks fp
      JOIN public.profiles p ON p.id = fp.profile_id
      WHERE fp.id = fantasy_cashout_offers.pick_id
        AND p.owner_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.fantasy_parlays fpar
      JOIN public.profiles p ON p.id = fpar.profile_id
      WHERE fpar.id = fantasy_cashout_offers.parlay_id
        AND p.owner_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

-- ─── Accept parlay cash-out ──────────────────────────────────────────────────
-- Eligibility (per-leg market rules, self-dependency, cut-offs, repricing) is
-- enforced in TypeScript before an offer exists; this RPC enforces the
-- concurrency-critical acceptance invariants under FOR UPDATE locks.
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_accept_parlay_cashout(
  p_offer_id uuid,
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_offer record;
  v_parlay record;
  v_event uuid;
  v_pinned bigint;
  v_version bigint;
  rec record;
BEGIN
  SELECT * INTO v_offer
    FROM fantasy_cashout_offers
   WHERE id = p_offer_id
   FOR UPDATE;
  IF v_offer.id IS NULL THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;
  IF v_offer.parlay_id IS NULL THEN
    RAISE EXCEPTION 'Not an acca offer';
  END IF;
  IF v_offer.status <> 'offered' THEN
    RAISE EXCEPTION 'Offer is no longer available';
  END IF;
  IF v_offer.expires_at <= now() THEN
    UPDATE fantasy_cashout_offers SET status = 'expired' WHERE id = p_offer_id;
    RAISE EXCEPTION 'Offer has expired';
  END IF;

  SELECT * INTO v_parlay
    FROM fantasy_parlays
   WHERE id = v_offer.parlay_id
   FOR UPDATE;
  IF v_parlay.profile_id <> p_profile_id THEN
    RAISE EXCEPTION 'Not your acca';
  END IF;
  IF v_parlay.status <> 'open' THEN
    RAISE EXCEPTION 'Acca is no longer open';
  END IF;
  IF v_parlay.parlay_version <> v_offer.parlay_version THEN
    UPDATE fantasy_cashout_offers SET status = 'invalidated' WHERE id = p_offer_id;
    RAISE EXCEPTION 'Acca changed since the offer — request a new quote';
  END IF;

  -- Every pinned event version must be unmoved (a score submitted between
  -- quote and accept bumps the version and kills the quote).
  FOR rec IN SELECT key, value FROM jsonb_each_text(v_offer.event_versions)
  LOOP
    v_event := rec.key::uuid;
    v_pinned := rec.value::bigint;
    SELECT version INTO v_version
      FROM fantasy_event_state
     WHERE event_id = v_event;
    IF v_version IS NULL OR v_version <> v_pinned THEN
      UPDATE fantasy_cashout_offers SET status = 'invalidated' WHERE id = p_offer_id;
      RAISE EXCEPTION 'Odds moved since the offer — request a new quote';
    END IF;
  END LOOP;

  UPDATE fantasy_cashout_offers
     SET status = 'accepted'
   WHERE id = p_offer_id;

  -- Any other live quotes for this acca die with the acceptance.
  UPDATE fantasy_cashout_offers
     SET status = 'invalidated'
   WHERE parlay_id = v_parlay.id
     AND id <> p_offer_id
     AND status = 'offered';

  UPDATE fantasy_parlays
     SET status = 'cashed_out',
         cashout_value = v_offer.offer_value,
         settled_at = now(),
         parlay_version = parlay_version + 1
   WHERE id = v_parlay.id;

  -- Same scope columns the settle RPC uses for payout/void_refund, so PnL
  -- (which counts 'cashout') stays scoped identically to the stake.
  INSERT INTO fantasy_wallet_transactions (
    group_id, profile_id, group_season_id, event_id, parlay_id, type, amount, note
  ) VALUES (
    v_parlay.group_id, v_parlay.profile_id, v_parlay.group_season_id, v_parlay.event_id,
    v_parlay.id, 'cashout', v_offer.offer_value, 'Acca cash-out accepted'
  );

  RETURN jsonb_build_object('value', v_offer.offer_value);
END;
$$;

REVOKE ALL ON FUNCTION public.ciaga_fantasy_accept_parlay_cashout(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_accept_parlay_cashout(uuid, uuid) TO service_role;

-- ─── Settle parlay legs: bump the concurrency token ──────────────────────────
-- Identical to 20260710000002 except the parlay_version bump right after the
-- leg updates — it must fire for STILL-OPEN parlays too, so a cash-out quote
-- taken before a leg settled can never be accepted after. CREATE OR REPLACE
-- (unchanged signature) keeps the EXECUTE grants.
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

  -- Concurrency token: any leg change invalidates live cash-out quotes, even
  -- when the parlay itself stays open.
  UPDATE fantasy_parlays
     SET parlay_version = parlay_version + 1
   WHERE id = ANY(v_parlay_ids);

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
