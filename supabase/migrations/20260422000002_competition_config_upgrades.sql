-- Competition configuration upgrades for Majors:
--   allow_self_withdrawal  — players can withdraw themselves
--   tee_time_mode          — admin_assigned or self_select
--   waitlist_enabled       — competition has a waitlist
--   max_entries            — cap on competition entries (null = unlimited)
--   prize_table            — JSON array of {position, pct} for auto-propose winnings
--   entry_fee_amount       — entry fee per competition
--   entry_fee_currency     — currency code (default GBP)
--   entry_fee_notes        — admin note on the fee

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS allow_self_withdrawal boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tee_time_mode text NOT NULL DEFAULT 'admin_assigned'
    CHECK (tee_time_mode IN ('admin_assigned', 'self_select')),
  ADD COLUMN IF NOT EXISTS waitlist_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_entries integer,
  ADD COLUMN IF NOT EXISTS prize_table jsonb,
  ADD COLUMN IF NOT EXISTS entry_fee_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS entry_fee_currency text NOT NULL DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS entry_fee_notes text;

-- Financial policy per group: whether members can carry a negative balance
ALTER TABLE public.major_groups
  ADD COLUMN IF NOT EXISTS allow_credit boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.competitions.allow_self_withdrawal IS
  'Whether members can withdraw themselves from this competition. When false, they must contact the organiser.';

COMMENT ON COLUMN public.competitions.tee_time_mode IS
  'admin_assigned: only admins create tee-time groups. self_select: entered players can claim an available slot.';

COMMENT ON COLUMN public.competitions.waitlist_enabled IS
  'When true, players who cannot enter (full/closed) can join a waitlist and be promoted on withdrawal.';

COMMENT ON COLUMN public.competitions.max_entries IS
  'Maximum number of competition entries allowed. NULL means unlimited.';

COMMENT ON COLUMN public.competitions.prize_table IS
  'JSON array [{position: 1, pct: 60}, ...] used to auto-propose winnings from entry-fee pot.';

COMMENT ON COLUMN public.major_groups.allow_credit IS
  'When false, players must clear any outstanding balance before entering a new competition.';
