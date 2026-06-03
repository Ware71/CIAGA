CREATE OR REPLACE FUNCTION dev_clear_major_groups()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM major_groups;
END;
$$;
