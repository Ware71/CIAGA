"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { MajorScheduleItem } from "@/lib/majors/types";

const FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "live", label: "Live" },
  { value: "completed", label: "Completed" },
];

function entryStatusLabel(status: MajorScheduleItem["entry_status"]) {
  switch (status) {
    case "entered": return { text: "Entered", className: "text-emerald-300 bg-emerald-900/60" };
    case "open": return { text: "Open", className: "text-amber-300 bg-amber-900/40" };
    case "closed": return { text: "Closed", className: "text-slate-400 bg-slate-900/40" };
    default: return { text: "N/A", className: "text-slate-400 bg-slate-900/40" };
  }
}

export default function ScheduleClient() {
  const router = useRouter();
  const [items, setItems] = useState<MajorScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        const params = filter ? `?status=${filter}` : "";
        const res = await fetch(`/api/majors/schedule${params}`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setItems(json.items ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] px-4 pt-8 max-w-sm mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => router.push("/")} className="text-[11px] text-emerald-100/70 hover:text-emerald-50">
          ← Home
        </button>
        <h1 className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Schedule</h1>
        <div className="w-14" />
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 overflow-x-auto">
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              filter === f.value
                ? "bg-emerald-700 text-white"
                : "border border-emerald-900/60 text-emerald-200/70 hover:text-emerald-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-sm text-emerald-100/60 text-center py-10">Loading…</div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-sm text-emerald-100/60 text-center py-10">
          No competitions found.
        </div>
      )}

      <div className="space-y-3 pb-8">
        {items.map((item) => {
          const badge = entryStatusLabel(item.entry_status);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => router.push(`/majors/competitions/${item.id}`)}
              className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2 hover:border-emerald-700/70 transition-colors"
            >
              {item.group && (
                <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-200/55">
                  {item.group.name}
                </div>
              )}
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-emerald-50 leading-tight">{item.name}</span>
                <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.className}`}>
                  {badge.text}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-emerald-100/65 flex-wrap">
                {item.competition_date && (
                  <span>{new Date(item.competition_date).toLocaleDateString()}</span>
                )}
                {item.course && <span>{item.course.name}</span>}
                {item.format && <span className="capitalize">{item.format}</span>}
                <span className="capitalize text-emerald-200/50">{item.competition_type.replace("_", " ")}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
