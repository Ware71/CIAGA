'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { LEGAL_LINKS } from '@/lib/legal';

const ACCEPT_KEY = 'ciaga.tos.accepted';

// Routes where we never show the gate (pre-auth / onboarding flows).
const SKIP_PREFIXES = ['/auth', '/onboarding', '/invite'];

/**
 * Prompts a signed-in user to accept the current Terms & Privacy Policy when
 * their recorded acceptance is missing or out of date. Fresh sign-ups that
 * already ticked the box at registration (localStorage flag) are recorded
 * silently without a second prompt.
 *
 * Mounted globally; renders nothing unless acceptance is required.
 */
export function AcceptTermsGate() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const skip = SKIP_PREFIXES.some((p) => pathname?.startsWith(p));

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const record = useCallback(async (token: string, v: string) => {
    await fetch('/api/account/accept-terms', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    try {
      localStorage.setItem(ACCEPT_KEY, v);
    } catch {
      // ignore
    }
  }, []);

  const check = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setShow(false);
      return;
    }
    try {
      const res = await fetch('/api/account/terms-status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setShow(false);
        return;
      }
      const json = await res.json();
      if (!json?.needsAcceptance) {
        setShow(false);
        return;
      }
      const current = String(json.currentVersion || '');
      setVersion(current);
      // Already consented at sign-up? Record silently, no prompt.
      let already = '';
      try {
        already = localStorage.getItem(ACCEPT_KEY) || '';
      } catch {
        already = '';
      }
      if (already && already === current) {
        await record(token, current);
        setShow(false);
        return;
      }
      setShow(true);
    } catch {
      setShow(false);
    }
  }, [getToken, record]);

  useEffect(() => {
    let cancelled = false;
    if (!cancelled) check();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') check();
      if (event === 'SIGNED_OUT') setShow(false);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [check]);

  const handleAgree = useCallback(async () => {
    setSaving(true);
    const token = await getToken();
    if (token && version) {
      await record(token, version);
    }
    setSaving(false);
    setShow(false);
  }, [getToken, version, record]);

  if (skip || !show) return null;

  return (
    <div className="fixed inset-0 z-[2147483000] flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl border-t sm:border border-emerald-900/60 bg-[#071c10] p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <h2 className="text-lg font-semibold text-[#f5e6b0]">
          We&apos;ve updated our terms
        </h2>
        <p className="mt-2 text-sm text-emerald-100/85">
          Please review and accept our{' '}
          <a
            href={LEGAL_LINKS.terms}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-[#f5e6b0]"
          >
            Terms
          </a>{' '}
          and{' '}
          <a
            href={LEGAL_LINKS.privacy}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-[#f5e6b0]"
          >
            Privacy Policy
          </a>{' '}
          to keep using CIAGA.
        </p>
        <button
          type="button"
          onClick={handleAgree}
          disabled={saving}
          className="mt-4 w-full rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-2.5 text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'I agree'}
        </button>
      </div>
    </div>
  );
}
