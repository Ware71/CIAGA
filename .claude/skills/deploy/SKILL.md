---
name: deploy
description: Deploy CIAGA to production — merge develop into main (never push develop:main) and apply any pending Supabase migrations staging-first, re-linking staging afterward.
---

# Deploying CIAGA

Deploy = merge `develop` into `main` and push. Vercel deploys from `main`.
**NEVER run `git push origin develop:main`.** Always go through a real merge on a local `main` checkout.

## Preconditions

1. On `develop` with a clean working tree (`git status`).
2. `npm run build` passes.
3. Confirm with the user which commits are going out (`git log main..develop --oneline`).

## Step 1 — Migrations (only if `supabase/migrations/` has new files since last deploy)

Order is **staging first, then production**. Before every push, confirm the linked project with `node scripts/check-db-env.js`.

1. Confirm linked to staging (`balcwdqjzouufxigszup`), then `npx supabase db push`.
2. Verify the migration applied cleanly on staging.
3. `npx supabase link --project-ref jcmkyxlfyrhkgeszefjb` (production), then `npx supabase db push`.
4. **Immediately re-link staging**: `npx supabase link --project-ref balcwdqjzouufxigszup`. The CLI must always be left linked to staging.

Gotcha: if a migration drops and recreates a function, `DROP FUNCTION` resets EXECUTE grants — the migration must re-grant them.

## Step 2 — Merge

```
git checkout main
git pull
git merge develop
git push
git checkout develop
```

If the merge conflicts, stop and resolve with the user — do not force anything.

## Step 3 — Post-deploy

1. Confirm the CLI is linked to **staging** (`node scripts/check-db-env.js`).
2. Report what shipped: merge commit hash, migrations applied (staging and prod), and any follow-ups (e.g. features not yet browser-tested).
