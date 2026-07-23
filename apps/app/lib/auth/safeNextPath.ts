/**
 * Sanitise a `?next=` redirect target.
 *
 * Only same-origin absolute paths are allowed. Anything else — a full URL, a
 * protocol-relative `//evil.com`, a backslash variant that some browsers
 * normalise to `//` — is rejected so `?next=` can't be used as an open redirect.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;

  // Must be a rooted path, and must not begin a new authority.
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;

  // Reject anything that parses as an absolute URL (scheme present).
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return fallback;

  return raw;
}
