"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Profile = {
  id: string;
  name: string | null;
  email: string | null;
  owner_user_id: string | null;
  created_at: string | null;
};

export default function AdminPage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [adminOk, setAdminOk] = useState(false);

  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // Invite form state keyed by profile id
  const [inviteEmailByProfile, setInviteEmailByProfile] = useState<Record<string, string>>({});

  async function refreshUnownedProfiles() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("id,name,email,owner_user_id,created_at")
      .is("owner_user_id", null)
      .order("created_at", { ascending: false });

    if (error) {
      setMsg(error.message);
      return;
    }

    const rows = (data ?? []) as Profile[];
    setProfiles(rows);

    // Seed invite input state so "Invite" actually has an email value
    setInviteEmailByProfile((prev) => {
      const next = { ...prev };
      for (const p of rows) {
        if (next[p.id] == null) next[p.id] = p.email ?? "";
      }
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function guard() {
      setChecking(true);
      setMsg(null);

      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;

      if (!user) {
        router.replace("/auth");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("owner_user_id", user.id)
        .limit(1);

      if (cancelled) return;

      if (error || !data?.[0]?.is_admin) {
        router.replace("/");
        return;
      }

      setAdminOk(true);
      setChecking(false);
      await refreshUnownedProfiles();
    }

    guard();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function createUnownedProfile() {
    setMsg(null);
    setLoading(true);

    try {
      const name = newName.trim() || null;
      const email = newEmail.trim().toLowerCase() || null;

      const { error } = await supabase.from("profiles").insert({
        name,
        email,
        owner_user_id: null,
        is_admin: false,
      });

      if (error) throw error;

      setNewName("");
      setNewEmail("");
      await refreshUnownedProfiles();
      setMsg("Profile created (unowned). Now invite someone to claim it.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to create profile.");
    } finally {
      setLoading(false);
    }
  }

  async function inviteToProfile(profileId: string) {
    console.log("INVITE CLICKED", profileId);

    setMsg(null);
    setLoading(true);

    try {
      const raw = inviteEmailByProfile[profileId] ?? "";
      const email = raw.trim().toLowerCase();

      console.log("INVITE EMAIL", { raw, email });

      if (!email) {
        setMsg("Enter an email to invite.");
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      console.log("SESSION TOKEN", Boolean(accessToken));

      if (!accessToken) {
        setMsg("Not authenticated. Please sign in again.");
        return;
      }

      console.log("FETCHING /api/admin/invite-user");

      const res = await fetch("/api/admin/invite-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email,
          profile_id: profileId,
        }),
      });

      const json = await res.json();
      console.log("FETCH RESULT", res.status, json);

      if (!res.ok) {
        setMsg(json.error || `Invite failed (${res.status})`);
        return;
      }

      setMsg(`Invite sent to ${email}.`);
      setInviteEmailByProfile((prev) => ({ ...prev, [profileId]: "" }));
    } catch (e: any) {
      console.error("Invite failed:", e);
      setMsg(e?.message || "Invite failed.");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8">
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
          Checking admin access…
        </div>
      </div>
    );
  }

  if (!adminOk) return null;

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">

        {/* HEADER */}
        <header className="flex items-center justify-between">
          <button
            type="button"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30 rounded-xl text-sm"
            onClick={() => router.back()}
          >
            ← Back
          </button>

          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">
              Admin
            </div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
              Management
            </div>
          </div>

          <div className="w-[60px]" />
        </header>

        {msg && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/90">
            {msg}
          </div>
        )}

        {/* CREATE PROFILE */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
          <div className="text-sm text-emerald-100/80 mb-3">
            Create a profile with no owner (invite someone to claim it).
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="w-full rounded-xl bg-black/30 border border-emerald-900/60 px-3 py-2 text-sm outline-none"
              placeholder="Name (optional)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="w-full rounded-xl bg-black/30 border border-emerald-900/60 px-3 py-2 text-sm outline-none"
              placeholder="Email (optional)"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={createUnownedProfile}
              disabled={loading}
              className="rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Working…" : "Create profile"}
            </button>

            <button
              type="button"
              onClick={refreshUnownedProfiles}
              disabled={loading}
              className="rounded-xl bg-black/30 hover:bg-black/40 border border-emerald-900/60 px-4 py-2 text-sm disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* UNOWNED PROFILES */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-emerald-100/80">Unowned profiles</div>
            <div className="text-xs text-emerald-100/50">{profiles.length} total</div>
          </div>

          {profiles.length === 0 ? (
            <div className="text-sm text-emerald-100/60">No unowned profiles found.</div>
          ) : (
            <div className="space-y-3">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-emerald-900/60 bg-black/20 p-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-medium text-emerald-50">
                        {p.name || "(no name)"}{" "}
                        <span className="text-xs text-emerald-100/60">
                          — {p.email || "(no email set)"}
                        </span>
                      </div>
                      <div className="text-xs text-emerald-100/50 break-all">
                        Profile ID: {p.id}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        className="w-full sm:w-64 rounded-xl bg-black/30 border border-emerald-900/60 px-3 py-2 text-sm outline-none"
                        placeholder="Invite email"
                        value={inviteEmailByProfile[p.id] ?? ""}
                        onChange={(e) =>
                          setInviteEmailByProfile((prev) => ({
                            ...prev,
                            [p.id]: e.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        onClick={() => inviteToProfile(p.id)}
                        disabled={loading}
                        className="rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        Invite
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-xs text-emerald-100/50">
          Tip: The invited user claims the profile when they follow the invite link, set a password, and your app calls
          <code className="mx-1">/api/invites/accept</code>.
        </div>
      </div>
    </div>
  );
}
