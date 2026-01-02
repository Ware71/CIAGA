'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';
import { ensureProfile } from '@/lib/profile';
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

type MenuPos = { top: number; right: number; width: number };

export function AuthUser() {
  const router = useRouter();

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);

  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [adminLoaded, setAdminLoaded] = useState<boolean>(false);

  useEffect(() => setMounted(true), []);

  // Step 4: Safety net — if there's a pending invite, force onboarding BEFORE ensureProfile runs
  const handlePendingInviteOrEnsure = async (u: User) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (accessToken) {
      try {
        const res = await fetch('/api/invites/pending', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const j = await res.json();

        if (j?.pending) {
          router.replace('/onboarding/set-password');
          return;
        }
      } catch (e) {
        // If this fails, fall back to ensureProfile to avoid blocking normal use
        console.warn('pending invite check failed', e);
      }
    }

    try {
      await ensureProfile(u);
    } catch (e) {
      console.warn('ensureProfile failed', e);
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const u = (data.user as any) ?? null;
      setUser(u);

      if (u) {
        await handlePendingInviteOrEnsure(u);
      }

      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = (session?.user as any) ?? null;
      setUser(u);

      if (u) {
        await handlePendingInviteOrEnsure(u);
      }
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load admin flag from profiles (used to show Admin menu item)
  useEffect(() => {
    let cancelled = false;

    async function loadAdmin() {
      setAdminLoaded(false);
      setIsAdmin(false);

      if (!user?.id) {
        if (!cancelled) setAdminLoaded(true);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('owner_user_id', user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.warn('Failed to load admin flag:', error.message);
        setIsAdmin(false);
        setAdminLoaded(true);
        return;
      }

      setIsAdmin(Boolean(data?.is_admin));
      setAdminLoaded(true);
    }

    loadAdmin();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Measure and position menu under the avatar button
  useLayoutEffect(() => {
    if (!menuOpen) return;

    const measure = () => {
      const btn = buttonRef.current;
      if (!btn) return;

      const r = btn.getBoundingClientRect();

      // Menu anchored to the right edge of the button
      setPos({
        top: r.bottom + 8,
        right: Math.max(8, window.innerWidth - r.right),
        width: 160,
      });
    };

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [menuOpen]);

  // Close on outside click + Escape
  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDownCapture = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;

      // If click is inside button or inside menu, ignore
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;

      setMenuOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDownCapture, true);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('pointerdown', onPointerDownCapture, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setMenuOpen(false);
    router.push('/');
  };

  if (loading) {
    return <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />;
  }

  if (!user) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href="/auth">Sign in</Link>
      </Button>
    );
  }

  const name = user.user_metadata?.full_name || user.email || 'Player';
  const initials = (name || '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const dropdown =
    mounted && menuOpen && pos
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed rounded-xl border bg-[#0a341c] text-xs shadow-xl z-[2147483647] pointer-events-auto"
            style={{
              top: pos.top,
              right: pos.right,
              width: pos.width,
            }}
          >
            <div className="px-3 py-2 border-b border-emerald-900/60">
              <div className="text-[10px] uppercase tracking-wide text-emerald-200/70">
                Account
              </div>
              <div className="text-[11px] text-emerald-50 truncate">{name}</div>
            </div>

            <button
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-emerald-900/60"
              onClick={() => {
                setMenuOpen(false);
                router.push('/profile');
              }}
            >
              View profile
            </button>

            {adminLoaded && isAdmin && (
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-emerald-900/60"
                onClick={() => {
                  setMenuOpen(false);
                  router.push('/admin');
                }}
              >
                Admin
              </button>
            )}

            <button
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-emerald-900/60 text-red-200"
              onClick={handleSignOut}
            >
              Sign out
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="flex items-center gap-2"
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        <div className="hidden sm:flex flex-col items-end">
          <span className="text-[10px] text-muted-foreground">Signed in</span>
          <span className="text-xs font-medium max-w-[140px] truncate">{name}</span>
        </div>

        <Avatar className="h-8 w-8 border border-emerald-200/70">
          <AvatarImage src={user.user_metadata?.avatar_url || ''} />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </button>

      {dropdown}
    </>
  );
}
