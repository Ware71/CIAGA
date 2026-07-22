// -----------------------------------------------------------------------------
// Legal / compliance configuration — single source of truth for the operator
// identity and shared values used across the legal pages.
//
// ⚠ BEFORE PUBLISHING, confirm the values marked TODO:
//   - CONTACT_EMAIL: use a dedicated address on the real domain (not a personal
//     inbox). The codebase currently mixes `ciagagolf.com` and `ciaga.golf` —
//     pick one and make it consistent.
//   - POSTAL_ADDRESS: the UK Electronic Commerce (EC Directive) Regulations 2002
//     require an information-society service to give a geographic address. If you
//     don't want to publish a home address, use a business/forwarding address.
// -----------------------------------------------------------------------------

/** Public product name. */
export const SITE_NAME = "CIAGA";

/** The legal operator. Sole trader = the individual's own name. */
export const OPERATOR_NAME = "James Ware"; // TODO: confirm exact legal name
export const OPERATOR_DESCRIPTOR =
  "a sole trader established in the United Kingdom";

/** Published contact point for legal / privacy matters. */
export const CONTACT_EMAIL = "privacy@ciagagolf.com"; // TODO: confirm

/** Geographic address for service. Leave "" to fall back to "available on request". */
export const POSTAL_ADDRESS = ""; // TODO: supply before launch (see note above)

/** Marketing site + app URLs. */
export const WEB_URL = "https://ciagagolf.com";
export const APP_URL = "https://app.ciagagolf.com";

/** Governing law / jurisdiction. */
export const GOVERNING_LAW = "England and Wales";

/** UK supervisory authority (for the "right to complain" clause). */
export const ICO = {
  name: "Information Commissioner's Office (ICO)",
  url: "https://ico.org.uk",
  helpline: "0303 123 1113",
};

/**
 * Document version + last-updated date. Bump both when the Terms change
 * materially — the app records the accepted version against each profile and
 * re-prompts users to accept when it changes (keep CURRENT_TERMS_VERSION in the
 * app in sync with this value).
 */
export const LEGAL_VERSION = "2026-07-22";
export const LAST_UPDATED = "22 July 2026";

/** Minimum age to hold an account (see Terms). Recommended 18 — confirm. */
export const MINIMUM_AGE = 18;

/**
 * Third-party processors ("sub-processors") that handle personal data on the
 * operator's behalf. Verified against the codebase + environment.
 */
export const SUBPROCESSORS: {
  name: string;
  purpose: string;
  location: string;
}[] = [
  {
    name: "Supabase",
    purpose:
      "Account authentication, database, file storage (avatars, post images) and transactional emails (sign-up, password reset, invites).",
    location: "EU / UK region; company US-headquartered",
  },
  {
    name: "Vercel",
    purpose: "Application and website hosting and content delivery.",
    location: "United States (global edge network)",
  },
  {
    name: "GolfCourseAPI",
    purpose: "Golf course and tee information lookups.",
    location: "United States",
  },
  {
    name: "OpenStreetMap (Nominatim / Overpass)",
    purpose:
      "Geocoding and nearby-course search. Receives approximate device location only when you use the course search.",
    location: "European Union",
  },
  {
    name: "Web push delivery (Apple, Google, Mozilla)",
    purpose:
      "Delivering push notifications you have opted into, via your browser's push service.",
    location: "United States / global",
  },
];
