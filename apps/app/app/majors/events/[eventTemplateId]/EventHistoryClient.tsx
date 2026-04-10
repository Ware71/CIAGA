"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";

type HistoryRow = {
  series_event_template_id: string;
  season_year: number;
  competition_id: string;
  field_size: number;
  winning_score_summary: string | null;
  completed_at: string | null;
  winner: { id: string; name: string | null; avatar_url: string | null } | null;
  runner_up: { id: string; name: string | null; avatar_url: string | null } | null;
  competition: { id: string; name: string; competition_date: string | null; majors_status: string } | null;
};

// This page is served by GET /api/majors/events/[eventTemplateId]/history
export default function EventHistoryClient({ eventTemplateId }: { eventTemplateId: string }) {
  const router = useRouter();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [templateName, setTemplateName] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        const res = await fetch(`/api/majors/events/${eventTemplateId}/history`, { headers });
        if (!cancelled && res.ok) {
          const j = await res.json();
          setHistory(j.history ?? []);
          setTemplateName(j.event_template?.name ?? "Event History");
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
              onClick={() => row.competition && router.push(`/majors/competitions/${row.competition.id}`)}
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
            </button>
          ))
        )}
      </div>
    </div>
  );
}
