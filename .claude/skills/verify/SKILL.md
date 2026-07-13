---
name: verify
description: Verify a change works end-to-end by driving the app in a real browser via Playwright MCP — start the dev server, sign in, exercise the changed flow, screenshot it, and check for console errors.
---

# Verifying CIAGA changes in the browser

Typecheck and build are not verification. A change to `apps/app` is verified only when the affected flow has been driven in a browser and observed working.

## Environment facts

- Local dev talks to the **staging** Supabase project (`balcwdqjzouufxigszup`). Creating test rounds/scores is fine; avoid destructive edits to real group data — prefer a dedicated test group.
- Auth is email + password at `/auth` (`supabase.auth.signInWithPassword`). No OAuth, no magic link needed for sign-in.

## Credentials

Read the staging test account from `.claude/test-credentials.local.json` (gitignored):

```json
{ "email": "...", "password": "..." }
```

If the file is missing, ask the user for a staging test login and create it. Never commit credentials, never echo the password into logs or screenshots.

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

## Reporting

State plainly what was driven, what was observed, and attach/reference the screenshots. If anything failed or looked wrong, report it as a failure with the console/network detail — do not soften it.
