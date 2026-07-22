/**
 * Legal / consent helpers for the app. The canonical legal documents live on
 * the marketing site (apps/web); the app links across to them.
 *
 * Keep CURRENT_TERMS_VERSION in sync with LEGAL_VERSION in apps/web/lib/legal.ts.
 * When the Terms change materially, bump this value — signed-in users are then
 * re-prompted to accept (see AcceptTermsGate).
 */

export const WEB_URL = (
  process.env.NEXT_PUBLIC_WEB_URL || "https://ciagagolf.com"
).replace(/\/+$/, "");

/** Absolute URL to a legal page on the marketing site. */
export function legalUrl(path: string): string {
  return `${WEB_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export const LEGAL_LINKS = {
  privacy: legalUrl("/privacy"),
  terms: legalUrl("/terms"),
  cookies: legalUrl("/cookies"),
  acceptableUse: legalUrl("/acceptable-use"),
  copyright: legalUrl("/copyright"),
  legal: legalUrl("/legal"),
} as const;

/** Current Terms version users must have accepted. */
export const CURRENT_TERMS_VERSION = "2026-07-22";
