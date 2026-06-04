-- Fix: use DELETE instead of TRUNCATE CASCADE.
-- TRUNCATE CASCADE ignores ON DELETE actions and forcibly truncates all referencing tables
-- (including competitions→rounds). DELETE respects ON DELETE SET NULL on competitions,
-- leaving rounds untouched.
CREATE OR REPLACE FUNCTION dev_clear_major_groups()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM major_groups;
END;
$$;
