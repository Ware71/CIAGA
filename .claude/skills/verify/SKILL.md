---
name: verify
description: Verify a change works end-to-end by driving the app in a real browser via Playwright MCP — start the dev server, sign in, exercise the changed flow, screenshot it, and check for console errors.
---

# Verifying CIAGA changes in the browser

Typecheck, lint and tests are not verification. Run `npm run check` first — it is the
cheap gate (migration lint, typecheck both workspaces, eslint, 47 vitest files) — but a
change to `apps/app` is verified only when the affected flow has been driven in a
browser and observed working.

Note what the test suite does **not** cover: `apps/app/vitest.config.ts` includes only
`lib/**/__tests__/**`, so there are no component, route, or `apps/web` tests at all. A
green `npm run check` says the pure-logic layer is fine and nothing more.

## Environment facts

- Local dev talks to the **staging** Supabase project (`balcwdqjzouufxigszup`). Creating test rounds/scores is fine; avoid destructive edits to real group data — prefer a dedicated test group.
- Auth is email + password at `/auth` (`supabase.auth.signInWithPassword`). No OAuth, no magic link needed for sign-in.

## Credentials

Read the staging test account from `.claude/test-credentials.local.json` (gitignored):

```json
{ "email": "...", "password": "..." }
```

If the file is missing, ask the user for a staging test login and create it. Never commit credentials, never echo the password into logs or screenshots.

## Two things that will waste your time if you don't know them

**Overlays swallow the first clicks.** The app renders a CSS splash from the root
layout and a cookie-consent banner. Both sit above the page. Dismiss them
immediately after load or every subsequent click times out with no useful error —
the element is found, it just isn't reachable.

**A round cannot start on a freshly imported course.** OSM-imported courses have no
tees and no hole data. Add both on `/courses/[course_id]` first, or the round starts
with hole snapshots silently skipped and whatever you were verifying is meaningless.

## Procedure

1. **Start the dev server** (from repo root, in the background):
   ```
   npm run dev:app
   ```
   Wait until `http://localhost:3000` responds before opening the browser.
2. **Sign in** via Playwright MCP: navigate to `http://localhost:3000/auth`, fill the email and password fields, submit, and confirm redirect to `/`.
3. **Drive the changed flow** as a real user would — click through the actual UI path, don't just load the page. Exercise the specific behavior that changed, including at least one edge the change is supposed to handle.
4. **Capture evidence**: screenshot the key before/after states.
5. **Check the browser console** for errors or failed network requests during the flow.
6. **Stop the dev server** when done.
7. **Clear the evidence directory.** Playwright MCP writes console logs to
   `.playwright-mcp/`, which had accumulated 206 files before anyone looked. Keep the
   screenshots that matter, delete the rest: `rm -rf .playwright-mcp/`.

## Reporting

State plainly what was driven, what was observed, and attach/reference the screenshots. If anything failed or looked wrong, report it as a failure with the console/network detail — do not soften it.
