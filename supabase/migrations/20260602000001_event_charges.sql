-- Event charges: per-player billing for green fees, buggies, food, etc.
-- Separate from event_extras (which are event-level prize additions like nearest pin).

-- ─── Charge catalog per event ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_charges (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  amount                numeric(10,2) NOT NULL,
  category              text NOT NULL DEFAULT 'other'
                          CHECK (category IN ('green_fee', 'buggy', 'food', 'drink', 'other')),
  description           text,
  applies_to_all_entries boolean NOT NULL DEFAULT false,
  created_by            uuid REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_charges_event
  ON public.event_charges(event_id);

ALTER TABLE public.event_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_charges_select" ON public.event_charges
  FOR SELECT USING (true);

CREATE POLICY "event_charges_insert" ON public.event_charges
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "event_charges_delete" ON public.event_charges
  FOR DELETE USING (auth.role() = 'service_role');

-- ─── Per-player charge assignments ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_player_charges (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  charge_id               uuid REFERENCES public.event_charges(id) ON DELETE SET NULL,
  profile_id              uuid NOT NULL REFERENCES public.profiles(id),
  name                    text NOT NULL,            -- snapshot at assignment time
  amount                  numeric(10,2) NOT NULL,   -- may differ from catalog
  category                text NOT NULL DEFAULT 'other',
  -- charge_transaction_id: the debit created when charge is assigned
  charge_transaction_id   uuid REFERENCES public.group_balance_transactions(id) ON DELETE SET NULL,
  -- payment_transaction_id: set when marked paid (IS NOT NULL = paid)
  payment_transaction_id  uuid REFERENCES public.group_balance_transactions(id) ON DELETE SET NULL,
  created_by              uuid REFERENCES public.profiles(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (charge_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_event_player_charges_event
  ON public.event_player_charges(event_id);

CREATE INDEX IF NOT EXISTS idx_event_player_charges_profile
  ON public.event_player_charges(profile_id);

ALTER TABLE public.event_player_charges ENABLE ROW LEVEL SECURITY;

-- Members see only their own; admins/owners see all for their group's events
CREATE POLICY "epc_select" ON public.event_player_charges
  FOR SELECT USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.uid() IN (
      SELECT p.owner_user_id FROM public.profiles p
      JOIN public.major_group_memberships m ON m.profile_id = p.id
      JOIN public.events e ON e.group_id = m.group_id
      WHERE e.id = event_player_charges.event_id
        AND m.role IN ('owner', 'admin')
        AND m.status = 'active'
    )
    OR auth.role() = 'service_role'
  );

CREATE POLICY "epc_insert" ON public.event_player_charges
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "epc_update" ON public.event_player_charges
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "epc_delete" ON public.event_player_charges
  FOR DELETE USING (auth.role() = 'service_role');

-- ─── Extend transaction type check to include green_fee ──────────────────────
ALTER TABLE public.group_balance_transactions
  DROP CONSTRAINT IF EXISTS group_balance_transactions_type_check;

ALTER TABLE public.group_balance_transactions
  ADD CONSTRAINT group_balance_transactions_type_check
    CHECK (type IN ('entry_fee', 'green_fee', 'extra_charge', 'payment', 'winnings', 'adjustment'));
