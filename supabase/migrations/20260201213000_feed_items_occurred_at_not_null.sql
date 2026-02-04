-- Ensure feed_items.occurred_at is always populated for stable ordering + cursor pagination.
-- Safe to run on existing environments; no-ops if the column/table doesn't exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'feed_items'
      AND column_name  = 'occurred_at'
  ) THEN
    -- Backfill NULL occurred_at values (legacy rows)
    EXECUTE 'UPDATE public.feed_items SET occurred_at = created_at WHERE occurred_at IS NULL';

    -- Prefer a UTC default going forward (ignore errors if already set)
    BEGIN
      EXECUTE 'ALTER TABLE public.feed_items ALTER COLUMN occurred_at SET DEFAULT (timezone(''utc'', now()))';
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    -- Enforce NOT NULL (ignore errors if already not null)
    BEGIN
      EXECUTE 'ALTER TABLE public.feed_items ALTER COLUMN occurred_at SET NOT NULL';
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;
END $$;
