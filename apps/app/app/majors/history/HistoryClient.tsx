"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { MajorHistoryItem } from "@/lib/majors/types";

function finishLabel(pos: number | null): string {
  if (pos == null) return "—";
  if (pos === 1) return "1st 🏆";
  if (pos === 2) return "2nd";
  if (pos === 3) return "3rd";
  return `${pos}th`;
}

export default function HistoryClient() {
  const router = useRouter();
  const [items, setItems] = useState<MajorHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const fetchItems = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch("/api/majors/history?limit=20", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      const newItems: MajorHistoryItem[] = json.items ?? [];
      setItems(reset ? newItems : (prev) => [...prev, ...newItems]);
      setHasMore(newItems.length === 20);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(true); }, [fetchItems]);

  // Group by year
  const byYear = items.reduce<Record<string, MajorHistoryItem[]>>((acc, item) => {
    const year = item.event.event_date
      ? new Date(item.event.event_date).getFullYear().toString()
      : "Unknown";
    (acc[year] ??= []).push(item);
    return acc;
  }, {});

  const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] px-4 pt-8 max-w-sm mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => router.push("/")} className="text-[11px] text-emerald-100/70 hover:text-emerald-50">
          ← Home
        </button>
        <h1 className="text-lg font-semibold tracking-wide text-[#f5e6b0]">History</h1>
        <div className="w-14" />
      </div>

      {loading && items.length === 0 && (
        <div className="text-sm text-emerald-100/60 text-center py-10">Loading…</div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-sm text-emerald-100/60 text-center py-10">
          No completed competitions yet. Enter one to get started.
        </div>
      )}

      {years.map((year) => (
        <section key={year} className="space-y-2">
          <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55">{year}</h2>
          {byYear[year].map((item) => {
            const comp = item.event;
            const entry = item.entry;
            return (
              <button
                key={comp.id}
                type="button"
                onClick={() => router.push(`/majors/events/${comp.id}`)}
                className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 hover:border-emerald-700/70 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    {comp.group && (
                      <div className="text-[10px] text-emerald-200/55 truncate">{comp.group.name}</div>
                    )}
                    <div className="text-sm font-semibold text-emerald-50 truncate">{comp.name}</div>
                    <div className="text-[11px] text-emerald-100/60 flex gap-2">
                      {comp.event_date && (
                        <span>{new Date(comp.event_date).toLocaleDateString()}</span>
                      )}
                      {comp.course && <span>{comp.course.name}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-extrabold text-[#f5e6b0]">
                      {finishLabel(entry?.position ?? null)}
                    </div>
                    {entry?.net_score != null && (
                      <div className="text-[10px] text-emerald-100/55">
                        Net {entry.net_score}
                      </div>
                    )}
                    {entry?.points_earned != null && entry.points_earned > 0 && (
                      <div className="text-[10px] text-amber-300/70">
                        +{entry.points_earned} pts
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </section>
      ))}

      {hasMore && (
        <button
          type="button"
          onClick={() => fetchItems()}
          className="w-full py-2 text-sm text-emerald-200/70 hover:text-emerald-50"
        >
          Load more
        </button>
      )}
    </div>
  );
}
