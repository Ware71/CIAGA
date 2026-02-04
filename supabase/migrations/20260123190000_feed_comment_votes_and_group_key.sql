-- 1) Ensure feed_items.group_key is unique (idempotency + speed)
-- If you already have this, the DO block will no-op safely.

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'feed_items_group_key_unique'
  ) then
    -- Unique only if group_key is not null
    execute 'create unique index feed_items_group_key_unique on public.feed_items (group_key) where group_key is not null';
  end if;
end $$;

-- Helpful ordering index for feeds
do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'feed_items_occurred_at_id_idx'
  ) then
    execute 'create index feed_items_occurred_at_id_idx on public.feed_items (occurred_at desc, id desc)';
  end if;
end $$;


-- 2) Comment upvotes (simple count, no "who")
-- Adds:
--   feed_comment_votes(comment_id, voter_profile_id, created_at)
--   feed_comments.vote_count (maintained by triggers)

alter table public.feed_comments
  add column if not exists vote_count integer not null default 0;

create table if not exists public.feed_comment_votes (
  comment_id uuid not null references public.feed_comments(id) on delete cascade,
  voter_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, voter_profile_id)
);

-- Index to speed counting per comment (primary key already helps, but this is fine)
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'feed_comment_votes_comment_id_idx'
  ) then
    execute 'create index feed_comment_votes_comment_id_idx on public.feed_comment_votes (comment_id)';
  end if;
end $$;

-- Trigger functions to maintain feed_comments.vote_count
create or replace function public._feed_comment_votes_inc()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.feed_comments
    set vote_count = vote_count + 1
  where id = new.comment_id;

  return new;
end $$;

create or replace function public._feed_comment_votes_dec()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.feed_comments
    set vote_count = greatest(vote_count - 1, 0)
  where id = old.comment_id;

  return old;
end $$;

drop trigger if exists trg_feed_comment_votes_inc on public.feed_comment_votes;
create trigger trg_feed_comment_votes_inc
after insert on public.feed_comment_votes
for each row execute function public._feed_comment_votes_inc();

drop trigger if exists trg_feed_comment_votes_dec on public.feed_comment_votes;
create trigger trg_feed_comment_votes_dec
after delete on public.feed_comment_votes
for each row execute function public._feed_comment_votes_dec();


-- 3) RLS (simple baseline)
-- If your app writes via service role for votes, you can tighten later.
alter table public.feed_comment_votes enable row level security;

drop policy if exists "read comment votes" on public.feed_comment_votes;
create policy "read comment votes"
on public.feed_comment_votes
for select
to authenticated
using (true);

drop policy if exists "insert own comment vote" on public.feed_comment_votes;
create policy "insert own comment vote"
on public.feed_comment_votes
for insert
to authenticated
with check (voter_profile_id = auth.uid());

drop policy if exists "delete own comment vote" on public.feed_comment_votes;
create policy "delete own comment vote"
on public.feed_comment_votes
for delete
to authenticated
using (voter_profile_id = auth.uid());
