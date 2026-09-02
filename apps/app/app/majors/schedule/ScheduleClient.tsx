"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import type { MajorScheduleItem, MajorHistoryItem } from "@/lib/majors/types";
import { MAJORS_CARD_INTERACTIVE, MajorsSection } from "@/components/majors/majorsChrome";
import { BackButton } from "@/components/ui/BackButton";

/**
 * Schedule — fixtures and results in one place.
 *
 * This replaces the old split between /majors/schedule (what's on) and
 * /majors/history (how you did). They listed the same competitions off the same
 * event rows; the only thing History added was your finishing position, and
 * Schedule already had a "Completed" filter showing the same events without it.
 *
 * So the two are merged rather than kept in step: one list, filtered by state
 * and grouped by year, where a completed row carries your result. /majors/history
 * redirects here, which also frees a slot on the long-press wheel.
 */

type Filter = "" | "upcoming" | "live" | "completed";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "live", label: "Live" },
  { value: "completed", label: "Results" },
];

function entryStatusLabel(status: MajorScheduleItem["entry_status"]) {
  switch (status) {
    case "entered":
      return { text: "Entered", className: "text-emerald-300 bg-emerald-900/60" };
    case "open":
      return { text: "Open", className: "text-amber-300 bg-amber-900/40" };
    case "closed":
      return { text: "Closed", className: "text-slate-400 bg-slate-900/40" };
    default:
      return { text: "N/A", className: "text-slate-400 bg-slate-900/40" };
  }
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

const UNDATED = "Undated";

export default function ScheduleClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // /majors/history redirects in with ?filter=completed so the old entry point
  // still lands somewhere sensible.
  const initial = (searchParams?.get("filter") ?? "") as Filter;

  const [items, setItems] = useState<MajorScheduleItem[]>([]);
  const [results, setResults] = useState<Map<string, MajorHistoryItem["entry"]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>(
    FILTERS.some((f) => f.value === initial) ? initial : ""
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const session = await requireViewerSession();
        if (!session || cancelled) return;
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        // The schedule is the list; history supplies the result line for rows
        // that have finished. A failed history fetch just means no results shown.
        const [schedRes, histRes] = await Promise.all([
          fetch(`/api/majors/schedule${filter ? `?status=${filter}` : ""}`, { headers }),
          fetch("/api/majors/history?limit=200", { headers }).catch(() => null),
        ]);

        if (cancelled) return;

        if (schedRes.ok) {
          const j = await schedRes.json();
          setItems(j.items ?? []);
        }

        if (histRes?.ok) {
          const j = await histRes.json();
          const map = new Map<string, MajorHistoryItem["entry"]>();
          for (const h of (j.items ?? []) as MajorHistoryItem[]) {
            if (h.event?.id) map.set(h.event.id, h.entry);
          }
          if (!cancelled) setResults(map);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filter]);

  // Group by year. Results read newest-first; anything still to come reads
  // soonest-first, because those are opposite questions.
  const groups = useMemo(() => {
    const byYear = new Map<string, MajorScheduleItem[]>();
    for (const item of items) {
      const year = item.event_date ? String(new Date(item.event_date).getFullYear()) : UNDATED;
      const bucket = byYear.get(year);
      if (bucket) bucket.push(item);
      else byYear.set(year, [item]);
    }

    const past = filter === "completed";
    for (const bucket of byYear.values()) {
      bucket.sort((a, b) => {
        const at = a.event_date ? new Date(a.event_date).getTime() : 0;
        const bt = b.event_date ? new Date(b.event_date).getTime() : 0;
        return past ? bt - at : at - bt;
      });
    }

    return [...byYear.entries()].sort(([a], [b]) => {
      if (a === UNDATED) return 1;
      if (b === UNDATED) return -1;
      return Number(b) - Number(a);
    });
  }, [items, filter]);

  return (
    <div className="min-h-[100dvh] max-w-sm mx-auto px-4 pt-8 space-y-5">
      <header className="relative flex items-center justify-center">
        <BackButton className="absolute left-0 font-semibold" href="/majors" label="← Majors" />
        <div className="text-center">
          <div className="text-lg font-extrabold tracking-wide text-[#ffd666]">Schedule</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200/50">
            Fixtures &amp; results
          </div>
        </div>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              filter === f.value
                ? "border border-[#ffd666]/50 bg-[#ffd666]/12 text-[#ffd666]"
                : "border border-emerald-900/60 text-emerald-200/60 hover:text-emerald-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <div className="py-10 text-center text-sm text-emerald-100/60">Loading…</div>}

      {!loading && items.length === 0 && (
        <div className="py-10 text-center text-sm text-emerald-100/60">
          {filter === "completed"
            ? "No completed competitions yet."
            : "Nothing scheduled right now."}
        </div>
      )}

      <div className="space-y-6 pb-8">
        {!loading &&
          groups.map(([year, yearItems]) => (
            <MajorsSection key={year} title={year}>
              <div className="space-y-2.5">
                {yearItems.map((item) => {
                  const badge = entryStatusLabel(item.entry_status);
                  const entry = results.get(item.id);
                  const finished = item.majors_status === "completed";

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => router.push(`/majors/events/${item.id}`)}
                      className={`${MAJORS_CARD_INTERACTIVE} w-full space-y-2 p-4 text-left`}
                    >
                      {item.group && (
                        <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-200/55">
                          {item.group.name}
                        </div>
                      )}

                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold leading-tight text-emerald-50">
                          {item.name}
                        </span>
                        {!finished && (
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}
                          >
                            {badge.text}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-emerald-100/65">
                        {item.event_date && (
                          <span>{new Date(item.event_date).toLocaleDateString()}</span>
                        )}
                        {item.course && <span>{item.course.name}</span>}
                        {item.format && <span className="capitalize">{item.format}</span>}
                      </div>

                      {/* The reason History existed: how you actually did. */}
                      {finished && entry && (
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-[#ffd666]/15 pt-2">
                          {entry.position != null && (
                            <span className="text-sm font-extrabold text-[#ffd666]">
                              {ordinal(entry.position)}
                            </span>
                          )}
                          {entry.net_score != null && (
                            <span className="text-[11px] text-emerald-100/70">
                              Net <b className="text-emerald-50">{entry.net_score}</b>
                            </span>
                          )}
                          {entry.gross_score != null && (
                            <span className="text-[11px] text-emerald-100/70">
                              Gross <b className="text-emerald-50">{entry.gross_score}</b>
                            </span>
                          )}
                          {entry.points_earned != null && (
                            <span className="text-[11px] text-emerald-100/70">
                              <b className="text-emerald-50">{entry.points_earned}</b> pts
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </MajorsSection>
          ))}
      </div>
    </div>
  );
}
