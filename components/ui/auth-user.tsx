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

  useEffect(() => {
    // initial load
    supabase.auth.getUser().then(({ data }) => {
      setUser((data.user as any) ?? null);
      setLoading(false);
    });

    // listen for changes (login/logout)
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
  };

  if (loading) {
    return (
      <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
    );
  }

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
    <div className="flex items-center gap-3">
      <div className="hidden sm:flex flex-col items-end">
        <span className="text-[10px] text-muted-foreground">Signed in</span>
        <span className="text-xs font-medium max-w-[140px] truncate">
          {name}
        </span>
      </div>
      <Avatar className="h-8 w-8">
        <AvatarImage src={user.user_metadata?.avatar_url || ''} />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <Button
        size="sm"
        variant="ghost"
        className="text-xs px-2"
        onClick={handleSignOut}
      >
        Sign out
      </Button>
    </div>
  );
}
