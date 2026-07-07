-- 20260707000000 dropped and recreated get_calendar_group_events to add the
-- entry-window columns. CREATE FUNCTION resets privileges to the Postgres
-- default (EXECUTE granted to PUBLIC), and that migration only re-granted to
-- `authenticated` -- it never re-revoked from PUBLIC/anon, silently reopening
-- the exact anon-callable hole 20260706000000_security_hardening.sql had just
-- closed for this function. Lock it back down.

REVOKE EXECUTE ON FUNCTION public.get_calendar_group_events(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_calendar_group_events(uuid, timestamptz, timestamptz) FROM anon;
