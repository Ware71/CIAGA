-- Add withdrawal transaction type to the group_balance_transactions check constraint.
-- Withdrawal records when an admin physically hands prize money to a player.
-- It reduces the player's balance but is excluded from "total winnings" stats.

ALTER TABLE public.group_balance_transactions
  DROP CONSTRAINT IF EXISTS group_balance_transactions_type_check;

ALTER TABLE public.group_balance_transactions
  ADD CONSTRAINT group_balance_transactions_type_check
    CHECK (type IN ('entry_fee', 'green_fee', 'extra_charge', 'payment', 'winnings', 'adjustment', 'withdrawal'));
