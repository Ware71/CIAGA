-- Per-member tee name preference on group memberships
--
-- Stores a player's preferred tee as a name string (e.g. "White", "Yellow", "Red").
-- Course-agnostic so it works across different courses within a group.
-- Resolved against the actual course_tee_boxes by name (case-insensitive) when
-- pre-filling tee assignments during tee time creation.

ALTER TABLE public.major_group_memberships
  ADD COLUMN preferred_tee_name text;

COMMENT ON COLUMN public.major_group_memberships.preferred_tee_name IS
  'Player''s preferred tee box name (e.g. "White", "Yellow", "Red"). Matched case-insensitively
   against course_tee_boxes.name when pre-filling tee assignments at tee time creation.';
