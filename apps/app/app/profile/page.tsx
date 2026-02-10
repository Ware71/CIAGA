"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import ProfileScreen from "@/components/profile/ProfileScreen";
import { ensureProfile } from "@/lib/profile";

type User = {
  id: string;
  email?: string;
};

type ProfileRow = {
  id: string;
  owner_user_id?: string | null;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

export default function ProfilePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const u = (data.user as any) ?? null;

        if (!alive) return;

        setUser(u);
        if (!u) {
          setLoading(false);
          return;
        }

        // ✅ Ensure profile exists / fill blanks (no client-side insert/update here)
        try {
          await ensureProfile(u);
        } catch (e) {
          console.warn("ensureProfile failed:", e);
          // continue anyway; attempt to load
        }

        // ✅ Load profile row by ownership (Model B)
        const { data: p0, error: pErr } = await supabase
          .from("profiles")
          .select("id, owner_user_id, name, email, avatar_url")
          .eq("owner_user_id", u.id)
          .maybeSingle();

        if (!alive) return;

        if (pErr) console.warn("Profile load error:", pErr);

        setProfile((p0 as any) ?? null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-sm space-y-4">
          <header className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-emerald-100 hover:bg-emerald-900/30"
              onClick={() => router.back()}
            >
              ← Back
            </Button>
            <div className="text-center flex-1">
              <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Profile</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Account</div>
            </div>
            <div className="w-[60px]" />
          </header>

          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            Loading…
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-sm space-y-4">
          <header className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-emerald-100 hover:bg-emerald-900/30"
              onClick={() => router.back()}
            >
              ← Back
            </Button>
            <div className="text-center flex-1">
              <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Profile</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Account</div>
            </div>
            <div className="w-[60px]" />
          </header>

          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            You’re not signed in.
          </div>
        </div>
      </div>
    );
  }

  if (!profile?.id) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-sm space-y-4">
          <header className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-emerald-100 hover:bg-emerald-900/30"
              onClick={() => router.back()}
            >
              ← Back
            </Button>
            <div className="text-center flex-1">
              <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Profile</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Account</div>
            </div>
            <div className="w-[60px]" />
          </header>

          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            Could not load your profile.
          </div>
        </div>
      </div>
    );
  }

  // ✅ Render the shared screen in self-mode
  return <ProfileScreen mode="self" profileId={profile.id} initialProfile={profile} />;
}
