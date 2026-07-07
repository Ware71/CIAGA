# CIAGA Security Audit — 2026-07-03

Full-project security review: app attack surface (159 API routes), Supabase layer
(175 migrations, RLS, SECURITY DEFINER functions), secrets, dependencies, and
client-side exposure. Findings below were hand-verified against the code and the
live staging database, not just pattern-matched.

## Verdict

Overall posture is **good**. No secrets are in git, RLS coverage is comprehensive,
admin APIs are enforced server-side, and an earlier cleanup (migration
`20260121072925`) had already revoked anonymous access to round data. The issues
found were medium/low severity and have been fixed in this pass (see "Fixed" below).

## What was checked and came back clean

- **Secrets in git**: no `.env*` file is tracked now or was ever committed
  (verified via `git ls-files` and `git log --diff-filter=A`). `.gitignore` covers
  `.env*`. One exploration pass reported ".env.local committed to repo" — that was
  a **false alarm**; the files exist locally only.
- **RLS**: all ~60 tables have RLS enabled. Zero `GRANT ... TO anon` statements.
  Mutations go through `service_role` (API routes); authenticated users get
  SELECT-only grants.
- **SECURITY DEFINER functions**: all 89 set `search_path` — no search-path
  hijack vector.
- **SQL injection / XSS**: no raw SQL concatenation (PostgREST parameterized
  throughout); the two `dangerouslySetInnerHTML` uses are static CSS, no user input.
- **Anonymous access to round data**: `rounds`, `round_score_events`, etc. return
  `401 permission denied` with the anon key (verified live against staging).
  Table grants were revoked from `anon` in `20260121072925`. `courses` /
  `course_tee_boxes` / `course_tee_holes` remain anon-readable — intentional,
  pure reference data.
- **Next.js CVE-2025-29927** (middleware auth bypass): affected <14.2.25 / <15.2.3;
  this repo runs 16.0.7 (app) and 16.1.6 (web) — not affected. Middleware here also
  isn't used as an auth gate (only session cookie refresh), so the class of bug
  doesn't apply.
- **Admin APIs**: all `/api/admin/*` routes validate the Bearer token via
  `admin.auth.getUser()` and require `profiles.is_admin` server-side.
- **Sandbox routes** (`/api/sandbox/*` — impersonate, reset-db, pull-from-prod):
  gated on `NEXT_PUBLIC_APP_ENV === "sandbox"`; unavailable in prod builds.
- **Cron routes**: require `Bearer ${CRON_SECRET}`.
- **Web push**: VAPID private key server-only; `push_subscriptions` RLS is
  owner-only; dead subscriptions pruned.
- **Realtime**: all 4 published tables (`user_notifications`,
  `competition_leaderboard_entries`, `season_standings_entries`,
  `event_playoff_scores`) have RLS.
- **Prod scripts** (`scripts/invitational-backfill/`): load credentials from an
  untracked `.env.prod`; hardcoded IDs; manual CLI steps. Acceptable for one-offs.

## Findings fixed in this pass

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | Medium | Calendar RPCs (`get_calendar_rounds`, `get_calendar_round_info`) are SECURITY DEFINER, called from the browser, and returned full participant scores for **any** round ID to **any** logged-in user | Migration `20260706000000_security_hardening.sql`: new `can_view_calendar_round()` check — viewer must be a participant, follow a participant, share an active Majors group with one, or have added one to a calendar circle. Public/link rounds stay visible to all signed-in users. `get_calendar_group_events` now verifies the profile belongs to the caller. `EXECUTE` revoked from `PUBLIC`/`anon` on all four functions. |
| 2 | Medium | Stale `TO anon ... USING (true)` policies on 6 round tables (inert today because grants were revoked, but would silently reopen anon reads if a grant ever returned) | Same migration drops the six stale policies (`rounds: read`, `round_participants: read`, `round_score_events: read`, and the three snapshot tables). |
| 3 | Medium | No security headers on either app | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `HSTS`, `Permissions-Policy` added via `headers()` in `apps/app/next.config.mjs` and `apps/web/next.config.ts`. Geolocation left enabled in the app (nearby-courses uses it). |
| 4 | Medium | Admin upload routes parsed files with no size cap (`bulk-load`, `season-import/preview`, `season-import/import`, `bulk-course-upsert-csv`) | 10 MB limit, HTTP 413 on excess, in all four routes. |
| 5 | Low | Money amounts accepted unvalidated (`charges`, `charges/[chargeId]/assign` override, `extras`, `prize-pots` entry fee) — negative, `1e308`, or sub-cent values reached the ledger | New `lib/validation/money.ts` (`parseMoneyAmount`: finite, > 0, ≤ 100,000, rounded to 2 dp) applied to all four routes. |
| 6 | Low | Secret comparisons used `!==` (timing side-channel): `CRON_SECRET` in both cron routes, `ADMIN_API_KEY` in `bulk-course-upsert-csv` | New `lib/auth/safeCompare.ts` (SHA-256 + `crypto.timingSafeEqual`) used in all three. |

## Accepted risks / by design (no change)

- **Mutual calendar visibility**: any authenticated user can see any user's
  availability blocks (`calendar_events` SELECT `USING (true)` for authenticated).
  Intentional product design; writes are service-role only.
- **Open in-app data**: leaderboards, standings, matchplay structure, historical
  stats are readable by all authenticated users — public by design for a golf
  society app.
- **Admin pages client-side guard**: `/admin` pages redirect non-admins in the
  browser; the actual admin APIs are enforced server-side, so nothing sensitive is
  reachable. Cosmetic at worst.
- **`GET .../charges` lists event charges to any authed user**: consistent with the
  app-wide openness of event data.

## Recommendations (not done in this pass)

1. **Rate limiting** — nothing is rate-limited. Highest-value targets:
   `/api/invites/redeem`, `/api/push/subscribe`, auth-adjacent endpoints.
   Options: Vercel WAF rules, Upstash `@upstash/ratelimit`, or a small middleware
   token bucket.
2. **Content-Security-Policy** — deliberately skipped here (high breakage risk
   with next-pwa/workbox). Introduce in `Report-Only` mode first.
3. **Key rotation** — rotate `GOLFCOURSE_API_KEY` and `ADMIN_API_KEY`
   periodically; both are long-lived static strings. Consider retiring
   `ADMIN_API_KEY` entirely by moving `bulk-course-upsert-csv` to the same
   Bearer + `is_admin` pattern the other admin routes use.
4. **Calendar privacy setting** — if the user base grows beyond the trusted
   group, add a per-profile `calendar_visibility` (everyone / circles / private)
   and honor it in `calendar_events` RLS and the calendar RPCs.
5. **Storage policies** — no storage bucket policies exist in migrations. If
   buckets are ever added (avatars etc.), define policies in a migration, not
   just Studio.
6. **Dependency hygiene** — `apps/app` on Next 16.0.7 vs `apps/web` on 16.1.6;
   align and keep current. Run `npm audit` in CI.

## Verification performed

- Production builds of both apps pass with the header config (`npm run build`).
- Hardening migration applied to staging (`supabase db push`).
- Anon-key REST probes against staging after migration: `rounds` /
  `round_score_events` → 401 permission denied; `get_calendar_rounds` /
  `get_calendar_round_info` RPCs → 401 permission denied (EXECUTE revoked);
  `courses` → 200 with data (intended reference data).
- End-to-end RPC test on staging with a throwaway authenticated user
  (created, tested, deleted):
  - Unconnected user: `get_calendar_rounds` for another player over a 10-year
    window → 0 rows; `get_calendar_round_info` for their private round → null.
  - After following that player: `can_view_calendar_round` → true;
    `get_calendar_rounds` → rows returned; `get_calendar_round_info` → full data.
