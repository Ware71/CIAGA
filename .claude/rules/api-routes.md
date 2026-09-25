---
paths:
  - "apps/app/app/api/**"
---

# Writing an API route

169 of 202 route handlers import `supabaseAdmin`, which uses the service-role key and
**bypasses RLS entirely**. In those routes the auth gate at the top of the handler is
the only thing between a caller and every row in the database. A forgotten gate is not
a missing feature, it is an open door.

## Use the existing gates

| Need | Helper | File |
|---|---|---|
| Admin only | `requireAdminProfile(req)` | `lib/auth/requireAdmin.ts` |
| Signed-in caller + their profile | `getAuthedProfileOrThrow(req)` | `lib/auth/getAuthedProfile.ts` |
| Server-component viewer | `requireViewerSession()` | `lib/auth/requireViewerSession.ts` |

`requireAdmin.ts` also exports `adminErrorStatus(msg)` for mapping the thrown message
to a status code. 15 routes still open-code their own `is_admin` lookup — do not add
a sixteenth.

## Secrets and redirects

- Compare tokens (`ADMIN_API_KEY`, `CRON_SECRET`) with `safeCompare` from
  `lib/auth/safeCompare.ts`, never `===`.
- Pass any user-supplied redirect through `safeNextPath` from `lib/auth/safeNextPath.ts`.

## Money and uploads

- Parse any amount with `parseMoneyAmount` from `lib/validation/money.ts`; it enforces
  `MAX_MONEY_AMOUNT`. Never trust a client-sent number.
- Enforce a byte cap on uploads before touching Storage.

## Shape

Return `NextResponse.json`. Keep the gate as the first statement in the handler so it
is visible without scrolling — a gate buried below query setup is how the open-coded
ones drifted.
