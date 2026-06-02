-- Prize pots: named prize funds at event, competition-season, or group-season scope.
-- Supports position-based, metric-weighted/equal, equal-split, non-monetary, and entry-only pots.
-- Separate from the implicit main prize (entry_fee_amount + prize_table + event_winnings on events).

-- ─── round_id on event_charges ───────────────────────────────────────────────
-- Allows a charge to be scoped to a specific round (null = whole event).
ALTER TABLE public.event_charges
  ADD COLUMN round_id uuid REFERENCES public.event_rounds(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_charges_round
  ON public.event_charges(round_id) WHERE round_id IS NOT NULL;

-- ─── prize_pots ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prize_pots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,

  -- Exactly one scope must be set (enforced by CHECK below)
  event_id              uuid REFERENCES public.events(id) ON DELETE CASCADE,
  competition_season_id uuid REFERENCES public.competition_seasons(id) ON DELETE CASCADE,
  group_season_id       uuid REFERENCES public.group_seasons(id) ON DELETE CASCADE,

  name                  text NOT NULL,
  description           text,

  -- Optional per-player buy-in fee
  entry_fee_amount      numeric(10,2),
  entry_fee_currency    text NOT NULL DEFAULT 'GBP',
  entry_fee_notes       text,

  -- Distribution method
  distribution_type     text NOT NULL DEFAULT 'position_based'
    CHECK (distribution_type IN (
      'position_based',   -- 1st/2nd/3rd splits from prize_table JSON
      'metric_weighted',  -- proportional to metric value (e.g. 3 twos → 3× share)
      'metric_equal',     -- equal share to each player with metric_value >= 1
      'equal_split',      -- split equally among all enrolled players
      'non_monetary',     -- no cash; prize_description only
      'entry_only'        -- entry fee charged with no distribution
    )),

  -- For position_based: [{position: 1, percentage: 50}, {position: 2, percentage: 30}, …]
  prize_table           jsonb,

  -- For metric-based pots
  metric_type           text CHECK (metric_type IN (
    'twos',           -- auto-calculated from hole scores (round_score_events)
    'nearest_pin',    -- manually recorded by admin
    'longest_drive',  -- manually recorded by admin
    'season_points',  -- from competition_season standings
    'custom'          -- admin-defined description, manually recorded
  )),
  metric_description    text,

  -- For non_monetary pots
  is_monetary           boolean NOT NULL DEFAULT true,
  prize_description     text,

  status                text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'locked', 'distributed')),

  created_by            uuid NOT NULL REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prize_pots_exactly_one_scope CHECK (
    (event_id IS NOT NULL)::int +
    (competition_season_id IS NOT NULL)::int +
    (group_season_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX IF NOT EXISTS idx_prize_pots_event
  ON public.prize_pots(event_id) WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prize_pots_competition_season
  ON public.prize_pots(competition_season_id) WHERE competition_season_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prize_pots_group_season
  ON public.prize_pots(group_season_id) WHERE group_season_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prize_pots_group
  ON public.prize_pots(group_id);

ALTER TABLE public.prize_pots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prize_pots_select" ON public.prize_pots
  FOR SELECT USING (true);

CREATE POLICY "prize_pots_insert" ON public.prize_pots
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "prize_pots_update" ON public.prize_pots
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "prize_pots_delete" ON public.prize_pots
  FOR DELETE USING (auth.role() = 'service_role');

GRANT SELECT ON public.prize_pots TO authenticated;
GRANT ALL ON public.prize_pots TO service_role;

-- ─── prize_pot_entries ───────────────────────────────────────────────────────
-- One row per player enrolled in a pot.
CREATE TABLE IF NOT EXISTS public.prize_pot_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prize_pot_id        uuid NOT NULL REFERENCES public.prize_pots(id) ON DELETE CASCADE,
  profile_id          uuid NOT NULL REFERENCES public.profiles(id),

  -- Entry fee paid into the pot (0 if free to enter)
  amount_contributed  numeric(10,2) NOT NULL DEFAULT 0,
  -- Debit transaction in group_balance_transactions (entry_fee type)
  transaction_id      uuid REFERENCES public.group_balance_transactions(id) ON DELETE SET NULL,

  -- For metric-based pots (auto-computed or manually set by admin)
  metric_value        numeric(10,2),
  -- Hole-level detail for 'twos': [{round_id, hole_number, score}]
  metric_detail       jsonb,

  enrolled_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (prize_pot_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_prize_pot_entries_pot
  ON public.prize_pot_entries(prize_pot_id);

CREATE INDEX IF NOT EXISTS idx_prize_pot_entries_profile
  ON public.prize_pot_entries(profile_id);

ALTER TABLE public.prize_pot_entries ENABLE ROW LEVEL SECURITY;

-- Members see their own entries; admins/owners see all for their group
CREATE POLICY "ppe_select" ON public.prize_pot_entries
  FOR SELECT USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.uid() IN (
      SELECT p.owner_user_id FROM public.profiles p
      JOIN public.major_group_memberships m ON m.profile_id = p.id
      WHERE m.group_id = (SELECT group_id FROM public.prize_pots WHERE id = prize_pot_id)
        AND m.role IN ('owner', 'admin')
        AND m.status = 'active'
    )
    OR auth.role() = 'service_role'
  );

CREATE POLICY "ppe_insert" ON public.prize_pot_entries
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "ppe_update" ON public.prize_pot_entries
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "ppe_delete" ON public.prize_pot_entries
  FOR DELETE USING (auth.role() = 'service_role');

GRANT SELECT ON public.prize_pot_entries TO authenticated;
GRANT ALL ON public.prize_pot_entries TO service_role;

-- ─── prize_pot_payouts ───────────────────────────────────────────────────────
-- Distribution records — one row per player receiving a payout.
CREATE TABLE IF NOT EXISTS public.prize_pot_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prize_pot_id    uuid NOT NULL REFERENCES public.prize_pots(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES public.profiles(id),

  position        integer,          -- for position_based (1, 2, 3 …)
  amount          numeric(10,2),    -- null for non_monetary
  note            text,             -- e.g. "Two's Club winner with 3 twos"

  -- Credit transaction in group_balance_transactions (winnings type)
  transaction_id  uuid REFERENCES public.group_balance_transactions(id) ON DELETE SET NULL,

  recorded_by     uuid NOT NULL REFERENCES public.profiles(id),
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prize_pot_payouts_pot
  ON public.prize_pot_payouts(prize_pot_id);

CREATE INDEX IF NOT EXISTS idx_prize_pot_payouts_profile
  ON public.prize_pot_payouts(profile_id);

ALTER TABLE public.prize_pot_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ppp_select" ON public.prize_pot_payouts
  FOR SELECT USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.uid() IN (
      SELECT p.owner_user_id FROM public.profiles p
      JOIN public.major_group_memberships m ON m.profile_id = p.id
      WHERE m.group_id = (SELECT group_id FROM public.prize_pots WHERE id = prize_pot_id)
        AND m.role IN ('owner', 'admin')
        AND m.status = 'active'
    )
    OR auth.role() = 'service_role'
  );

CREATE POLICY "ppp_insert" ON public.prize_pot_payouts
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "ppp_update" ON public.prize_pot_payouts
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "ppp_delete" ON public.prize_pot_payouts
  FOR DELETE USING (auth.role() = 'service_role');

GRANT SELECT ON public.prize_pot_payouts TO authenticated;
GRANT ALL ON public.prize_pot_payouts TO service_role;
