"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { BackButton } from "@/components/ui/BackButton";

type Player = { profile_id: string; display_name: string };
type ProfileResult = { id: string; name: string | null; email: string | null };

export default function ExportRoundsPage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [adminOk, setAdminOk] = useState(false);

  const [playerQuery, setPlayerQuery] = useState("");
  const [playerResults, setPlayerResults] = useState<ProfileResult[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);

  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Admin guard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function guard() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { router.replace("/auth"); return; }
      const { data } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("owner_user_id", auth.user.id)
        .limit(1);
      if (cancelled) return;
      if (!data?.[0]?.is_admin) { router.replace("/"); return; }
      setAdminOk(true);
      setChecking(false);
    }
    guard();
    return () => { cancelled = true; };
  }, [router]);

  // ── Player search ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!playerQuery.trim()) { setPlayerResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      const { data } = await supabase.rpc("search_profiles_public", {
        q: playerQuery.trim(),
        lim: 8,
      });
      const already = new Set(players.map((p) => p.profile_id));
      setPlayerResults(
        ((data ?? []) as ProfileResult[]).filter((p) => !already.has(p.id))
      );
    }, 300);
  }, [playerQuery, players]);

  function addPlayer(profile: ProfileResult) {
    setPlayers((prev) => [
      ...prev,
      { profile_id: profile.id, display_name: profile.name || profile.email || profile.id },
    ]);
    setPlayerQuery("");
    setPlayerResults([]);
  }

  function removePlayer(profile_id: string) {
    setPlayers((prev) => prev.filter((p) => p.profile_id !== profile_id));
  }

  // ── Download ─────────────────────────────────────────────────────────────────

  async function downloadCsv() {
    if (!players.length) return;
    setDownloading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated.");

      const res = await fetch("/api/admin/export-rounds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ profile_ids: players.map((p) => p.profile_id) }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || `Request failed (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "rounds-export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setDownloading(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

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
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-16">
      <div className="mx-auto w-full max-w-lg space-y-5">

        {/* Header */}
        <header className="flex items-center justify-between">
          <BackButton onClick={() => router.push("/admin")} />
          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Export Rounds</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Admin · CSV</div>
          </div>
          <div className="w-[60px]" />
        </header>

        {/* Player selection */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-4">
          <div className="space-y-1 relative">
            <label className="text-xs text-emerald-100/60 uppercase tracking-wide">Search Players</label>
            <input
              type="text"
              placeholder="Search by name or email…"
              value={playerQuery}
              onChange={(e) => setPlayerQuery(e.target.value)}
              className="w-full rounded-xl bg-black/30 border border-emerald-900/60 px-3 py-2 text-base outline-none placeholder:text-emerald-100/30"
            />
            {playerResults.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl border border-emerald-900/60 bg-[#0b3b21] shadow-lg overflow-hidden">
                {playerResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addPlayer(p)}
                    className="w-full text-left px-4 py-2.5 hover:bg-emerald-900/40 border-b border-emerald-900/30 last:border-0"
                  >
                    <div className="text-sm font-medium">{p.name || "(no name)"}</div>
                    {p.email && <div className="text-xs text-emerald-100/50">{p.email}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {players.length > 0 ? (
            <div className="space-y-2">
              {players.map((p) => (
                <div key={p.profile_id} className="flex items-center gap-3 rounded-xl border border-emerald-900/50 bg-black/20 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.display_name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePlayer(p.profile_id)}
                    className="text-emerald-100/40 hover:text-red-400 text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-emerald-100/40 text-center py-2">No players selected</div>
          )}
        </div>

        {/* Download button */}
        <div className="space-y-3">
          <button
            type="button"
            disabled={!players.length || downloading}
            onClick={downloadCsv}
            className="w-full rounded-xl bg-emerald-700/80 hover:bg-emerald-700 disabled:opacity-40 px-4 py-3 text-sm font-semibold"
          >
            {downloading ? "Preparing CSV…" : `Download CSV${players.length ? ` (${players.length} player${players.length > 1 ? "s" : ""})` : ""}`}
          </button>

          {error && (
            <div className="rounded-xl border border-red-900/60 bg-red-900/20 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="text-xs text-emerald-100/40 text-center">
            Exports: Player Name · Date Played · Course · Tee · Total Strokes · Course Rating · Slope · Score Differential
          </div>
        </div>

      </div>
    </div>
  );
}
