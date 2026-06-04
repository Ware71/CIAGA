-- Majors financial tracking tables:
--   competition_extras         — ad hoc charges per competition (nearest-pin, longest drive, etc.)
--   group_balance_transactions — ledger of all charges, payments, and winnings per player per group
--   competition_winnings       — prize payouts per competition

-- ─── Ad hoc competition extras ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competition_extras (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  name          text NOT NULL,
  amount        numeric(10,2) NOT NULL,
  description   text,
  created_by    uuid NOT NULL REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competition_extras_competition
  ON public.competition_extras(competition_id);

ALTER TABLE public.competition_extras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "extras_select" ON public.competition_extras
  FOR SELECT USING (true);

CREATE POLICY "extras_insert" ON public.competition_extras
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "extras_delete" ON public.competition_extras
  FOR DELETE USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = created_by)
    OR auth.role() = 'service_role'
  );

-- ─── Player balance ledger ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_balance_transactions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  profile_id           uuid NOT NULL REFERENCES public.profiles(id),
  competition_id       uuid REFERENCES public.competitions(id) ON DELETE SET NULL,
  competition_extra_id uuid REFERENCES public.competition_extras(id) ON DELETE SET NULL,
  type                 text NOT NULL CHECK (
                         type IN ('entry_fee', 'extra_charge', 'payment', 'winnings', 'adjustment')
                       ),
  -- positive = charged to player, negative = credit to player
  amount               numeric(10,2) NOT NULL,
  note                 text,
  recorded_by          uuid REFERENCES public.profiles(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gbt_group_profile
  ON public.group_balance_transactions(group_id, profile_id);

CREATE INDEX IF NOT EXISTS idx_gbt_competition
  ON public.group_balance_transactions(competition_id)
  WHERE competition_id IS NOT NULL;

ALTER TABLE public.group_balance_transactions ENABLE ROW LEVEL SECURITY;

-- Members can see their own transactions; admins/owners see all in the group
CREATE POLICY "gbt_select_own" ON public.group_balance_transactions
  FOR SELECT USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.uid() IN (
      SELECT p.owner_user_id FROM public.profiles p
      JOIN public.major_group_memberships m ON m.profile_id = p.id
      WHERE m.group_id = group_balance_transactions.group_id
        AND m.role IN ('owner', 'admin')
        AND m.status = 'active'
    )
    OR auth.role() = 'service_role'
  );

CREATE POLICY "gbt_insert" ON public.group_balance_transactions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "gbt_delete" ON public.group_balance_transactions
  FOR DELETE USING (auth.role() = 'service_role');

-- ─── Competition winnings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competition_winnings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  profile_id     uuid NOT NULL REFERENCES public.profiles(id),
  position       integer,
  amount         numeric(10,2) NOT NULL,
  note           text,
  recorded_by    uuid NOT NULL REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competition_winnings_competition
  ON public.competition_winnings(competition_id);

ALTER TABLE public.competition_winnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "winnings_select" ON public.competition_winnings
  FOR SELECT USING (true);

CREATE POLICY "winnings_insert" ON public.competition_winnings
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "winnings_delete" ON public.competition_winnings
  FOR DELETE USING (auth.role() = 'service_role');
