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

- `npm run check` — the gate: migration lint, typecheck (both workspaces), eslint,
  and the 47 vitest files. Run it before proposing a change is done.
- `npm run dev:app` / `npm run dev:web` — dev servers (app runs on localhost:3000)
- `npm run build:app` / `npm run build:web` / `npm run build` (both)
- Individually: `npm run typecheck`, `npm run lint`, `npm run test`,
  `npm run lint:migrations`

`npm run check` does not cover the UI: `apps/app/vitest.config.ts` includes only
`lib/**/__tests__/**`, so there are no component, route or `apps/web` tests. Use the
`/verify` skill to drive real flows in a browser.

## Database environments

| Env | Supabase project ref |
|---|---|
| staging | `balcwdqjzouufxigszup` |
| production | `jcmkyxlfyrhkgeszefjb` |

Rules:

- The CLI must ALWAYS be left linked to **staging**. If a task requires linking to production, re-link staging immediately afterward. A `Stop` hook enforces this.
- Migrations apply **staging first, then production** — never prod-first, never prod-only.
- Before any `npx supabase db push`, confirm the target with `node scripts/check-db-env.js`.

`node scripts/migration-status.mjs` (or `/migration-status`) reports what has reached
production without changing the link. `.claude/db-environments.json` is the
machine-readable copy that `check-db-env.js` reads — keep the two in step.

## Deploy

Deploy = merge `develop` into `main` and push. **Never** push `develop:main` directly. Use the `/deploy` skill, which encodes the full ritual including migration ordering.

## Automation

Some rules here are enforced by hooks rather than trusted to be read (`.claude/settings.json`):

| Hook | Effect | Override |
|---|---|---|
| `PreToolUse` | Blocks any `git push` whose refspec targets `main` | `CIAGA_ALLOW_DIRECT_PUSH=1` |
| `Stop` | Fails the turn if the Supabase CLI is left linked to production | `CIAGA_ALLOW_PROD_LINK=1` |
| `PostToolUse` | Runs `scripts/lint-migrations.mjs` on any migration you write | fix the migration |
| `SessionStart` | Prints linked project, pending migrations, dirty paths | — |

Topic guidance loads only when you open matching files, so it costs nothing otherwise
(`.claude/rules/`): `supabase-migrations.md`, `api-routes.md`, `realtime.md`,
`fantasy.md`. Read the relevant one before working in those areas.

## Workflow

- `docs/linear-agent-workflow.md` — **proposal, not yet implemented**: driving Claude Code agents from Linear issues (MCP, cloud routines, PRs + CI).

## Rules

- Don't touch `.env` files or secrets without asking.
- Don't add dependencies unless asked.

## Gotchas

- Postgres: `DROP FUNCTION` + recreate resets EXECUTE grants — re-grant after replacing any function that non-default roles call (bit us in the 2026-07 security audit).
- The DEV panel's **Pull from Production** derives its table list from the live schema (`sandbox_schema_graph()`), so it never needs updating when a table is added. But `sandbox_full_reset_database()` is gated on a `ciaga_system_settings.sandbox_reset_enabled` flag that the migration deliberately does **not** insert — production is inert by design. Arm a new/reset staging database with `node scripts/enable-sandbox-reset.mjs --apply`, or the pull fails with "disabled on this database".
- The pull needs `NEXT_PUBLIC_APP_ENV=sandbox` plus `PROD_SUPABASE_URL` / `PROD_SUPABASE_SERVICE_ROLE_KEY`. `apps/app/.env.local` carries none of them, so it only works on the deployed sandbox, not locally.
