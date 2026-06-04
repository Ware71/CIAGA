"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { EventViewerStats } from "@/lib/majors/types";

type ViewerEntry = {
  position: number | null;
  net_score: number | null;
};

type HistoryRow = {
  competition_event_template_id: string;
  season_year: number;
  event_id: string;
  field_size: number;
  winning_score_summary: string | null;
  completed_at: string | null;
  winner: { id: string; name: string | null; avatar_url: string | null } | null;
  runner_up: { id: string; name: string | null; avatar_url: string | null } | null;
  event: { id: string; name: string; event_date: string | null; majors_status: string } | null;
  viewer_entry: ViewerEntry | null;
};

// This page is served by GET /api/majors/competition-events/[eventTemplateId]/history
export default function EventHistoryClient({ eventTemplateId }: { eventTemplateId: string }) {
  const router = useRouter();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [templateName, setTemplateName] = useState<string>("");
  const [viewerStats, setViewerStats] = useState<EventViewerStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        const res = await fetch(`/api/majors/competition-events/${eventTemplateId}/history`, { headers });
        if (!cancelled && res.ok) {
          const j = await res.json();
          setHistory(j.history ?? []);
          setTemplateName(j.event_template?.name ?? "Event History");
          setViewerStats(j.viewer_stats ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventTemplateId]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <div className="text-sm text-emerald-100/60">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] max-w-sm mx-auto">
      {/* Header */}
      <div className="px-4 pt-8 flex items-center justify-between mb-3">
        <button type="button" onClick={() => router.back()} className="text-[11px] text-emerald-100/70 hover:text-emerald-50">
          ← Back
        </button>
        <div className="w-14" />
      </div>

      <div className="px-4 mb-5 space-y-1">
        <h1 className="text-xl font-bold text-[#f5e6b0] leading-tight">{templateName}</h1>
        <p className="text-[11px] text-emerald-100/55">All-time history</p>
      </div>

      {/* My Record panel — shown only when the viewer has at least one appearance */}
      {viewerStats && viewerStats.appearances > 0 && (
        <div className="px-4 mb-5">
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65 mb-3 font-semibold">
              My Record
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Played",    value: viewerStats.appearances },
                { label: "Wins",      value: viewerStats.wins },
                {
                  label: "Best Pos.",
                  value: viewerStats.best_finish != null ? `P${viewerStats.best_finish}` : "—",
                },
                {
                  label: "Avg Pos.",
                  value: viewerStats.avg_finish != null ? viewerStats.avg_finish.toFixed(1) : "—",
                },
              ].map((stat) => (
                <div key={stat.label}>
                  <div className="text-base font-extrabold text-[#f5e6b0]">{stat.value}</div>
                  <div className="text-[10px] text-emerald-200/60">{stat.label}</div>
                </div>
              ))}
            </div>
            {(viewerStats.best_net_score != null || viewerStats.avg_net_score != null) && (
              <div className="mt-3 text-[10px] text-emerald-200/45 text-center">
                {viewerStats.best_net_score != null && `Best score: ${viewerStats.best_net_score}`}
                {viewerStats.best_net_score != null && viewerStats.avg_net_score != null && " · "}
                {viewerStats.avg_net_score != null && `Avg: ${viewerStats.avg_net_score.toFixed(1)}`}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="px-4 pb-8 space-y-3">
        {history.length === 0 ? (
          <div className="text-sm text-emerald-100/60 text-center py-8">
            No history recorded yet.
          </div>
        ) : (
          history.map((row) => (
            <button
              key={row.season_year}
              type="button"
              onClick={() => row.event && router.push(`/majors/events/${row.event.id}`)}
              className="w-full text-left rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/80 p-3 space-y-2 hover:border-emerald-700/60 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[#f5e6b0]">{row.season_year}</span>
                <span className="text-[10px] text-emerald-200/50">{row.field_size} players</span>
              </div>

              {row.winner ? (
                <div className="flex items-center gap-2">
                  {row.winner.avatar_url ? (
                    <img src={row.winner.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-emerald-900/60 grid place-items-center text-[9px] font-bold text-emerald-200">
                      {(row.winner.name ?? "?").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-emerald-50 truncate">{row.winner.name ?? "Unknown"}</div>
                    <div className="text-[10px] text-emerald-200/50">Winner{row.winning_score_summary ? ` · ${row.winning_score_summary}` : ""}</div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-emerald-100/40 italic">No result recorded</div>
              )}

              {row.runner_up && (
                <div className="flex items-center gap-2 opacity-60">
                  <div className="h-5 w-5 rounded-full bg-emerald-900/60 grid place-items-center text-[8px] font-bold text-emerald-200">
                    {(row.runner_up.name ?? "?").slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-[11px] text-emerald-100/70 truncate">Runner-up: {row.runner_up.name ?? "Unknown"}</span>
                </div>
              )}

              {/* Viewer's own result for this year */}
              {row.viewer_entry && (
                <div className="flex items-center gap-2 pt-1 border-t border-emerald-900/30">
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 border border-emerald-800/40 shrink-0">
                    You
                  </span>
                  <span className="text-[11px] text-emerald-100/70">
                    {row.viewer_entry.position != null ? `P${row.viewer_entry.position}` : "DNS"}
                    {row.viewer_entry.net_score != null && ` · ${row.viewer_entry.net_score}`}
                  </span>
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
