---
name: migration-status
description: Report which Supabase migrations have reached production and which are still pending, and which project the CLI is linked to — without changing the link.
allowed-tools: Bash(node scripts/migration-status.mjs *), Bash(node scripts/check-db-env.js), Bash(node scripts/lint-migrations.mjs *)
---

# Migration status

!`node scripts/migration-status.mjs`

## Reading this

- **Linked project** must be `staging`. If it says production, re-link before doing
  anything else: `npx supabase link --project-ref balcwdqjzouufxigszup`.
- **Not yet on main** is the set that has not reached production. Production deploys
  from `main`, so this is derived from git and needs no credentials.
- **Uncommitted migration files** cannot deploy at all. They are invisible to every
  environment until committed.

## When you need the truth from the database

The above is derived from git, which is right whenever migrations are only ever
applied through the deploy flow. To ask a database what it has actually applied:

```
node scripts/migration-status.mjs --remote
```

That runs `npx supabase migration list` against the **currently linked** project and
does not change the link. To check production you would have to link it — if you do,
re-link staging immediately afterwards, and expect the `Stop` hook to block the turn
until you have.

## Before writing a new migration

Check the highest existing `NN` for today's date — the `YYYYMMDD0000NN` counter does
real ordering work and duplicates are a silent ordering bug:

```
ls supabase/migrations | tail -5
```

Then follow the required shape in `.claude/rules/supabase-migrations.md`. The
`PostToolUse` hook runs `scripts/lint-migrations.mjs` on save and will block if the
migration drops a function without re-granting `EXECUTE`, or creates a table without
RLS and a `revoke`.
