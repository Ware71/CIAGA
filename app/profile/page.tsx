"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import ProfileScreen from "@/components/profile/ProfileScreen";

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

  const generateNameFromEmail = (email?: string | null) => {
    if (!email) return "Player";
    const local = email.split("@")[0] || "Player";
    const cleaned = local.replace(/[._-]+/g, " ").trim();
    if (!cleaned) return "Player";
    const titled = cleaned
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return titled.slice(0, 30);
  };

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

        // Load profile row by ownership (Model B)
        const { data: p0, error: pErr } = await supabase
          .from("profiles")
          .select("id, owner_user_id, name, email, avatar_url")
          .eq("owner_user_id", u.id)
          .maybeSingle();

        if (!alive) return;

        if (pErr) console.warn("Profile load error:", pErr);

        let p = (p0 as any) as ProfileRow | null;

        // If missing, create it
        if (!p) {
          const autoName = generateNameFromEmail(u.email);

          const { data: created, error: insErr } = await supabase
            .from("profiles")
            .insert({
              owner_user_id: u.id,
              email: u.email ?? null,
              name: autoName,
              avatar_url: null,
              is_admin: false,
            })
            .select("id, owner_user_id, name, email, avatar_url")
            .single();

          if (insErr) {
            console.warn("Profile insert failed:", insErr);
          } else {
            p = (created as any) ?? null;
          }
        }

        // Auto-set name if blank
        const existingName = p?.name as string | null | undefined;
        const hasName = !!(existingName && existingName.trim().length > 0);

        if (p?.id && !hasName) {
          const autoName = generateNameFromEmail(u.email);

          const { data: updated, error: upErr } = await supabase
            .from("profiles")
            .update({ name: autoName, email: p.email ?? u.email ?? null })
            .eq("id", p.id)
            .select("id, owner_user_id, name, email, avatar_url")
            .single();

          if (upErr) console.warn("Auto-name update failed:", upErr);
          else p = (updated as any) ?? p;
        }

        if (!alive) return;

        setProfile(p);
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
            <Button variant="ghost" size="sm" className="px-2 text-emerald-100 hover:bg-emerald-900/30" onClick={() => router.back()}>
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
            <Button variant="ghost" size="sm" className="px-2 text-emerald-100 hover:bg-emerald-900/30" onClick={() => router.back()}>
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
            <Button variant="ghost" size="sm" className="px-2 text-emerald-100 hover:bg-emerald-900/30" onClick={() => router.back()}>
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
