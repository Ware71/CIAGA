-- Fantasy Picks — Phase 4: cash-out offers.
--
-- Offers are short-lived (≈15s) quotes: value = probability × potential_return
-- × discount (0.90). Eligibility (market rules, self-dependency, cut-offs)
-- is enforced in TypeScript via the market registry before an offer is
-- created; this RPC enforces the concurrency-critical acceptance invariants:
-- the offer is unexpired, the pick is still open and unversioned-changed, and
-- the event version hasn't moved since the quote (a score submitted between
-- quote and accept invalidates the offer).

CREATE TABLE IF NOT EXISTS public.fantasy_cashout_offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id         uuid NOT NULL REFERENCES public.fantasy_picks(id) ON DELETE CASCADE,
  group_id        uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_version   bigint NOT NULL,
  pick_version    integer NOT NULL,
  offer_value     numeric(12,2) NOT NULL CHECK (offer_value >= 0),
  probability     numeric(8,6) NOT NULL,
  discount_factor numeric(4,2) NOT NULL DEFAULT 0.90,
  status          text NOT NULL DEFAULT 'offered' CHECK (
                    status IN ('offered', 'accepted', 'expired', 'rejected', 'invalidated')
                  ),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fantasy_cashout_offers_pick
  ON public.fantasy_cashout_offers(pick_id, status);

CREATE INDEX IF NOT EXISTS idx_fantasy_cashout_offers_expiry
  ON public.fantasy_cashout_offers(expires_at)
  WHERE status = 'offered';

ALTER TABLE public.fantasy_cashout_offers ENABLE ROW LEVEL SECURITY;

-- Offers are visible to their pick's owner only (quotes are personal;
-- accepted cash-outs surface via the pick/ledger, which are group-visible).
CREATE POLICY "fantasy_cashout_offers_select" ON public.fantasy_cashout_offers
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.fantasy_picks fp
      JOIN public.profiles p ON p.id = fp.profile_id
      WHERE fp.id = fantasy_cashout_offers.pick_id
        AND p.owner_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

GRANT SELECT ON public.fantasy_cashout_offers TO authenticated;
GRANT ALL ON public.fantasy_cashout_offers TO service_role;

-- ─── Accept cash-out ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_accept_cashout(
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
  v_pick record;
  v_version bigint;
  v_season uuid;
BEGIN
  SELECT * INTO v_offer
    FROM fantasy_cashout_offers
   WHERE id = p_offer_id
   FOR UPDATE;
  IF v_offer.id IS NULL THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;
  IF v_offer.status <> 'offered' THEN
    RAISE EXCEPTION 'Offer is no longer available';
  END IF;
  IF v_offer.expires_at <= now() THEN
    UPDATE fantasy_cashout_offers SET status = 'expired' WHERE id = p_offer_id;
    RAISE EXCEPTION 'Offer has expired';
  END IF;

  SELECT * INTO v_pick
    FROM fantasy_picks
   WHERE id = v_offer.pick_id
   FOR UPDATE;
  IF v_pick.profile_id <> p_profile_id THEN
    RAISE EXCEPTION 'Not your pick';
  END IF;
  IF v_pick.status <> 'open' THEN
    RAISE EXCEPTION 'Pick is no longer open';
  END IF;
  IF v_pick.pick_version <> v_offer.pick_version THEN
    UPDATE fantasy_cashout_offers SET status = 'invalidated' WHERE id = p_offer_id;
    RAISE EXCEPTION 'Pick changed since the offer — request a new quote';
  END IF;

  SELECT version INTO v_version
    FROM fantasy_event_state
   WHERE event_id = v_offer.event_id;
  IF v_version IS NULL OR v_version <> v_offer.event_version THEN
    UPDATE fantasy_cashout_offers SET status = 'invalidated' WHERE id = p_offer_id;
    RAISE EXCEPTION 'Odds moved since the offer — request a new quote';
  END IF;

  UPDATE fantasy_cashout_offers
     SET status = 'accepted'
   WHERE id = p_offer_id;

  -- Any other live quotes for this pick die with the acceptance.
  UPDATE fantasy_cashout_offers
     SET status = 'invalidated'
   WHERE pick_id = v_pick.id
     AND id <> p_offer_id
     AND status = 'offered';

  UPDATE fantasy_picks
     SET status = 'cashed_out',
         cashout_value = v_offer.offer_value,
         settled_at = now(),
         pick_version = pick_version + 1
   WHERE id = v_pick.id;

  SELECT group_season_id INTO v_season
    FROM fantasy_wallet_transactions
   WHERE pick_id = v_pick.id AND type = 'stake'
   LIMIT 1;

  INSERT INTO fantasy_wallet_transactions (
    group_id, profile_id, group_season_id, event_id, pick_id, type, amount, note
  ) VALUES (
    v_pick.group_id, v_pick.profile_id, v_season, v_pick.event_id, v_pick.id,
    'cashout', v_offer.offer_value, 'Cash-out accepted'
  );

  RETURN jsonb_build_object('value', v_offer.offer_value);
END;
$$;

REVOKE ALL ON FUNCTION public.ciaga_fantasy_accept_cashout(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_accept_cashout(uuid, uuid) TO service_role;
