"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ProfilePreview = {
  name: string | null;
  email: string | null;
  created_at: string | null;
};

type InviteState =
  | { status: "loading" }
  | { status: "no-invite" }
  | { status: "pending"; profile_id: string; profile_preview: ProfilePreview }
  | { status: "chosen"; choice: "claim" | "create" };

export default function SetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteState>({ status: "loading" });
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const passwordAlreadySet = searchParams.get("password") === "already-set";

  async function maybeSetPasswordOrThrow(required: boolean) {
    const nextPassword = password.trim();
    const nextConfirmPassword = confirmPassword.trim();

    if (!nextPassword) {
      if (required) throw new Error("Password is required.");
      return;
    }

    if (nextPassword.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    if (nextPassword !== nextConfirmPassword) {
      throw new Error("Passwords do not match.");
    }

    const { error: pwErr } = await supabase.auth.updateUser({ password: nextPassword });
    if (pwErr) throw pwErr;
  }

  // On load: check for pending invite
  useEffect(() => {
    let alive = true;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;

      if (!user) {
        router.replace("/auth");
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        setMsg("Session missing. Please open the invite link again.");
        setInvite({ status: "no-invite" });
        return;
      }

      if (!alive) return;
      setAccessToken(token);

      // Check for pending invite
      try {
        const res = await fetch("/api/invites/pending", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));

        if (!alive) return;

        if (json?.pending && json?.profile_id) {
          setInvite({
            status: "pending",
            profile_id: json.profile_id,
            profile_preview: json.profile_preview ?? {
              name: null,
              email: null,
              created_at: null,
            },
          });
        } else {
          setInvite({ status: "no-invite" });
        }
      } catch {
        if (!alive) return;
        setInvite({ status: "no-invite" });
      }
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  // Claim the invited profile
  async function handleClaim() {
    if (!accessToken) return;
    setMsg(null);
    setWorking(true);

    try {
      await maybeSetPasswordOrThrow(!passwordAlreadySet);

      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });

      const json = await res.json();

      if (!res.ok) {
        if (json?.already_claimed) {
          setMsg("This profile was already claimed. Redirecting...");
          setTimeout(() => router.replace("/"), 1500);
          return;
        }
        throw new Error(json?.error || "Unable to claim invite.");
      }

      router.replace("/");
    } catch (e: any) {
      setMsg(e?.message || "Failed to claim invite.");
    } finally {
      setWorking(false);
    }
  }

  // Create a fresh profile instead
  async function handleCreate() {
    if (!accessToken) return;
    setMsg(null);
    setWorking(true);

    try {
      await maybeSetPasswordOrThrow(!passwordAlreadySet);

      const res = await fetch("/api/profiles/ensure", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Force-Create": "true",
        },
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to create profile.");

      router.replace("/");
    } catch (e: any) {
      setMsg(e?.message || "Failed to create profile.");
    } finally {
      setWorking(false);
    }
  }

  // Save password only (no-invite flow)
  async function savePassword() {
    setMsg(null);
    setWorking(true);

    try {
      await maybeSetPasswordOrThrow(true);

      router.replace("/");
    } catch (e: any) {
      setMsg(e?.message || "Failed to set password.");
    } finally {
      setWorking(false);
    }
  }

  // Loading state
  if (invite.status === "loading") {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8">
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
          Preparing your account...
        </div>
      </div>
    );
  }

  // Pending invite — show claim-or-create modal
  if (invite.status === "pending") {
    const preview = invite.profile_preview;

    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8">
        <div className="mx-auto w-full max-w-sm space-y-4">
          <h1 className="text-xl font-semibold text-[#f5e6b0]">
            Welcome! You have an invitation
          </h1>

          {msg && (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-3 text-sm text-emerald-100/90">
              {msg}
            </div>
          )}

          {/* Invited profile preview */}
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 space-y-2">
            <div className="text-xs uppercase tracking-wide text-emerald-200/70">
              Invited profile
            </div>
            {preview.name && (
              <div className="text-sm text-emerald-50">{preview.name}</div>
            )}
            {preview.email && (
              <div className="text-xs text-emerald-200/60">{preview.email}</div>
            )}
            {preview.created_at && (
              <div className="text-xs text-emerald-200/40">
                Created{" "}
                {new Date(preview.created_at).toLocaleDateString()}
              </div>
            )}
            <div className="text-xs text-emerald-200/40 font-mono">
              ID: {invite.profile_id}
            </div>
          </div>

          {/* Password field */}
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 space-y-3">
            <div className="text-sm text-emerald-100/80">
              {passwordAlreadySet
                ? "Your password was just reset. Continue to claim your invite, or enter a new password to change it now."
                : "Set a password (required) so you can sign in normally next time."}
            </div>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                passwordAlreadySet
                  ? "New password (optional, min 8 chars)"
                  : "New password (min 8 characters)"
              }
              className="w-full rounded-xl border border-emerald-900/70 bg-[#08341b] px-3 py-2 text-base outline-none placeholder:text-emerald-200/40"
            />

            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={
                passwordAlreadySet ? "Confirm new password (if changing)" : "Confirm new password"
              }
              className="w-full rounded-xl border border-emerald-900/70 bg-[#08341b] px-3 py-2 text-base outline-none placeholder:text-emerald-200/40"
            />
          </div>

          {/* Choice buttons */}
          <div className="space-y-2">
            <button
              onClick={handleClaim}
              disabled={working}
              className="w-full rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-3 text-sm font-medium disabled:opacity-50"
            >
              {working ? "Working..." : "Claim invited profile"}
            </button>

            <button
              onClick={handleCreate}
              disabled={working}
              className="w-full rounded-xl border border-emerald-900/70 bg-[#0b3b21]/70 hover:bg-[#0b3b21] px-4 py-3 text-sm font-medium text-emerald-100/80 disabled:opacity-50"
            >
              {working ? "Working..." : "Create a new profile instead"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No invite — standard set-password flow
  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8">
      <div className="mx-auto w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-[#f5e6b0]">Set your password</h1>

        {msg && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-3 text-sm text-emerald-100/90">
            {msg}
          </div>
        )}

        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 space-y-3">
          <div className="text-sm text-emerald-100/80">
            Create a password so you can sign in normally next time.
          </div>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
            className="w-full rounded-xl border border-emerald-900/70 bg-[#08341b] px-3 py-2 text-base outline-none placeholder:text-emerald-200/40"
          />

          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            className="w-full rounded-xl border border-emerald-900/70 bg-[#08341b] px-3 py-2 text-base outline-none placeholder:text-emerald-200/40"
          />

          <button
            onClick={savePassword}
            disabled={working}
            className="w-full rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {working ? "Saving..." : "Save password & continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
