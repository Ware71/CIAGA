'use client';

import { supabase } from '@/lib/supabaseClient';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import Link from 'next/link';

export default function AuthPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold text-center">Sign in to CIAGA</h1>
        <Auth
          supabaseClient={supabase}
          appearance={{ theme: ThemeSupa }}
          providers={[]} // keep it simple: email login only for now
          onlyThirdPartyProviders={false}
        />
        <p className="mt-4 text-xs text-center text-muted-foreground">
          Done?{' '}
          <Link href="/" className="underline">
            Back to dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
