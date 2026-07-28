'use client';

import { openCookiePreferences } from './CookieConsent';

/**
 * Re-opens the cookie banner in "manage" mode. Mounted in the global footer
 * (reachable from every page) and inline in the Cookie Policy.
 */
export function CookiePreferencesButton({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => openCookiePreferences()}
      className={className}
    >
      {children ?? 'Cookie preferences'}
    </button>
  );
}
