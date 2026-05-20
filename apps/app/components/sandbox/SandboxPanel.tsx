"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { getViewerSession } from "@/lib/auth/viewerSession";

type ProfileItem = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  owner_user_id: string | null;
};

type PullEvent =
  | { type: "read"; table: string; rows: number }
  | { type: "skip"; table: string }
  | { type: "wipe" }
  | { type: "write"; table: string; rows: number; skipped: number }
  | { type: "write_error"; table: string; message: string }
  | { type: "done"; tablesCopied: number; rowsCopied: number }
  | { type: "error"; message: string };

const PANEL_WIDTH = 312;
const TAB_WIDTH = 28;

export function SandboxPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [search, setSearch] = useState("");
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [impersonating, setImpersonating] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullLog, setPullLog] = useState<PullEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && profiles.length === 0) {
      loadProfiles();
    }
  }, [isOpen]);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [pullLog]);

  const getToken = async () => {
    const session = await getViewerSession();
    return session?.accessToken ?? null;
  };

  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await getToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  };

  const loadProfiles = async () => {
    setLoadingProfiles(true);
    setError(null);
    try {
      const res = await fetch("/api/sandbox/profiles", { headers: await authHeaders() });
      const data = await res.json();
      if (data.profiles) setProfiles(data.profiles);
      else setError(data.error ?? "Failed to load profiles");
    } catch {
      setError("Network error");
    } finally {
      setLoadingProfiles(false);
    }
  };

  const handleImpersonate = async (profileId: string) => {
    setImpersonating(profileId);
    setError(null);
    try {
      const res = await fetch("/api/sandbox/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ profileId }),
      });
      const data = await res.json();
      if (data.actionLink) {
        window.location.href = data.actionLink;
      } else {
        setError(data.error ?? "Failed to switch profile");
        setImpersonating(null);
      }
    } catch {
      setError("Network error");
      setImpersonating(null);
    }
  };

  const handlePullFromProd = async () => {
    setPulling(true);
    setPullLog([]);
    setError(null);
    try {
      const res = await fetch("/api/sandbox/pull-from-prod", {
        method: "POST",
        headers: await authHeaders(),
      });

      // Pre-stream errors (auth, missing credentials) come back as JSON
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        setError(data.error ?? "Pull failed");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as PullEvent;
            setPullLog((prev) => [...prev, event]);
            if (event.type === "error") setError(event.message);
          } catch {
            // malformed line — ignore
          }
        }
      }
    } catch {
      setError("Network error");
    } finally {
      setPulling(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setError(null);
    try {
      const res = await fetch("/api/sandbox/reset-db", {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (data.ok) {
        setResetDone(true);
        setConfirmReset(false);
      } else {
        setError(data.error ?? "Reset failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setResetting(false);
    }
  };

  const filtered = profiles.filter(
    (p) =>
      !search ||
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.email?.toLowerCase().includes(search.toLowerCase())
  );

  // Derive phase headers from the log so they appear at the right point
  const hasReadEvents = pullLog.some((e) => e.type === "read");
  const hasWipeEvent = pullLog.some((e) => e.type === "wipe");
  const hasWriteEvents = pullLog.some((e) => e.type === "write" || e.type === "write_error");
  const doneEvent = pullLog.find((e) => e.type === "done") as
    | Extract<PullEvent, { type: "done" }>
    | undefined;
  const showLog = pulling || pullLog.length > 0;

  return (
    <div
      className="fixed top-0 right-0 h-full pointer-events-none"
      style={{ zIndex: 9999, width: PANEL_WIDTH + TAB_WIDTH }}
    >
      <motion.div
        className="absolute top-0 right-0 h-full flex pointer-events-auto"
        style={{ width: PANEL_WIDTH + TAB_WIDTH }}
        animate={{ x: isOpen ? 0 : PANEL_WIDTH }}
        transition={{ type: "spring", damping: 28, stiffness: 260 }}
      >
        {/* Toggle tab */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          title="Sandbox Dev Tools"
          className="self-center flex items-center justify-center cursor-pointer rounded-l-lg border border-r-0 border-[#f5e6b0]/40 bg-[#042713] py-5"
          style={{ width: TAB_WIDTH, flexShrink: 0 }}
        >
          <span
            className="text-[#f5e6b0] text-[10px] font-bold tracking-[0.25em]"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            DEV
          </span>
        </button>

        {/* Panel */}
        <div
          className="h-full flex flex-col overflow-hidden border-l border-[#f5e6b0]/20 bg-[#042713]"
          style={{ width: PANEL_WIDTH }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#f5e6b0]/10 px-4 py-3">
            <span className="text-sm font-bold tracking-wide text-[#f5e6b0]">Sandbox Tools</span>
            <span className="rounded bg-[#f5e6b0]/10 px-1.5 py-0.5 text-[10px] text-[#f5e6b0]/50">
              STAGING
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* ── Switch Profile ── */}
            <div className="px-4 pt-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#f5e6b0]/50">
                Switch Profile
              </p>
              <input
                type="text"
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mb-2 w-full rounded-md border border-[#f5e6b0]/20 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-[#f5e6b0]/40"
              />

              {loadingProfiles && (
                <p className="py-3 text-center text-xs text-slate-500">Loading…</p>
              )}

              <div className="max-h-72 space-y-0.5 overflow-y-auto">
                {filtered.map((profile) => {
                  const initials = (profile.name ?? "?")[0].toUpperCase();
                  const isSpinning = impersonating === profile.id;
                  return (
                    <button
                      key={profile.id}
                      onClick={() => handleImpersonate(profile.id)}
                      disabled={impersonating !== null}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5 disabled:opacity-50"
                    >
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-900">
                        {profile.avatar_url ? (
                          <img
                            src={profile.avatar_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-[10px] font-bold text-[#f5e6b0]">{initials}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-100">
                          {profile.name ?? "Unnamed"}
                        </p>
                        {!profile.owner_user_id && (
                          <p className="text-[9px] text-amber-400/60">no account</p>
                        )}
                      </div>
                      {isSpinning && (
                        <span className="text-[9px] text-[#f5e6b0]/40">signing in…</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Divider */}
            <div className="mx-4 my-4 border-t border-[#f5e6b0]/10" />

            {/* ── Reset Database ── */}
            <div className="px-4 pb-8">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#f5e6b0]/50">
                Reset Database
              </p>
              <p className="mb-3 text-[10px] leading-relaxed text-slate-400">
                Wipes all rounds, competitions, groups, scores, and social data. Profiles and courses
                are preserved.
              </p>

              {resetDone && (
                <p className="mb-2 text-xs text-emerald-400">✓ Database reset complete</p>
              )}

              {!confirmReset ? (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="w-full rounded-md border border-red-700/50 bg-red-900/30 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-900/50"
                >
                  Reset Database
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-red-400">
                    This cannot be undone. Confirm?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmReset(false)}
                      className="flex-1 rounded-md border border-white/10 bg-white/5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleReset}
                      disabled={resetting}
                      className="flex-1 rounded-md bg-red-700 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                    >
                      {resetting ? "Resetting…" : "Yes, Reset"}
                    </button>
                  </div>
                </div>
              )}

              {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
            </div>

            {/* Divider */}
            <div className="mx-4 my-4 border-t border-[#f5e6b0]/10" />

            {/* ── Pull from Production ── */}
            <div className="px-4 pb-8">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#f5e6b0]/50">
                Pull from Production
              </p>
              <p className="mb-3 text-[10px] leading-relaxed text-slate-400">
                Replaces all staging data with a live snapshot from production. Auth accounts are
                stripped — use Switch Profile to sign in as any user.
              </p>

              {/* Live log — shown while pulling and after completion */}
              {showLog && (
                <div className="mb-3 max-h-48 overflow-y-auto rounded-md bg-black/40 p-2 font-mono text-[9px]">
                  {hasReadEvents && (
                    <p className="mb-0.5 text-[#f5e6b0]/40">Reading from production</p>
                  )}
                  {pullLog
                    .filter((e) => e.type === "read" || e.type === "skip")
                    .map((e, i) => {
                      if (e.type === "skip") {
                        return (
                          <div key={i} className="flex justify-between pl-2">
                            <span className="truncate text-slate-600">{e.table}</span>
                            <span className="ml-2 shrink-0 text-slate-700">not in prod</span>
                          </div>
                        );
                      }
                      const ev = e as Extract<PullEvent, { type: "read" }>;
                      return (
                        <div key={i} className="flex justify-between pl-2">
                          <span className="truncate text-slate-500">{ev.table}</span>
                          <span className="ml-2 shrink-0 text-slate-600">
                            {ev.rows.toLocaleString()}
                          </span>
                        </div>
                      );
                    })}

                  {hasWipeEvent && (
                    <p className="mb-0.5 mt-1 text-[#f5e6b0]/40">Wiping staging…</p>
                  )}

                  {hasWriteEvents && (
                    <p className="mb-0.5 mt-1 text-[#f5e6b0]/40">Writing to staging</p>
                  )}
                  {pullLog
                    .filter((e) => e.type === "write" || e.type === "write_error")
                    .map((e, i) => {
                      if (e.type === "write_error") {
                        return (
                          <div key={i} className="pl-2">
                            <span className="truncate text-red-500">{e.table}</span>
                            <span className="ml-1 text-red-600/70">✗ {e.message}</span>
                          </div>
                        );
                      }
                      const ev = e as Extract<PullEvent, { type: "write" }>;
                      return (
                        <div key={i} className="flex justify-between pl-2">
                          <span className="truncate text-slate-500">{ev.table}</span>
                          <span className="ml-2 shrink-0 text-emerald-600">
                            ✓{ev.skipped > 0 && (
                              <span className="ml-1 text-amber-600/70">
                                ({ev.skipped} orphaned)
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}

                  {pullLog
                    .filter((e) => e.type === "error")
                    .map((e, i) => {
                      const ev = e as Extract<PullEvent, { type: "error" }>;
                      return (
                        <p key={i} className="mt-1 text-red-400">
                          ✗ {ev.message}
                        </p>
                      );
                    })}

                  {doneEvent && (
                    <p className="mt-1 text-emerald-400">
                      Done — {doneEvent.tablesCopied} tables,{" "}
                      {doneEvent.rowsCopied.toLocaleString()} rows
                    </p>
                  )}

                  {pulling && !doneEvent && (
                    <p className="mt-1 animate-pulse text-slate-500">…</p>
                  )}

                  <div ref={logBottomRef} />
                </div>
              )}

              {!pulling && !confirmPull && (
                <button
                  onClick={() => { setConfirmPull(true); setPullLog([]); setError(null); }}
                  className="w-full rounded-md border border-amber-600/50 bg-amber-900/30 py-2 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-900/50"
                >
                  {doneEvent ? "Pull Again" : "Pull from Production"}
                </button>
              )}

              {!pulling && confirmPull && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-amber-400">
                    This will wipe all staging data. Confirm?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmPull(false)}
                      className="flex-1 rounded-md border border-white/10 bg-white/5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handlePullFromProd}
                      className="flex-1 rounded-md bg-amber-700 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600"
                    >
                      Yes, Pull
                    </button>
                  </div>
                </div>
              )}

              {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
