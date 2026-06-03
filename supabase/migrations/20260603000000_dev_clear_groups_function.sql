CREATE OR REPLACE FUNCTION dev_clear_major_groups()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE TABLE major_groups CASCADE;
END;
$$;
