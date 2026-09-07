---
paths:
  - "supabase/migrations/**"
---

# Writing a Supabase migration

## Naming

`YYYYMMDD0000NN_short_snake_name.sql`. The `NN` counter does real ordering work —
13 migrations landed on `20260825` alone — so check the directory for the highest
existing `NN` on that date before choosing one. A duplicate prefix is a silent
ordering bug.

## Every new table, in this order

Grants are **not** additive from zero. A schema-wide `ALTER DEFAULT PRIVILEGES` on
`public` hands `anon` and `authenticated` the full set — insert, select, update,
delete, **truncate**, references, trigger — the moment the table is created. A
migration that only writes `grant select ... to authenticated` therefore changes
nothing and leaves the table wide open. `TRUNCATE` is not subject to RLS, so row
policies do not save you: a signed-in user blocked from reading one row can still
empty the table in one statement.

```sql
create table if not exists public.thing (...);

alter table public.thing enable row level security;

drop policy if exists "..." on public.thing;
create policy "..." on public.thing for select using (...);

revoke all on public.thing from anon;
revoke all on public.thing from authenticated;

grant select, insert, delete on public.thing to authenticated;
grant all on public.thing to service_role;

comment on table public.thing is '...';
```

Grant only the verbs the feature needs. Never grant `truncate`. See
`20260904000001_course_favourites_lock_grants.sql` for the worked example and the
reasoning.

## Every `DROP FUNCTION`

`DROP FUNCTION` resets `EXECUTE` grants. Recreating the function does not restore
them, so any role that called it — usually `authenticated` via PostgREST — silently
loses access.

**Re-grant in the same migration:**

```sql
grant execute on function public.fn(args) to authenticated;
```

This has been documented in three places and violated in 12 of 19 migrations that
drop a function. `scripts/lint-migrations.mjs` now checks it.

## Editing a large existing function

Fetch the live definition and patch it — never retype it from memory:

```sql
select pg_get_functiondef('public.fn(args)'::regprocedure);
```

A stale-base `CREATE OR REPLACE` has already silently dropped fields before
(`tee_snapshot.holes_count` / `name`).

## Other conventions

- `SECURITY DEFINER` functions must also `set search_path` — all 89 existing ones do.
- `drop policy if exists` before every `create policy`; `if not exists` on tables and
  indexes.
- Open with a prose comment explaining *why*, citing the incident or query it fixes.
  This is a real convention here and worth keeping.

## Applying

Staging first, then production, never prod-only. Confirm the target with
`node scripts/check-db-env.js` before every `npx supabase db push`, and leave the CLI
linked to staging afterwards. The `/deploy` skill has the full sequence.
