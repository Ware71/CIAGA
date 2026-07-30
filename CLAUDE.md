# CIAGA

Golf society app: rounds, handicaps, seasons, majors, fantasy picks, calendar/scheduling.

## Layout

npm-workspaces monorepo:

- `apps/app` — the main product (Next.js PWA); almost all feature work happens here
- `apps/web` — marketing/web site
- `supabase/` — database migrations (Supabase Postgres)
- `scripts/` — utility scripts (`node scripts/check-db-env.js` prints which Supabase project is currently linked)
- `docs/` — feature docs

## Commands

- `npm run dev:app` / `npm run dev:web` — dev servers (app runs on localhost:3000)
- `npm run build:app` / `npm run build:web` / `npm run build` (both)
- Typecheck: `npx tsc --noEmit` from inside `apps/app` or `apps/web`

## Database environments

| Env | Supabase project ref |
|---|---|
| staging | `balcwdqjzouufxigszup` |
| production | `jcmkyxlfyrhkgeszefjb` |

Rules (also in `.claude/db-environments.json`):

- The CLI must ALWAYS be left linked to **staging**. If a task requires linking to production, re-link staging immediately afterward.
- Migrations apply **staging first, then production** — never prod-first, never prod-only.
- Before any `npx supabase db push`, confirm the target with `node scripts/check-db-env.js`.

## Deploy

Deploy = merge `develop` into `main` and push. **Never** push `develop:main` directly. Use the `/deploy` skill, which encodes the full ritual including migration ordering.

## Workflow

- `docs/linear-agent-workflow.md` — **proposal, not yet implemented**: driving Claude Code agents from Linear issues (MCP, cloud routines, PRs + CI).

## Rules

- Don't touch `.env` files or secrets without asking.
- Don't add dependencies unless asked.

## Gotchas

- Postgres: `DROP FUNCTION` + recreate resets EXECUTE grants — re-grant after replacing any function that non-default roles call (bit us in the 2026-07 security audit).
- The DEV panel's **Pull from Production** derives its table list from the live schema (`sandbox_schema_graph()`), so it never needs updating when a table is added. But `sandbox_full_reset_database()` is gated on a `ciaga_system_settings.sandbox_reset_enabled` flag that the migration deliberately does **not** insert — production is inert by design. Arm a new/reset staging database with `node scripts/enable-sandbox-reset.mjs --apply`, or the pull fails with "disabled on this database".
- The pull needs `NEXT_PUBLIC_APP_ENV=sandbox` plus `PROD_SUPABASE_URL` / `PROD_SUPABASE_SERVICE_ROLE_KEY`. `apps/app/.env.local` carries none of them, so it only works on the deployed sandbox, not locally.
