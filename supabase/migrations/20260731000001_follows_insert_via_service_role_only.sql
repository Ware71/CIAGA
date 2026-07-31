-- Follows may only be created server-side, so the follow notification cannot be
-- silently skipped. See docs/notifications.md §5 (Tier 3).
--
-- BACKGROUND. `new_follower` is written by POST /api/follows, which inserts with
-- the service role and then calls notifyNewFollower(). But `authenticated` also
-- held a direct INSERT grant, so any client still running an older bundle wrote
-- to public.follows itself and never touched the route. The follow succeeded and
-- the notification simply never happened — no error, nothing in the logs, and
-- nothing to distinguish it from a working follow. That is exactly what bit us:
-- 14 follows on staging with zero notifications while the server was correct.
--
-- Revoking the grant makes that failure LOUD instead of silent: a stale client
-- gets a permission error it can surface, rather than half-completing.
--
-- Deliberately INSERT only. DELETE (unfollow) stays client-side — it emits no
-- notification, so there is nothing to bypass.
--
-- The follows_insert_* RLS policies are left in place. They are now unreachable
-- for `authenticated` (the grant is checked first) but are the correct backstop
-- if the grant is ever restored, and dropping them would lose that intent.

REVOKE INSERT ON TABLE public.follows FROM authenticated;
REVOKE INSERT ON TABLE public.follows FROM anon;

COMMENT ON TABLE public.follows IS
  'Follow graph. INSERT is service_role only — go through POST /api/follows so the new_follower notification is always emitted. DELETE (unfollow) remains client-side.';
