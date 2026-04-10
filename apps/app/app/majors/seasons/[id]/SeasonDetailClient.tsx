"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  SeriesSeasonWithSeries,
  CompetitionWithGroup,
  SeasonStandingsEntryWithProfile,
} from "@/lib/majors/types";

type Tab = "schedule" | "standings";

export default function SeasonDetailClient({ seasonId }: { seasonId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("schedule");
  const [season, setSeason] = useState<SeriesSeasonWithSeries | null>(null);
  const [competitions, setCompetitions] = useState<CompetitionWithGroup[]>([]);
  const [standings, setStandings] = useState<SeasonStandingsEntryWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        const [seasonRes, standingsRes] = await Promise.all([
          fetch(`/api/majors/seasons/${seasonId}`, { headers }),
          fetch(`/api/majors/seasons/${seasonId}/standings`, { headers }),
        ]);

        if (cancelled) return;

        if (seasonRes.ok) {
          const j = await seasonRes.json();
          setSeason(j.season as SeriesSeasonWithSeries);
          setCompetitions(j.competitions ?? []);
        }

        if (standingsRes.ok) {
          const j = await standingsRes.json();
          setStandings(j.standings ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [seasonId]);

  const statusColour = (status: string) =>
    status === "live"
      ? "bg-amber-900/50 text-amber-300"
      : status === "completed" || status === "official"
      ? "bg-emerald-900/60 text-emerald-300"
      : status === "cancelled"
      ? "bg-red-900/40 text-red-400"
      : "bg-emerald-900/40 text-emerald-200/70";

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <div className="text-sm text-emerald-100/60">Loading…</div>
      </div>
    );
  }

  if (!season) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-4">
        <div className="text-sm text-emerald-100/60">Season not found.</div>
        <button type="button" onClick={() => router.back()} className="text-sm text-emerald-200 underline">
          Go back
        </button>
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

      {/* Hero */}
      <div className="px-4 mb-4 space-y-1">
        {season.series && (
          <button
            type="button"
            onClick={() => router.push(`/majors/series/${season.series.id}`)}
            className="inline-flex items-center text-[10px] uppercase tracking-wider text-emerald-200/55 hover:text-emerald-200 border border-emerald-900/50 rounded-full px-2.5 py-1 transition-colors"
          >
            {season.series.name}
          </button>
        )}
        <h1 className="text-xl font-bold text-[#f5e6b0] leading-tight">{season.name}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full capitalize ${statusColour(season.status)}`}>
            {season.status}
          </span>
          {season.start_date && season.end_date && (
            <span className="text-[11px] text-emerald-100/60">
              {new Date(season.start_date).toLocaleDateString([], { month: "short" })} –{" "}
              {new Date(season.end_date).toLocaleDateString([], { month: "short", year: "numeric" })}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="overflow-x-auto px-4 mb-5">
        <div className="flex gap-2">
          {(["schedule", "standings"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors capitalize ${
                tab === t
                  ? "bg-emerald-700 text-white"
                  : "border border-emerald-900/60 text-emerald-200/70 hover:text-emerald-50"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-8">
        {tab === "schedule" && (
          <div className="space-y-2">
            {competitions.length === 0 ? (
              <div className="text-sm text-emerald-100/60 text-center py-8">No competitions in this season yet.</div>
            ) : (
              competitions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => router.push(`/majors/competitions/${c.id}`)}
                  className="w-full text-left rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/80 p-3 space-y-1 hover:border-emerald-700/60 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-emerald-50 truncate">{c.name}</span>
                    <span className={`text-[9px] uppercase px-2 py-0.5 rounded-full shrink-0 ${statusColour(c.majors_status)}`}>
                      {c.majors_status}
                    </span>
                  </div>
                  {c.competition_date && (
                    <div className="text-[11px] text-emerald-100/55">
                      {new Date(c.competition_date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        )}

        {tab === "standings" && (
          <div className="space-y-2">
            {standings.length === 0 ? (
              <div className="text-sm text-emerald-100/60 text-center py-8">
                Standings will appear once events are complete.
              </div>
            ) : (
              standings.map((row) => (
                <div
                  key={row.profile_id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    row.position === 1
                      ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5"
                      : "border-emerald-900/50 bg-[#0b3b21]/60"
                  }`}
                >
                  <span className="w-6 text-center text-xs font-bold text-emerald-200/70 shrink-0">
                    {row.position ?? "—"}
                  </span>
                  {row.profile?.avatar_url ? (
                    <img src={row.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
                      {row.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-emerald-50 truncate">{row.profile?.name ?? "—"}</div>
                    <div className="text-[10px] text-emerald-100/55">{row.events_played} events · {row.wins} win{row.wins !== 1 ? "s" : ""}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-extrabold text-[#f5e6b0]">{row.season_points}</div>
                    <div className="text-[10px] text-emerald-100/50">pts</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
