-- Fix: explicitly include WHERE true to satisfy PostgREST/supabase safety checks.
-- SECURITY DEFINER ensures it runs as function owner, bypassing RLS.
CREATE OR REPLACE FUNCTION dev_clear_major_groups()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM major_groups WHERE true;
END;
$$;
