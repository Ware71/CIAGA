# CIAGA Legal & Compliance

**Operator:** James Ware — a sole trader established in England & Wales.
**Last reviewed:** 2026-07-23. **Legal document version:** `2026-07-22`.

## Executive summary

CIAGA operates as an information-society service run by a UK sole trader. As of
**2026-07-22** the app ships a working UK legal & compliance layer: public legal
pages (privacy, terms, cookies, acceptable use, copyright), a cookie-consent
banner, clickwrap terms acceptance at sign-up with a re-acceptance gate when the
terms change, and self-service data rights (download my data + delete my
account). Data deletion is implemented as **data minimisation** — it strips a
member's identity and contact/device data while retaining shared golf records
(rounds, scorecards, ledgers, posts), which is documented truthfully in the
Privacy Policy and Terms.

The remaining work is mostly **non-code, administrative** and should be closed
before any launch beyond the current trusted group. The headline outstanding
items are: **ICO registration + the annual data-protection fee**, a **solicitor
review of the real-money prize pots** against the Gambling Act, publishing a
**geographic address for service**, and **actually browser-testing** the legal
flows (they shipped to production untested). This document is the register that
tracks all of it. The rendered pages and `apps/web/lib/legal.ts` remain the
authoritative legal text; this file is the index and status tracker.

Suggested review cadence: **quarterly**, plus whenever the Terms change, a new
data category or sub-processor is added, or the product moves toward a wider
launch.

---

> The section below is the candid internal register. It is blunt about gaps and
> flags where shipped features have not yet been tested.

## 1. Our legal obligations

The regimes that apply to CIAGA as a UK-operated app that stores personal data,
hosts user content, and records money owed between members.

| Regime | What it requires of us |
|---|---|
| **UK GDPR + Data Protection Act 2018** | A lawful basis for each processing purpose; a transparent privacy notice; honouring data-subject rights (access, portability, erasure, rectification, objection); safeguards for international transfers; and **registration with the ICO + payment of the annual data-protection fee**. |
| **PECR 2003** | Consent (or the strictly-necessary exemption) for cookies and local storage; consent for push notifications and any electronic marketing. |
| **Electronic Commerce (EC Directive) Regs 2002** | Disclose the operator's identity **and a geographic address**, plus a contact email, in an easily accessible form. |
| **Consumer Rights Act 2015 / Consumer Contracts Regs 2013** | Terms must be fair, transparent, and presented before the user commits. |
| **Gambling Act 2005** | Determine whether the fantasy prize pots / points amount to gambling or a lottery. Our position: points have no monetary value, the operator handles no payments, and prize pots are run by the society itself — so it is not a gambling service. This position needs professional confirmation. |
| **Online Safety Act 2023** | Moderation and reporting for user-to-user content (covered by the Acceptable Use Policy); watch the direction of travel on age assurance and phased Ofcom duties. |
| **Copyright — notice & takedown** | A working notice-and-takedown route for hosted content, under the UK EC Directive Regs and (for reach into the US) DMCA §512. |
| **Age** | Minimum age **18** to hold an account. |

## 2. What we've achieved

Everything below **shipped to production on 2026-07-22** (merge `3418b44`,
migration `20260722000000` applied to staging + production) but has **never been
browser-tested** — see the HIGH item in §3.

| Obligation | What we built | Key files | Status |
|---|---|---|---|
| Transparency notice, cookie info, terms, AUP, takedown | Public legal pages `/privacy`, `/terms`, `/cookies`, `/acceptable-use`, `/copyright`, and a `/legal` hub, on the marketing site | `apps/web/app/{privacy,terms,cookies,acceptable-use,copyright,legal}/page.tsx`, shell `apps/web/components/legal/LegalPage.tsx`, footer `apps/web/components/Footer.tsx`, config `apps/web/lib/legal.ts` | Live, untested |
| PECR cookie consent | Consent banner with "strictly necessary" (always on) + a reserved "analytics" category (off, unused today); choice stored in `localStorage` `ciaga.cookie.consent`; re-openable from the profile | `apps/app/components/CookieConsent.tsx`, mounted in `apps/app/app/layout.tsx` | Live, untested |
| Consumer terms + informed acceptance | Required clickwrap checkbox at sign-up; a blocking re-acceptance gate when the terms version changes; acceptance recorded per profile (`terms_version`, `terms_accepted_at`) | `apps/app/app/auth/page.tsx`, `apps/app/components/legal/AcceptTermsGate.tsx`, `apps/app/app/api/account/{terms-status,accept-terms}/route.ts` | Live, untested |
| Right of access + portability | "Download my data" — a best-effort JSON bundle of the member's profile, rounds, handicap history, calendar, feed activity, fantasy, ledger, invites, follows; push-subscription crypto keys redacted | `apps/app/app/api/account/export/route.ts`, UI `apps/app/components/profile/AccountLegalSection.tsx` | Live, untested |
| Right to erasure (as minimisation) | "Delete my account" — reduces identity (`"James Ware"` → `"J.Ware"`), nulls email/avatar/auth link, sets `deleted_at`, hard-deletes private/contact/device rows (push subs, notifications, calendar, follows, invites, reports), deletes the auth user last. **Retains** shared rounds/scores/ledgers and the member's own posts, re-attributed to the reduced name. Admins cannot self-delete. Documented in Privacy §9 + Terms §12/§13 | `apps/app/app/api/account/delete/route.ts`, UI `apps/app/components/profile/AccountLegalSection.tsx` | Live, untested |
| Operator identity + sub-processor disclosure | Operator name/descriptor, contact email, governing law, minimum age, and the sub-processor list, all from one config | `apps/web/lib/legal.ts` | Live (values partly TODO — see §3) |
| Non-gambling framing | Terms §5 (points have no monetary value; not a betting/gaming/gambling service) + §6 (operator takes/holds/transfers no payments; prize competitions are society-run) | `apps/web/app/terms/page.tsx` | Live — **not yet legally reviewed** |
| Schema support | `profiles.deleted_at`, `terms_accepted_at`, `terms_version` | `supabase/migrations/20260722000000_account_legal_fields.sql` | Applied (staging + prod) |

## 3. What's still needed + urgency

| Urgency | Item | Code / non-code | Notes |
|---|---|---|---|
| **HIGH** | ICO registration + annual data-protection fee | Non-code | We are a data controller processing personal data; registration is statutory and likely already due. Register at ico.org.uk; keep the reference for the record. |
| **HIGH** | Gambling Act review of the real-money prize pots | Non-code (may drive code) | Confirm the "society-run / operator handles no payments / points have no cash value" framing holds, given the prize-pot ledger feature actually ships. Get a solicitor to sign it off before any wider launch. |
| **HIGH** | Publish a geographic/postal address for service | Non-code + 1 line | EC Directive Regs require a geographic address; today we say "available on request", which is arguably non-compliant. Decide a business/forwarding address and set `POSTAL_ADDRESS` in `apps/web/lib/legal.ts`. |
| **HIGH** | Browser-test the whole legal flow end-to-end | QA | Consent banner, clickwrap, re-acceptance gate, data export, and account deletion all shipped to prod untested. A broken erasure or export path is itself a compliance failure. Use the `/verify` skill. |
| **MED** | Domain consistency + live mailbox | Code + ops | Reconcile `ciagagolf.com` vs `ciaga.golf` in app code (e.g. the VAPID `mailto:`) and confirm `privacy@ciagagolf.com` is a real, monitored inbox. |
| **MED** | Confirm the exact legal name | Non-code | `OPERATOR_NAME` in `apps/web/lib/legal.ts` is still flagged `TODO: confirm exact legal name`. |
| **MED** | Age assurance decision | Product + legal | Age is self-declaration only (no DOB / no separate age checkbox); enforced solely via the Terms checkbox. Decide whether the Online Safety Act trajectory warrants stronger age assurance. |
| **MED** | Solicitor review of the Terms | Non-code | In particular the £100 liability cap and overall enforceability. |
| **LOW** | Set `NEXT_PUBLIC_WEB_URL` in Vercel | Ops | Optional; the `https://ciagagolf.com` fallback is already correct. |
| **LOW** | Server-side consent record | Code | Consent is stored in `localStorage` only. Fine while only strictly-necessary cookies exist; revisit when analytics/marketing cookies are added. |
| **LOW** | Written data-retention schedule | Non-code | Document what we keep and for how long, to back the Privacy Policy's retention section. |

## 4. Future roadmap (when / what)

- **Before any wider / public launch beyond the trusted group** — treat as launch
  blockers: ICO registration, published postal address, browser-test of all legal
  flows, and a solicitor sign-off on the prize pots + Terms.
- **When analytics / marketing cookies are introduced** — activate the reserved
  "analytics" consent category (currently off and unused), add a server-side
  consent record, and update the Cookie Policy accordingly.
- **When the user base grows beyond the trusted circle** — add a per-profile
  calendar-privacy setting (see `docs/SECURITY_AUDIT_2026-07-03.md` recommendation
  #4) and reconsider the app's open-by-default data model.
- **If the operator ever handles member money directly** (instead of society-run
  pots) — redo the gambling + payment-services analysis; keep the Terms §6 framing
  intact until then.
- **Annually** — renew the ICO fee; review and, if the Terms change materially,
  re-version them by bumping `LEGAL_VERSION` in `apps/web/lib/legal.ts` **and**
  `CURRENT_TERMS_VERSION` in `apps/app/lib/legal.ts` together (this fires the
  re-acceptance gate); refresh the sub-processor list.
- **Ongoing** — monitor Ofcom's phased Online Safety Act duties and whether any
  size thresholds bring additional obligations.

## 5. Key facts / references

- **Operator:** James Ware, sole trader, England & Wales (governing law: England
  & Wales).
- **Contact:** `privacy@ciagagolf.com` (confirm the mailbox is live and
  monitored).
- **Domains:** `ciagagolf.com` (website), `app.ciagagolf.com` (app). Note the
  `ciagagolf.com` vs `ciaga.golf` inconsistency still present in app code.
- **Minimum age:** 18 (self-declared).
- **Current version:** `LEGAL_VERSION = "2026-07-22"`. **Lockstep rule:** keep
  `LEGAL_VERSION` (`apps/web/lib/legal.ts`) and `CURRENT_TERMS_VERSION`
  (`apps/app/lib/legal.ts`) equal — the re-acceptance gate compares against the
  app value.
- **Source of truth:** `apps/web/lib/legal.ts` (identity, sub-processors, version,
  and the outstanding `TODO` markers).
- **Sub-processors:** Supabase (auth, DB, storage, transactional email — EU/UK
  region, US-HQ), Vercel (hosting/CDN — US), GolfCourseAPI (course lookups — US),
  OpenStreetMap Nominatim/Overpass (geocoding — EU), web-push delivery (Apple /
  Google / Mozilla — US/global).
- **Deletion semantics:** minimise identity (name → `"J.Ware"`, email/auth/private
  + device data removed) while retaining shared cards/rounds/posts. This is
  pseudonymisation, not full anonymisation; the Privacy Policy + Terms offer a
  "contact us to go further" route.
- **Shipped:** 2026-07-22, merge `3418b44`, migration `20260722000000` (staging +
  production).

## 6. Maintenance

Keep this register current. Update it on **every** change that touches legal
posture — new data category, new sub-processor, a Terms revision, or closing one
of the §3 items. To re-version the Terms, bump both version constants in lockstep
(see §4) so users are re-prompted to accept. This document is the tracker; the
rendered pages under `apps/web/app/*` and the config in `apps/web/lib/legal.ts`
are the authoritative legal text.
