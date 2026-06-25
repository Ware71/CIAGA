-- Track who created a profile (e.g. via "invite a friend" or adding a player to a round).
-- The creator can manage the profile (change email, send invites) until it is claimed.
-- created_by references profiles(id); ON DELETE SET NULL so deleting a creator profile
-- doesn't cascade-delete the profiles they created.

alter table public.profiles
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

create index if not exists profiles_created_by_idx on public.profiles(created_by);
