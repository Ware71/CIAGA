'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { LEGAL_LINKS } from '@/lib/legal';
import { openCookiePreferences } from '@/components/CookieConsent';

const legalItems = [
  { href: LEGAL_LINKS.privacy, label: 'Privacy Policy' },
  { href: LEGAL_LINKS.terms, label: 'Terms of Use' },
  { href: LEGAL_LINKS.cookies, label: 'Cookie Policy' },
  { href: LEGAL_LINKS.acceptableUse, label: 'Acceptable Use' },
  { href: LEGAL_LINKS.copyright, label: 'Copyright & Takedown' },
];

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * "Legal & privacy" + "Danger zone" cards for the account (self) profile screen:
 * legal links, cookie preferences, data export (GDPR access/portability) and
 * account deletion (GDPR erasure).
 */
export function AccountLegalSection() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'export' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  async function handleExport() {
    setError(null);
    setBusy('export');
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      const res = await fetch('/api/account/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ciaga-data-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setError(null);
    setBusy('delete');
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirm: true }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Deletion failed');
      await supabase.auth.signOut();
      router.replace('/auth');
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-4 pt-2 pb-6">
      {/* Legal & privacy */}
      <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--sec-muted)]">
          Legal &amp; privacy
        </div>
        <div className="mt-3 divide-y divide-[color:var(--sec-hair)]">
          {legalItems.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between py-2.5 text-sm text-[color:var(--sec-text)] hover:text-[color:var(--sec-accent)]"
            >
              <span>{l.label}</span>
              <span className="text-[color:var(--sec-muted)]">↗</span>
            </a>
          ))}
          <button
            type="button"
            onClick={openCookiePreferences}
            className="flex w-full items-center justify-between py-2.5 text-left text-sm text-[color:var(--sec-text)] hover:text-[color:var(--sec-accent)]"
          >
            <span>Cookie preferences</span>
            <span className="text-[color:var(--sec-muted)]">⚙</span>
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-red-200/70">
          Danger zone
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={busy !== null}
          className="mt-3 w-full rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] px-4 py-2.5 text-sm font-medium text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface)] disabled:opacity-50 transition-colors"
        >
          {busy === 'export' ? 'Preparing…' : 'Download my data'}
        </button>

        <button
          type="button"
          onClick={() => {
            setConfirmText('');
            setError(null);
            setConfirmOpen(true);
          }}
          disabled={busy !== null}
          className="mt-2 w-full rounded-xl border border-red-900 bg-transparent px-4 py-2.5 text-sm font-medium text-red-200 hover:bg-red-950/60 disabled:opacity-50 transition-colors"
        >
          Delete my account
        </button>

        {error && <div className="mt-3 text-xs text-[color:var(--sec-bad)]">{error}</div>}
      </div>

      {/* Delete confirmation modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[2147481000] flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => busy === null && setConfirmOpen(false)}
          />
          <div className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl border-t sm:border border-red-900/50 bg-[color:var(--ciaga-ground)] p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
            <h2 className="text-lg font-semibold text-red-200">Delete your account?</h2>
            <p className="mt-2 text-sm text-[color:var(--sec-muted)]">
              This permanently deletes your login, email, photo and private data.
              Your shared records — rounds, scores, group history and your posts —
              are kept, but your name is shortened (e.g. “J.Ware”) so shared cards
              and competitions stay intact. This cannot be undone.
            </p>
            <p className="mt-3 text-xs text-[color:var(--sec-muted)]">
              Type <strong className="text-red-200">DELETE</strong> to confirm.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoCapitalize="characters"
              className="mt-2 w-full rounded-xl border border-red-900/60 bg-[color:var(--sec-surface)] px-3 py-2 text-base outline-none placeholder:text-[color:var(--sec-muted)]"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy === 'delete'}
                className="flex-1 rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] px-4 py-2.5 text-sm font-medium hover:bg-[color:var(--sec-surface)] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={confirmText.trim().toUpperCase() !== 'DELETE' || busy === 'delete'}
                className="flex-1 rounded-xl bg-red-800 px-4 py-2.5 text-sm font-medium text-red-50 hover:bg-red-700 disabled:opacity-40 transition-colors"
              >
                {busy === 'delete' ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
