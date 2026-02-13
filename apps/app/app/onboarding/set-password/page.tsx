"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function SetPasswordPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Claim ASAP when page loads (safe, idempotent-ish with your server guard)
  useEffect(() => {
    let alive = true;

    (async () => {
      setMsg(null);
      setLoading(true);

      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;

      if (!user) {
        router.replace("/auth");
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        setMsg("Session missing. Please open the invite link again.");
        setLoading(false);
        return;
      }

      // Call accept to claim profile
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });

      const json = await res.json();

      if (!alive) return;

      if (!res.ok) {
        // If already claimed or no invite, show message.
        setMsg(json.error || "Unable to claim invite.");
      } else {
        setMsg("Invite accepted. Set a password to finish.");
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  async function savePassword() {
    setMsg(null);
    setWorking(true);

    try {
      if (password.trim().length < 8) {
        setMsg("Password must be at least 8 characters.");
        return;
      }

      // Sets password for invited user
      const { error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr) throw pwErr;

      router.replace("/");
    } catch (e: any) {
      setMsg(e?.message || "Failed to set password.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8">
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
          Preparing your account…
        </div>
      </div>
    );
  }

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
            className="w-full rounded-xl border border-emerald-900/70 bg-[#08341b] px-3 py-2 text-sm outline-none placeholder:text-emerald-200/40"
          />

          <button
            onClick={savePassword}
            disabled={working}
            className="w-full rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {working ? "Saving…" : "Save password & continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
