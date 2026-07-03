"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Pencil, Plus, Search, User, Users2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type {
  AvailabilityFilter,
  Circle,
  ProfileLite,
  Scope,
  ViewMode,
} from "@/lib/calendar/types";
import {
  fetchFollowingIds,
  resolveProfileNames,
  searchProfiles,
  type ProfileSearchResult,
} from "@/lib/calendar/api";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { InitialsAvatar } from "./Avatar";
import { SegmentedControl } from "./SegmentedControl";

export function ScopePicker(props: {
  scope: Scope;
  circles: Circle[];
  viewMode: ViewMode;
  onViewMode: (v: ViewMode) => void;
  filter: AvailabilityFilter;
  onFilter: (f: AvailabilityFilter) => void;
  onSelect: (scope: Scope) => void;
  onManageCircle: (circleId: string) => void;
  onNewCircle: () => void;
  onClose: () => void;
}) {
  const { scope, circles, viewMode, onViewMode, filter, onFilter, onSelect, onManageCircle, onNewCircle, onClose } =
    props;

  const [mode, setMode] = useState<"root" | "people">(
    scope.kind === "people" ? "people" : "root"
  );
  const [following, setFollowing] = useState<ProfileLite[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Map<string, ProfileLite>>(() => {
    const m = new Map<string, ProfileLite>();
    if (scope.kind === "people") scope.ids.forEach((id) => m.set(id, { id, name: null, avatar_url: null }));
    return m;
  });
  const [includeSelf, setIncludeSelf] = useState(
    scope.kind === "people" ? scope.includeSelf : true
  );

  // Load following for the individuals picker.
  useEffect(() => {
    (async () => {
      const session = await getViewerSession();
      if (!session) return;
      try {
        const ids = await fetchFollowingIds(session.profileId);
        setFollowing(await resolveProfileNames(ids));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchProfiles(q);
        if (!cancelled) setResults(r);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  function toggle(p: ProfileLite) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });
  }

  const q = query.trim().toLowerCase();
  const followingFiltered = useMemo(
    () => following.filter((p) => !q || (p.name ?? "").toLowerCase().includes(q)),
    [following, q]
  );

  function applyPeople() {
    const ids = Array.from(selected.keys());
    if (ids.length === 0) {
      onSelect({ kind: "me" });
    } else {
      onSelect({ kind: "people", ids, includeSelf });
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50">
        <motion.button
          className="absolute inset-0 bg-black/60"
          onClick={onClose}
          aria-label="Close"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
        <motion.div
          className="absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)]"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
        >
          <div className="mx-auto w-full max-w-[520px] max-h-[82vh] overflow-y-auto rounded-t-3xl border border-emerald-900/70 bg-[#061f12] shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-emerald-900/60 bg-[#061f12] px-4 py-3">
              <div className="text-sm font-semibold text-emerald-50">
                {mode === "people" ? "Pick players" : "View calendar"}
              </div>
              <button onClick={onClose} className="text-emerald-100/70 hover:text-emerald-50">
                <X size={18} />
              </button>
            </div>

            {mode === "root" ? (
              <div className="p-3 space-y-4">
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200/50">
                    View
                  </div>
                  <SegmentedControl<ViewMode>
                    size="sm"
                    value={viewMode}
                    onChange={onViewMode}
                    options={[
                      { value: "week", label: "Week" },
                      { value: "month", label: "Month" },
                      { value: "weekends", label: "Weekends" },
                      { value: "agenda", label: "Agenda" },
                    ]}
                  />
                  <SegmentedControl<AvailabilityFilter>
                    size="sm"
                    value={filter}
                    onChange={onFilter}
                    options={[
                      { value: "all", label: "Show all" },
                      { value: "hide_unavailable", label: "Hide busy" },
                      { value: "available_only", label: "Available" },
                    ]}
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200/50">
                    Viewing
                  </div>
                  <Row
                    icon={<User size={16} />}
                    label="Me"
                    active={scope.kind === "me"}
                    onClick={() => onSelect({ kind: "me" })}
                  />
                  <Row
                    icon={<Search size={16} />}
                    label="Who's looking for a round"
                    active={scope.kind === "looking"}
                    onClick={() => onSelect({ kind: "looking" })}
                  />
                  <Row
                    icon={<Users2 size={16} />}
                    label="Pick individual players…"
                    active={scope.kind === "people"}
                    onClick={() => setMode("people")}
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200/50">
                      Circles
                    </span>
                    <button
                      onClick={onNewCircle}
                      className="flex items-center gap-1 text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
                    >
                      <Plus size={13} /> New
                    </button>
                  </div>
                  {circles.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-emerald-900/60 px-3 py-3 text-center text-[11px] text-emerald-100/50">
                      No circles yet — create one to layer several calendars.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {circles.map((c) => (
                        <div
                          key={c.id}
                          className={cn(
                            "flex items-center gap-2 rounded-xl border px-3 py-2",
                            scope.kind === "circle" && scope.id === c.id
                              ? "border-[#f5e6b0]/60 bg-[#f5e6b0]/10"
                              : "border-emerald-900/60 bg-[#0b3b21]/40"
                          )}
                        >
                          <button
                            onClick={() => onSelect({ kind: "circle", id: c.id })}
                            className="flex-1 text-left"
                          >
                            <div className="text-sm font-medium text-emerald-50">{c.name}</div>
                            <div className="text-[10px] text-emerald-100/55">
                              {c.members.length} {c.members.length === 1 ? "member" : "members"}
                            </div>
                          </button>
                          <button
                            onClick={() => onManageCircle(c.id)}
                            className="text-emerald-200/60 hover:text-emerald-100"
                            aria-label="Edit circle"
                          >
                            <Pencil size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 space-y-3">
                <button
                  onClick={() => setMode("root")}
                  className="text-[11px] text-emerald-300 hover:text-emerald-200"
                >
                  ← Back
                </button>

                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-100/40"
                  />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search players…"
                    className="w-full rounded-lg border border-emerald-900/70 bg-[#042713] py-2 pl-8 pr-3 text-sm text-emerald-50 placeholder:text-emerald-100/40"
                  />
                </div>

                {/* Selected chips */}
                {selected.size > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(selected.values()).map((p) => (
                      <span
                        key={p.id}
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-800/60 bg-[#0b3b21] px-2 py-1 text-[11px] text-emerald-50"
                      >
                        {p.name ?? "Player"}
                        <button onClick={() => toggle(p)} className="text-emerald-100/50 hover:text-red-300">
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                <label className="flex items-center justify-between rounded-lg border border-emerald-900/60 bg-[#0b3b21]/40 px-3 py-2 text-xs text-emerald-100/80">
                  Include me (find mutual free time)
                  <input
                    type="checkbox"
                    checked={includeSelf}
                    onChange={(e) => setIncludeSelf(e.target.checked)}
                    className="h-4 w-4 accent-[#f5e6b0]"
                  />
                </label>

                <div className="max-h-[38vh] overflow-y-auto rounded-xl border border-emerald-900/50 bg-[#042713] divide-y divide-emerald-900/40">
                  {(q.length >= 2 ? results : followingFiltered).map((p) => {
                    const lite: ProfileLite = {
                      id: p.id,
                      name: p.name ?? null,
                      avatar_url: (p as any).avatar_url ?? null,
                    };
                    const on = selected.has(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => toggle(lite)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-emerald-900/25"
                      >
                        <InitialsAvatar profileId={p.id} name={p.name ?? null} size={26} />
                        <span className="min-w-0 flex-1 truncate text-sm text-emerald-50">
                          {p.name ?? "Player"}
                        </span>
                        {on ? <Check size={16} className="text-emerald-300" /> : null}
                      </button>
                    );
                  })}
                  {searching ? (
                    <div className="px-3 py-2 text-[11px] text-emerald-100/50">Searching…</div>
                  ) : null}
                  {q.length < 2 && followingFiltered.length === 0 ? (
                    <div className="px-3 py-3 text-center text-[11px] text-emerald-100/50">
                      Search for players by name.
                    </div>
                  ) : null}
                </div>

                <Button
                  className="w-full rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c]"
                  onClick={applyPeople}
                >
                  {selected.size === 0
                    ? "View my calendar"
                    : `View ${selected.size} ${selected.size === 1 ? "player" : "players"}${
                        includeSelf ? " + me" : ""
                      }`}
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function Row(props: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
        props.active
          ? "border-[#f5e6b0]/60 bg-[#f5e6b0]/10 text-emerald-50"
          : "border-emerald-900/60 bg-[#0b3b21]/40 text-emerald-100/90 hover:bg-emerald-900/25"
      )}
    >
      <span className="text-emerald-200/70">{props.icon}</span>
      <span className="flex-1">{props.label}</span>
      {props.active ? <Check size={16} className="text-[#f5e6b0]" /> : null}
    </button>
  );
}
