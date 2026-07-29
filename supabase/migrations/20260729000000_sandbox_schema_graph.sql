-- ============================================================================
-- Sandbox "Pull from Production": stop the table list from drifting.
--
-- Both halves of the pull tool were hand-maintained lists that fell behind the
-- schema: TABLE_PLAN in the API route covered 60 of 95 tables, and the TRUNCATE
-- list in sandbox_full_reset_database() covered 57 (last touched 20260606000005,
-- 43 tables ago). Because the wipe is TRUNCATE ... CASCADE, the 35 uncovered
-- tables were still emptied — via their FK to profiles/events/rounds — and then
-- never repopulated. Every fantasy_*, calendar_*, shot-tracking, wolf-pick,
-- notification-preference and announcement row silently vanished on each pull.
--
-- This migration replaces both lists with something derived from the live
-- catalog:
--   1. sandbox_schema_graph()        — tables + PKs + FK edges, so the API route
--                                      can topologically sort at runtime.
--   2. sandbox_full_reset_database() — TRUNCATE built dynamically from pg_tables
--                                      rather than a literal list.
--
-- Neither can go stale when a new table lands.
-- ============================================================================


-- ─── Guard ───────────────────────────────────────────────────────────────────
-- A dynamic "truncate everything" is materially more dangerous than the literal
-- list it replaces, and this migration necessarily applies to production too
-- (staging-first, then prod — the schemas must stay in step). So the reset is
-- inert unless the database opts in.
--
-- The flag row is deliberately NOT inserted here. It is applied to staging by
-- hand, which leaves production unable to run the reset at all.
--
--   insert into ciaga_system_settings (key, value)
--   values ('sandbox_reset_enabled', 'true')
--   on conflict (key) do update set value = excluded.value, updated_at = now();

CREATE OR REPLACE FUNCTION public.sandbox_reset_is_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ciaga_system_settings
    WHERE key = 'sandbox_reset_enabled' AND value = 'true'
  );
$$;

COMMENT ON FUNCTION public.sandbox_reset_is_enabled() IS
  'True only where the destructive sandbox reset is permitted. Set the
   ciaga_system_settings row by hand on staging; never on production.';


-- ─── Tables the reset must not touch ─────────────────────────────────────────
-- Everything else in the public schema is fair game. ciaga_dump_* are one-off
-- schema-dump artefacts from the original remote_schema import, and
-- ciaga_system_settings holds the guard flag above — truncating it would
-- disable the very tool that ran it.

CREATE OR REPLACE FUNCTION public.sandbox_reset_preserved_tables()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'ciaga_system_settings',
    'ciaga_dump_columns',
    'ciaga_dump_foreign_keys',
    'ciaga_dump_objects',
    'ciaga_dump_samples',
    'ciaga_dump_views'
  ]::text[];
$$;


-- ─── Schema graph ────────────────────────────────────────────────────────────
-- Feeds the API route's runtime planner. Views are excluded (relkind 'r' only) —
-- the 8 public views must never be written to.
--
-- `nullable` on an FK edge is true only when EVERY referencing column is
-- nullable, which is what lets the planner break a cycle (or drop a reference
-- into a denylisted table) by nulling the column rather than dropping the row.

CREATE OR REPLACE FUNCTION public.sandbox_schema_graph()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  WITH base_tables AS (
    SELECT c.oid, c.relname::text AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relpersistence = 'p'
  ),
  pks AS (
    SELECT
      t.name,
      COALESCE(
        ARRAY(
          SELECT a.attname::text
          FROM pg_constraint pc
          JOIN unnest(pc.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
          JOIN pg_attribute a ON a.attrelid = pc.conrelid AND a.attnum = k.attnum
          WHERE pc.conrelid = t.oid AND pc.contype = 'p'
          ORDER BY k.ord
        ),
        ARRAY[]::text[]
      ) AS pk_columns
    FROM base_tables t
  ),
  fks AS (
    SELECT
      src.relname::text AS from_table,
      tgt_ns.nspname::text AS to_schema,
      tgt.relname::text AS to_table,
      pc.conname::text AS constraint_name,
      ARRAY(
        SELECT a.attname::text
        FROM unnest(pc.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = pc.conrelid AND a.attnum = k.attnum
        ORDER BY k.ord
      ) AS from_columns,
      -- Nullable only if every referencing column is nullable: a composite FK
      -- is satisfied-by-NULL under MATCH SIMPLE if any column is NULL, but the
      -- planner nulls all of them together, so require all to be nullable.
      NOT EXISTS (
        SELECT 1
        FROM unnest(pc.conkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = pc.conrelid AND a.attnum = k.attnum
        WHERE a.attnotnull
      ) AS nullable,
      (pc.conrelid = pc.confrelid) AS is_self
    FROM pg_constraint pc
    JOIN pg_class src ON src.oid = pc.conrelid
    JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
    JOIN pg_class tgt ON tgt.oid = pc.confrelid
    JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
    WHERE pc.contype = 'f'
      AND src_ns.nspname = 'public'
  )
  SELECT jsonb_build_object(
    'tables', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('name', name, 'pk_columns', to_jsonb(pk_columns)) ORDER BY name)
       FROM pks),
      '[]'::jsonb
    ),
    'fk_edges', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'from_table', from_table,
                'from_columns', to_jsonb(from_columns),
                -- Cross-schema targets (auth.users) are reported with their
                -- schema so the planner treats them as unreachable and nulls
                -- the reference instead of trying to order against them.
                'to_schema', to_schema,
                'to_table', to_table,
                'constraint_name', constraint_name,
                'nullable', nullable,
                'is_self', is_self
              ) ORDER BY from_table, constraint_name)
       FROM fks),
      '[]'::jsonb
    ),
    'preserved', to_jsonb(public.sandbox_reset_preserved_tables())
  );
$$;

COMMENT ON FUNCTION public.sandbox_schema_graph() IS
  'Public-schema base tables, their primary keys and their foreign-key edges.
   Consumed by /api/sandbox/pull-from-prod to build a FK-safe copy order at
   runtime instead of maintaining the order by hand.';


-- ─── Dynamic full reset ──────────────────────────────────────────────────────
-- Replaces the literal 57-table TRUNCATE from 20260606000005. Also finally
-- clears season_import_locks, whose group_id is a bare uuid with no FK
-- (20260612000002) — CASCADE never reached it, so stale locks survived every
-- "full reset" and blocked season imports in staging.

CREATE OR REPLACE FUNCTION public.sandbox_full_reset_database()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  table_list text;
BEGIN
  IF NOT public.sandbox_reset_is_enabled() THEN
    RAISE EXCEPTION
      'sandbox_full_reset_database() is disabled on this database. Set ciaga_system_settings.sandbox_reset_enabled = ''true'' to allow it.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
  INTO table_list
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relpersistence = 'p'
    AND NOT (c.relname::text = ANY (public.sandbox_reset_preserved_tables()));

  IF table_list IS NULL THEN
    RETURN;
  END IF;

  -- One statement so CASCADE resolves the whole graph atomically; ordering is
  -- irrelevant to TRUNCATE, which is why this can be alphabetical.
  EXECUTE 'TRUNCATE TABLE ' || table_list || ' CASCADE';
END;
$$;

COMMENT ON FUNCTION public.sandbox_full_reset_database() IS
  'Truncates every public base table except sandbox_reset_preserved_tables().
   Gated on the sandbox_reset_enabled setting so it cannot fire on production.';


-- ─── Grants ──────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE preserves existing grants, but sandbox_schema_graph and
-- sandbox_reset_is_enabled are new. Granting explicitly is also the safe habit
-- here: a later DROP + recreate resets EXECUTE grants (see the 2026-07 security
-- audit note in CLAUDE.md).

REVOKE ALL ON FUNCTION public.sandbox_schema_graph() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sandbox_reset_is_enabled() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sandbox_reset_preserved_tables() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sandbox_full_reset_database() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sandbox_schema_graph() TO service_role;
GRANT EXECUTE ON FUNCTION public.sandbox_reset_is_enabled() TO service_role;
GRANT EXECUTE ON FUNCTION public.sandbox_reset_preserved_tables() TO service_role;
GRANT EXECUTE ON FUNCTION public.sandbox_full_reset_database() TO service_role;
