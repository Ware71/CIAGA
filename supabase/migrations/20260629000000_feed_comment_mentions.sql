-- Persist the set of mentioned profiles on a comment so the client can
-- colorize @handles in blue and we have a durable record of comment mentions.
-- Additive + idempotent.

alter table public.feed_comments
  add column if not exists mentioned_profile_ids uuid[] not null default '{}';
