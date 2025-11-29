'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

type User = {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
};

export function AuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    // initial load
    supabase.auth.getUser().then(({ data }) => {
      setUser((data.user as any) ?? null);
      setLoading(false);
    });

    // listen for login/logout
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser((session?.user as any) ?? null);
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setMenuOpen(false);
  };

  if (loading) {
    return (
      <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
    );
  }

  // If not signed in: simple "Sign in" button
  if (!user) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href="/auth">Sign in</Link>
      </Button>
    );
  }

  const name =
    user.user_metadata?.full_name || user.email || 'Player';
  const initials = (name || '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative">
      {/* Avatar button */}
      <button
        type="button"
        className="flex items-center gap-2"
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        <div className="hidden sm:flex flex-col items-end">
          <span className="text-[10px] text-muted-foreground">
            Signed in
          </span>
          <span className="text-xs font-medium max-w-[140px] truncate">
            {name}
          </span>
        </div>
        <Avatar className="h-8 w-8 border border-emerald-200/70">
          <AvatarImage src={user.user_metadata?.avatar_url || ''} />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="absolute right-0 mt-2 w-40 rounded-xl border bg-[#0a341c] text-xs shadow-xl z-20">
          <div className="px-3 py-2 border-b border-emerald-900/60">
            <div className="text-[10px] uppercase tracking-wide text-emerald-200/70">
              Account
            </div>
            <div className="text-[11px] text-emerald-50 truncate">
              {name}
            </div>
          </div>
          <button
            type="button"
            className="w-full text-left px-3 py-2 hover:bg-emerald-900/60"
            onClick={() => {
              setMenuOpen(false);
              // Later you can create /profile and navigate there – for now this just closes.
              // Example when ready: router.push('/profile')
            }}
          >
            View profile
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-2 hover:bg-emerald-900/60 text-red-200"
            onClick={handleSignOut}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
