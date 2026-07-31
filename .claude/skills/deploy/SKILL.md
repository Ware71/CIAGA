---
name: deploy
description: Deploy CIAGA to production — merge develop into main (never push develop:main) and apply any pending Supabase migrations staging-first, re-linking staging afterward.
---

# Deploying CIAGA

Deploy = merge `develop` into `main` and push. Vercel deploys **production** from `main`
and **staging** (`staging.app.ciagagolf.com`) from `develop` — so **both branches must be
pushed**, or staging silently keeps serving old code.
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

## Step 2 — Merge and push BOTH branches

```
git push origin develop      # staging deploys from develop — do this first
git checkout main
git pull
git merge develop
git push                     # pushes main only (you are on main)
git checkout develop
```

If the merge conflicts, stop and resolve with the user — do not force anything.

**Why `git push origin develop` is a separate line:** the `git push` above runs while
checked out on `main`, so it pushes `main` and nothing else. Without the explicit develop
push, local commits reach production via the merge while `origin/develop` stays behind —
and staging keeps serving a build from before the work existed. This is invisible from
`main`, which looks perfectly healthy, so it surfaces later as "feature X doesn't work on
staging" with no obvious cause. It cost a long debugging session on 2026-07-31.

## Step 3 — Post-deploy

1. Confirm the CLI is linked to **staging** (`node scripts/check-db-env.js`).
2. **Confirm nothing is unpushed on either branch:**
   ```
   git log origin/develop..develop --oneline   # must be empty
   git log origin/main..main --oneline         # must be empty
   ```
3. Report what shipped: merge commit hash, **the new `origin/develop` head**, migrations
   applied (staging and prod), and any follow-ups (e.g. features not yet browser-tested).

Reporting the develop head makes a divergence visible in the deploy summary rather than
days later through a mystery bug.

## Verifying a deployment actually landed

Probe a route that only exists in the new build, and compare against a known-old route and
a bogus one — `404` on all three means you're looking at the wrong host:

```
curl -s -o /dev/null -w "%{http_code}\n" https://staging.app.ciagagolf.com/api/<new-route>
```

`404` = old build still live (or the Vercel build failed — check the dashboard).
`500`/`401` = the route exists, so the new build is up.
