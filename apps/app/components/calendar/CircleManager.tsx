"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Trash2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Circle } from "@/lib/calendar/types";
import {
  addCircleMember,
  createCircle,
  deleteCircle,
  removeCircleMember,
  renameCircle,
  searchProfiles,
  type ProfileSearchResult,
} from "@/lib/calendar/api";

export function CircleManager(props: {
  circles: Circle[];
  initialExpandedId?: string | null;
  onClose: () => void;
  onChanged: () => void; // re-fetch circles in the parent
}) {
  const { circles, initialExpandedId, onClose, onChanged } = props;
  const [newName, setNewName] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex flex-col">
        <motion.button
          className="absolute inset-0 bg-black/70"
          onClick={onClose}
          aria-label="Close"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
        <motion.div
          className="relative mt-auto mb-0 mx-auto w-full max-w-[520px] max-h-[85vh] overflow-y-auto rounded-t-3xl border border-emerald-900/70 bg-[#061f12] shadow-2xl"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
        >
          <div className="sticky top-0 flex items-center justify-between border-b border-emerald-900/60 bg-[#061f12] p-4">
            <div className="text-sm font-semibold text-emerald-50">Circles</div>
            <button onClick={onClose} className="text-emerald-100/70 hover:text-emerald-50">
              <X size={18} />
            </button>
          </div>

          <div className="p-4 space-y-4 pb-[env(safe-area-inset-bottom)]">
            <p className="text-[11px] text-emerald-100/60 leading-relaxed">
              Circles are your own private groups of players. Layer their calendars together to find
              a time everyone is free.
            </p>

            {/* New circle */}
            <div className="flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New circle name"
                className="flex-1 rounded-xl border border-emerald-900/70 bg-[#042713] px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-100/40"
              />
              <Button
                className="rounded-xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c]"
                disabled={busy || !newName.trim()}
                onClick={() =>
                  run(async () => {
                    await createCircle(newName.trim());
                    setNewName("");
                  })
                }
              >
                <Plus size={16} />
              </Button>
            </div>

            {circles.length === 0 ? (
              <div className="text-center text-[11px] text-emerald-100/50 py-4">
                No circles yet.
              </div>
            ) : (
              <div className="space-y-2">
                {circles.map((circle) => (
                  <CircleRow
                    key={circle.id}
                    circle={circle}
                    expanded={expandedId === circle.id}
                    onToggle={() =>
                      setExpandedId((id) => (id === circle.id ? null : circle.id))
                    }
                    busy={busy}
                    run={run}
                  />
                ))}
              </div>
            )}

            {err ? <div className="text-[11px] text-red-300">{err}</div> : null}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function CircleRow(props: {
  circle: Circle;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const { circle, expanded, onToggle, busy, run } = props;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchProfiles(q);
        if (!cancelled) setResults(r);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, expanded]);

  const memberIds = new Set(circle.members.map((m) => m.profile_id));

  return (
    <div className="rounded-xl border border-emerald-900/70 bg-[#0b3b21]/40">
      <div className="flex items-center justify-between p-3">
        <button onClick={onToggle} className="flex-1 text-left">
          <div className="text-sm font-semibold text-emerald-50">{circle.name}</div>
          <div className="text-[10px] text-emerald-100/60">
            {circle.members.length} {circle.members.length === 1 ? "member" : "members"}
          </div>
        </button>
        <button
          className="text-red-300/70 hover:text-red-300"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await deleteCircle(circle.id);
            })
          }
        >
          <Trash2 size={16} />
        </button>
      </div>

      {expanded ? (
        <div className="border-t border-emerald-900/60 p-3 space-y-3">
          {circle.members.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {circle.members.map((m) => (
                <span
                  key={m.profile_id}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-900/70 bg-[#042713] px-2 py-1 text-[11px] text-emerald-50"
                >
                  {m.name ?? "Player"}
                  <button
                    className="text-emerald-100/50 hover:text-red-300"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await removeCircleMember(circle.id, m.profile_id);
                      })
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-100/40"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Add a player…"
              className="w-full rounded-lg border border-emerald-900/70 bg-[#042713] py-1.5 pl-8 pr-3 text-sm text-emerald-50 placeholder:text-emerald-100/40"
            />
          </div>

          {searching ? (
            <div className="text-[11px] text-emerald-100/50">Searching…</div>
          ) : results.length > 0 ? (
            <div className="space-y-1">
              {results.map((r) => {
                const already = memberIds.has(r.id);
                return (
                  <button
                    key={r.id}
                    disabled={busy || already}
                    onClick={() =>
                      run(async () => {
                        await addCircleMember(circle.id, r.id);
                        setQuery("");
                        setResults([]);
                      })
                    }
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border border-emerald-900/60 px-2.5 py-1.5 text-left text-sm",
                      already
                        ? "opacity-50"
                        : "bg-[#042713] text-emerald-50 hover:bg-emerald-900/30"
                    )}
                  >
                    <span>{r.name ?? "Player"}</span>
                    {already ? (
                      <span className="text-[10px] text-emerald-200/60">Added</span>
                    ) : (
                      <Plus size={14} className="text-emerald-200/70" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
