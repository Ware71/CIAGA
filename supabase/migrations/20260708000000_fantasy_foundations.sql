-- Fantasy Picks — Phase 1 foundations
--   major_groups.fantasy_config    — per-group feature config (NULL = disabled)
--   fantasy_event_state            — odds versioning/staleness, 1:1 with events
--   fantasy_wallet_transactions    — signed points ledger (budgets, stakes, payouts)
--
-- Design notes:
--   * fantasy_config jsonb shape:
--       { "mode": "fixed" | "topup", "budgetScope": "season" | "event",
--         "budgetAmount": 500, "topupIncrement": 100,
--         "enabledAt": "...", "updatedByProfileId": "..." }
--     Written only via /api/fantasy/groups/[id]/config (NOT the group PATCH allowlist).
--   * All writes to fantasy tables go through service-role API routes / RPCs.
--     Authenticated users get SELECT only (picks/wallet/odds are group-visible by
--     design: the PnL leaderboard needs them and it's points, not money).
--   * RLS membership checks use the profiles.owner_user_id indirection
--     (see 20260706000000_security_hardening.sql), not profile_id = auth.uid().

-- ─── Group config ─────────────────────────────────────────────────────────────
ALTER TABLE public.major_groups
  ADD COLUMN IF NOT EXISTS fantasy_config jsonb;

-- ─── Event odds state ─────────────────────────────────────────────────────────
-- Row existence = fantasy is active for this event (cheap gate for triggers).
-- version increments on every meaningful change; odds snapshots are keyed to it.
-- is_final = settled; blocks all further staleness bumps and refreshes.
CREATE TABLE IF NOT EXISTS public.fantasy_event_state (
  event_id          uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  group_id          uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  version           bigint NOT NULL DEFAULT 1,
  odds_stale        boolean NOT NULL DEFAULT true,
  changed_reason    text,
  last_refreshed_at timestamptz,
  is_final          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fantasy_event_state_group
  ON public.fantasy_event_state(group_id);

ALTER TABLE public.fantasy_event_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fantasy_event_state_select" ON public.fantasy_event_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.major_group_memberships m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = fantasy_event_state.group_id
        AND m.status = 'active'
        AND p.owner_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

GRANT SELECT ON public.fantasy_event_state TO authenticated;
GRANT ALL ON public.fantasy_event_state TO service_role;

-- ─── Points wallet ledger ─────────────────────────────────────────────────────
-- Sign convention: positive = credit to player, negative = debit.
--   budget_grant / topup / payout / cashout / void_refund  → positive
--   stake                                                  → negative
--   adjustment                                             → either (admin)
-- Balance  = SUM(amount) within the group's budget scope.
-- PnL      = SUM(amount) over stake|payout|cashout|void_refund only,
--            so grants and top-ups can never game the leaderboard.
-- Scope columns: season-scoped rows carry group_season_id, event-scoped rows
-- carry event_id, group-lifetime rows (groups without seasons) carry neither.
-- Pick-linked rows always carry event_id and, for season-scoped groups, the
-- event's group_season_id (denormalized at write time so one SUM works).
-- pick_id is a plain uuid until fantasy_picks exists (FK added in Phase 3).
CREATE TABLE IF NOT EXISTS public.fantasy_wallet_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES public.profiles(id),
  group_season_id uuid REFERENCES public.group_seasons(id) ON DELETE SET NULL,
  event_id        uuid REFERENCES public.events(id) ON DELETE SET NULL,
  pick_id         uuid,
  type            text NOT NULL CHECK (
                    type IN ('budget_grant', 'topup', 'stake', 'payout',
                             'cashout', 'void_refund', 'adjustment')
                  ),
  amount          numeric(12,2) NOT NULL CHECK (amount <> 0),
  note            text,
  created_by      uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fantasy_wallet_amount_sign CHECK (
    (type = 'stake' AND amount < 0)
    OR (type IN ('budget_grant', 'topup', 'payout', 'cashout', 'void_refund') AND amount > 0)
    OR (type = 'adjustment')
  )
);

CREATE INDEX IF NOT EXISTS idx_fantasy_wallet_group_profile
  ON public.fantasy_wallet_transactions(group_id, profile_id);

CREATE INDEX IF NOT EXISTS idx_fantasy_wallet_season
  ON public.fantasy_wallet_transactions(group_id, profile_id, group_season_id)
  WHERE group_season_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fantasy_wallet_event
  ON public.fantasy_wallet_transactions(group_id, profile_id, event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fantasy_wallet_pick
  ON public.fantasy_wallet_transactions(pick_id)
  WHERE pick_id IS NOT NULL;

-- Idempotent budget grants: at most one grant row per (player, scope).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fantasy_wallet_grant_season
  ON public.fantasy_wallet_transactions(group_id, profile_id, group_season_id)
  WHERE type = 'budget_grant' AND group_season_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fantasy_wallet_grant_event
  ON public.fantasy_wallet_transactions(group_id, profile_id, event_id)
  WHERE type = 'budget_grant' AND event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fantasy_wallet_grant_lifetime
  ON public.fantasy_wallet_transactions(group_id, profile_id)
  WHERE type = 'budget_grant' AND group_season_id IS NULL AND event_id IS NULL;

ALTER TABLE public.fantasy_wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fantasy_wallet_select" ON public.fantasy_wallet_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.major_group_memberships m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = fantasy_wallet_transactions.group_id
        AND m.status = 'active'
        AND p.owner_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

GRANT SELECT ON public.fantasy_wallet_transactions TO authenticated;
GRANT ALL ON public.fantasy_wallet_transactions TO service_role;

-- ─── Realtime ─────────────────────────────────────────────────────────────────
-- Only fantasy_event_state goes in the publication: one low-churn row per event;
-- clients refetch odds when odds_stale flips false. Snapshots are too chatty.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fantasy_event_state'
  ) then
    execute 'alter publication supabase_realtime add table public.fantasy_event_state';
  end if;
end;
$$;
