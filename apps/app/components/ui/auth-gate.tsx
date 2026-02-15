'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

// Renders children only when the user is signed in.
// Otherwise redirects to the custom auth page.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/auth');
        return;
      }
      setSignedIn(true);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setSignedIn(false);
        router.replace('/auth');
        return;
      }
      setSignedIn(true);
      setLoading(false);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [router]);

  if (loading || !signedIn) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#042713]">
        <div className="h-8 w-8 rounded-full bg-emerald-900/40 animate-pulse" />
      </div>
    );
  }

  return <>{children}</>;
}
