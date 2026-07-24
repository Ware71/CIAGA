-- Fantasy Picks — season cash-out.
--
-- Season picks (winner / top-N in the standings) get the same short-lived
-- cash-out quotes as event picks: value = CurrentProbability × PotentialReturn
-- × 0.90, offered for ~15s against a pinned (season_version, pick_version).
-- Mirrors the event cash-out (20260708000004) — eligibility is enforced in
-- TypeScript; this RPC enforces the concurrency-critical acceptance invariants
-- (offer unexpired, pick still open + unversioned-changed, season version
-- unmoved since the quote). Season markets have no self-dependency to guard.

-- 1. Season picks can now be cashed out, and carry a version for anti-snipe.
ALTER TABLE public.fantasy_season_picks
  DROP CONSTRAINT IF EXISTS fantasy_season_picks_status_check;
ALTER TABLE public.fantasy_season_picks
  ADD CONSTRAINT fantasy_season_picks_status_check
  CHECK (status IN ('open', 'won', 'lost', 'void', 'cashed_out'));
ALTER TABLE public.fantasy_season_picks
  ADD COLUMN IF NOT EXISTS cashout_value numeric(12,2);
ALTER TABLE public.fantasy_season_picks
  ADD COLUMN IF NOT EXISTS pick_version integer NOT NULL DEFAULT 1;

-- 2. Offers table (mirrors fantasy_cashout_offers, season-scoped).
CREATE TABLE IF NOT EXISTS public.fantasy_season_cashout_offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_pick_id  uuid NOT NULL REFERENCES public.fantasy_season_picks(id) ON DELETE CASCADE,
  group_id        uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  group_season_id uuid NOT NULL REFERENCES public.group_seasons(id) ON DELETE CASCADE,
  season_version  bigint NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_fantasy_season_cashout_offers_pick
  ON public.fantasy_season_cashout_offers(season_pick_id, status);
CREATE INDEX IF NOT EXISTS idx_fantasy_season_cashout_offers_expiry
  ON public.fantasy_season_cashout_offers(expires_at)
  WHERE status = 'offered';

ALTER TABLE public.fantasy_season_cashout_offers ENABLE ROW LEVEL SECURITY;

-- Offers are visible to their pick's owner only (quotes are personal).
CREATE POLICY "fantasy_season_cashout_offers_select" ON public.fantasy_season_cashout_offers
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.fantasy_season_picks sp
      JOIN public.profiles p ON p.id = sp.profile_id
      WHERE sp.id = fantasy_season_cashout_offers.season_pick_id
        AND p.owner_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

GRANT SELECT ON public.fantasy_season_cashout_offers TO authenticated;
GRANT ALL ON public.fantasy_season_cashout_offers TO service_role;

-- 3. Accept season cash-out ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ciaga_fantasy_accept_season_cashout(
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
BEGIN
  SELECT * INTO v_offer
    FROM fantasy_season_cashout_offers
   WHERE id = p_offer_id
   FOR UPDATE;
  IF v_offer.id IS NULL THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;
  IF v_offer.status <> 'offered' THEN
    RAISE EXCEPTION 'Offer is no longer available';
  END IF;
  IF v_offer.expires_at <= now() THEN
    UPDATE fantasy_season_cashout_offers SET status = 'expired' WHERE id = p_offer_id;
    RAISE EXCEPTION 'Offer has expired';
  END IF;

  SELECT * INTO v_pick
    FROM fantasy_season_picks
   WHERE id = v_offer.season_pick_id
   FOR UPDATE;
  IF v_pick.profile_id <> p_profile_id THEN
    RAISE EXCEPTION 'Not your pick';
  END IF;
  IF v_pick.status <> 'open' THEN
    RAISE EXCEPTION 'Pick is no longer open';
  END IF;
  IF v_pick.pick_version <> v_offer.pick_version THEN
    UPDATE fantasy_season_cashout_offers SET status = 'invalidated' WHERE id = p_offer_id;
    RAISE EXCEPTION 'Pick changed since the offer — request a new quote';
  END IF;

  SELECT version INTO v_version
    FROM fantasy_season_state
   WHERE group_season_id = v_offer.group_season_id;
  IF v_version IS NULL OR v_version <> v_offer.season_version THEN
    UPDATE fantasy_season_cashout_offers SET status = 'invalidated' WHERE id = p_offer_id;
    RAISE EXCEPTION 'Odds moved since the offer — request a new quote';
  END IF;

  UPDATE fantasy_season_cashout_offers
     SET status = 'accepted'
   WHERE id = p_offer_id;

  -- Any other live quotes for this pick die with the acceptance.
  UPDATE fantasy_season_cashout_offers
     SET status = 'invalidated'
   WHERE season_pick_id = v_pick.id
     AND id <> p_offer_id
     AND status = 'offered';

  UPDATE fantasy_season_picks
     SET status = 'cashed_out',
         cashout_value = v_offer.offer_value,
         settled_at = now(),
         pick_version = pick_version + 1
   WHERE id = v_pick.id;

  INSERT INTO fantasy_wallet_transactions (
    group_id, profile_id, group_season_id, season_pick_id, type, amount, note
  ) VALUES (
    v_pick.group_id, v_pick.profile_id, v_pick.group_season_id, v_pick.id,
    'cashout', v_offer.offer_value, 'Season cash-out accepted'
  );

  RETURN jsonb_build_object('value', v_offer.offer_value);
END;
$$;

REVOKE ALL ON FUNCTION public.ciaga_fantasy_accept_season_cashout(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_accept_season_cashout(uuid, uuid) TO service_role;
