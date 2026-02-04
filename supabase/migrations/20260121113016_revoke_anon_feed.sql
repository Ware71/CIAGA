-- Revoke anonymous access to social/feed tables (recommended hardening).
-- RLS is good, but removing grants reduces attack surface.

revoke all on table public.feed_items from anon;
revoke all on table public.feed_item_targets from anon;
revoke all on table public.feed_reactions from anon;
revoke all on table public.feed_comments from anon;
revoke all on table public.feed_reports from anon;

revoke all on table public.follows from anon;
