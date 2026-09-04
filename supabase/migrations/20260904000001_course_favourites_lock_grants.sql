-- course_favourites: revoke the grants nobody asked for.
--
-- 20260904000000 granted exactly select/insert/delete to authenticated. Checking
-- the result afterwards showed authenticated AND anon both holding the full set
-- — insert, select, update, delete, truncate, references, trigger.
--
-- Those come from a schema-wide ALTER DEFAULT PRIVILEGES on public, so every new
-- table lands wide open regardless of what its own migration says. It matters
-- here because TRUNCATE is not subject to row-level security: RLS would stop any
-- signed-in user reading or deleting someone else's favourites row by row, and
-- then let them drop the whole table's contents in one statement. anon holding
-- write grants at all is its own problem.
--
-- So: revoke everything, then re-grant only what the feature needs. The same
-- condition applies to courses and course_tee_boxes, which have carried it since
-- the initial schema — deliberately left alone here rather than widening this
-- migration into an audit.

revoke all on public.course_favourites from anon;
revoke all on public.course_favourites from authenticated;

-- A favourite has no mutable fields, so there is no update. No truncate, ever.
grant select, insert, delete on public.course_favourites to authenticated;
grant all on public.course_favourites to service_role;
