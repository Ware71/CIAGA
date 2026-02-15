'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';

type Mode = 'sign-in' | 'sign-up' | 'forgot' | 'reset';

export default function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  // Detect recovery flow from URL param or Supabase auth event
  useEffect(() => {
    if (searchParams.get('recovery') === 'true') {
      setMode('reset');
      setMsg({ text: 'Enter your new password below.', isError: false });
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('reset');
        setMsg({ text: 'Enter your new password below.', isError: false });
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    // Forgot mode — only needs email
    if (mode === 'forgot') {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        setMsg({ text: 'Please enter your email.', isError: true });
        return;
      }
      setWorking(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail);
        if (error) throw error;
        setMsg({
          text: 'Check your email for a password reset link.',
          isError: false,
        });
      } catch (err: any) {
        setMsg({ text: err?.message || 'Something went wrong.', isError: true });
      } finally {
        setWorking(false);
      }
      return;
    }

    // Reset mode — set new password
    if (mode === 'reset') {
      if (password.length < 8) {
        setMsg({ text: 'Password must be at least 8 characters.', isError: true });
        return;
      }
      if (password !== confirmPassword) {
        setMsg({ text: 'Passwords do not match.', isError: true });
        return;
      }
      setWorking(true);
      try {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setMsg({ text: 'Password updated. Redirecting...', isError: false });
        setTimeout(() => router.replace('/'), 1500);
      } catch (err: any) {
        setMsg({ text: err?.message || 'Something went wrong.', isError: true });
      } finally {
        setWorking(false);
      }
      return;
    }

    // Sign-in / sign-up
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setMsg({ text: 'Please enter your email.', isError: true });
      return;
    }
    if (password.length < 8) {
      setMsg({ text: 'Password must be at least 8 characters.', isError: true });
      return;
    }
    if (mode === 'sign-up' && password !== confirmPassword) {
      setMsg({ text: 'Passwords do not match.', isError: true });
      return;
    }

    setWorking(true);

    try {
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
        router.replace('/');
      } else {
        const { error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
        setMsg({
          text: 'Check your email for a confirmation link to complete sign-up.',
          isError: false,
        });
      }
    } catch (err: any) {
      setMsg({ text: err?.message || 'Something went wrong.', isError: true });
    } finally {
      setWorking(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setMsg(null);
    setPassword('');
    setConfirmPassword('');
  }

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 flex justify-center pt-[20vh] pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4 h-fit">
        <div className="flex flex-col items-center gap-3">
          <Image
            src="/ciaga-logo.png"
            alt="CIAGA"
            width={80}
            height={80}
            className="rounded-2xl"
            priority
          />
          <h1 className="text-xl font-semibold text-[#f5e6b0]">
            {mode === 'reset' ? 'Reset your password' : 'Welcome to CIAGA'}
          </h1>
        </div>

        {/* Mode toggle — hidden during reset/forgot */}
        {mode !== 'reset' && mode !== 'forgot' && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-2 flex gap-2">
            <button
              type="button"
              onClick={() => switchMode('sign-in')}
              className={[
                'flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                mode === 'sign-in'
                  ? 'bg-emerald-900/40 border border-emerald-200/30'
                  : 'hover:bg-emerald-900/20',
              ].join(' ')}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode('sign-up')}
              className={[
                'flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                mode === 'sign-up'
                  ? 'bg-emerald-900/40 border border-emerald-200/30'
                  : 'hover:bg-emerald-900/20',
              ].join(' ')}
            >
              Sign up
            </button>
          </div>
        )}

        {/* Message */}
        {msg && (
          <div
            className={[
              'rounded-2xl border p-3 text-sm',
              msg.isError
                ? 'border-red-900/40 bg-red-950/20 text-red-200'
                : 'border-emerald-900/70 bg-[#0b3b21]/70 text-emerald-100/90',
            ].join(' ')}
          >
            {msg.text}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 space-y-3">
            <div className="text-sm text-emerald-100/80">
              {mode === 'sign-in'
                ? 'Sign in with your email and password.'
                : mode === 'sign-up'
                  ? 'Create a new account to get started.'
                  : mode === 'forgot'
                    ? 'Enter your email to receive a reset link.'
                    : 'Choose a new password for your account.'}
            </div>

            {/* Email — shown for sign-in, sign-up, and forgot */}
            {mode !== 'reset' && (
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                autoComplete="email"
                className="w-full rounded-xl border border-emerald-900/70 bg-[#08341b] px-3 py-2 text-base outline-none placeholder:text-emerald-200/40"
              />
            )}

            {/* Password — shown for sign-in, sign-up, and reset */}
            {mode !== 'forgot' && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'reset' ? 'New password' : 'Password'}
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                className="w-full rounded-xl border border-emerald-900/70 bg-[#08341b] px-3 py-2 text-base outline-none placeholder:text-emerald-200/40"
              />
            )}

            {/* Confirm password — shown for sign-up and reset */}
            {(mode === 'sign-up' || mode === 'reset') && (
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                autoComplete="new-password"
                className="w-full rounded-xl border border-emerald-900/70 bg-[#08341b] px-3 py-2 text-base outline-none placeholder:text-emerald-200/40"
              />
            )}

            <button
              type="submit"
              disabled={working}
              className="w-full rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {working
                ? 'Working...'
                : mode === 'sign-in'
                  ? 'Sign in'
                  : mode === 'sign-up'
                    ? 'Create account'
                    : mode === 'forgot'
                      ? 'Send reset link'
                      : 'Update password'}
            </button>

            {mode === 'sign-in' && (
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="w-full text-xs text-emerald-200/60 hover:text-emerald-200/80 transition-colors"
              >
                Forgot password?
              </button>
            )}

            {mode === 'forgot' && (
              <button
                type="button"
                onClick={() => switchMode('sign-in')}
                className="w-full text-xs text-emerald-200/60 hover:text-emerald-200/80 transition-colors"
              >
                Back to sign in
              </button>
            )}
          </div>
        </form>

      </div>
    </div>
  );
}
