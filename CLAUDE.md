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

## Rules

- Don't touch `.env` files or secrets without asking.
- Don't add dependencies unless asked.

## Gotchas

- Postgres: `DROP FUNCTION` + recreate resets EXECUTE grants — re-grant after replacing any function that non-default roles call (bit us in the 2026-07 security audit).
