'use client';

import { useCallback, useEffect, useState } from 'react';
import { LEGAL_LINKS } from '@/lib/legal';

const CONSENT_KEY = 'ciaga.cookie.consent';
const CONSENT_VERSION = '1';
const OPEN_EVENT = 'ciaga:open-cookie-preferences';

type Consent = {
  version: string;
  choice: 'all' | 'necessary' | 'custom';
  analytics: boolean;
  at: string;
};

/** Re-open the cookie preferences from anywhere (e.g. the profile screen). */
export function openCookiePreferences() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function readConsent(): Consent | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Consent;
    if (parsed?.version !== CONSENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Cookie consent banner. Today CIAGA sets only strictly-necessary cookies, so
 * this is informational + future-ready: the "Analytics" category is off by
 * default and gates nothing yet. Choice is stored in localStorage. Users can
 * re-open it via openCookiePreferences() (wired to "Cookie preferences" in the
 * profile screen).
 */
export function CookieConsent() {
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    // Show the banner on first visit (no valid stored choice).
    if (!readConsent()) setOpen(true);

    const onOpen = () => {
      const existing = readConsent();
      setAnalytics(existing?.analytics ?? false);
      setManage(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const save = useCallback((choice: Consent['choice'], analyticsOn: boolean) => {
    const consent: Consent = {
      version: CONSENT_VERSION,
      choice,
      analytics: analyticsOn,
      at: new Date().toISOString(),
    };
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    } catch {
      // ignore storage errors
    }
    setOpen(false);
    setManage(false);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[2147482000] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div className="relative w-full sm:max-w-md rounded-t-3xl sm:mb-4 sm:rounded-3xl border-t sm:border border-emerald-900/60 bg-[#071c10] p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <h2 className="text-base font-semibold text-[#f5e6b0]">Cookies</h2>
        <p className="mt-2 text-sm text-emerald-100/85">
          We use only the cookies needed to keep you signed in and run the app —
          no advertising or tracking. See our{' '}
          <a
            href={LEGAL_LINKS.cookies}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-[#f5e6b0]"
          >
            Cookie Policy
          </a>
          .
        </p>

        {manage && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2">
              <div>
                <div className="text-sm text-emerald-50">Strictly necessary</div>
                <div className="text-[11px] text-emerald-200/70">
                  Required to sign in and run the app.
                </div>
              </div>
              <span className="text-[11px] uppercase tracking-wide text-emerald-200/70">
                Always on
              </span>
            </div>
            <label className="flex items-center justify-between rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2">
              <div>
                <div className="text-sm text-emerald-50">Analytics</div>
                <div className="text-[11px] text-emerald-200/70">
                  Not used today. Reserved for future, optional analytics.
                </div>
              </div>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                className="h-4 w-4 accent-emerald-600"
              />
            </label>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => save('all', true)}
            className="flex-1 rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-2.5 text-sm font-medium transition-colors"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={() => save('necessary', false)}
            className="flex-1 rounded-xl border border-emerald-900/70 bg-[#0b3b21]/70 hover:bg-[#0b3b21] px-4 py-2.5 text-sm font-medium transition-colors"
          >
            Reject non-essential
          </button>
          {manage ? (
            <button
              type="button"
              onClick={() => save('custom', analytics)}
              className="flex-1 rounded-xl border border-emerald-900/70 bg-[#0b3b21]/70 hover:bg-[#0b3b21] px-4 py-2.5 text-sm font-medium transition-colors"
            >
              Save choices
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setManage(true)}
              className="flex-1 rounded-xl border border-emerald-900/70 bg-[#0b3b21]/70 hover:bg-[#0b3b21] px-4 py-2.5 text-sm font-medium transition-colors"
            >
              Manage
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
