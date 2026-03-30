"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { formatHI } from "@/lib/rounds/handicapUtils";
import type { LeaderboardEntryWithProfile, GroupStandingWithProfile } from "@/lib/majors/types";

type Tab = "competition" | "group";

export default function LeaderboardClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const competitionId = searchParams.get("competition_id");
  const groupId = searchParams.get("group_id");

  const initialTab: Tab = groupId ? "group" : "competition";
  const [tab, setTab] = useState<Tab>(initialTab);

  const [compRows, setCompRows] = useState<LeaderboardEntryWithProfile[]>([]);
  const [groupRows, setGroupRows] = useState<GroupStandingWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const id = tab === "competition" ? competitionId : groupId;
    if (!id) { setLoading(false); return; }

    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        const param = tab === "competition" ? `competition_id=${id}` : `group_id=${id}`;
        const res = await fetch(`/api/majors/leaderboard?${param}`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) {
          if (tab === "competition") setCompRows(json.rows ?? []);
          else setGroupRows(json.rows ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, competitionId, groupId]);

  const rows = tab === "competition" ? compRows : groupRows;

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] px-4 pt-8 max-w-sm mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => router.back()} className="text-[11px] text-emerald-100/70 hover:text-emerald-50">
          ← Back
        </button>
        <h1 className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Leaderboard</h1>
        <div className="w-14" />
      </div>

      {/* Tab strip */}
      {competitionId && groupId && (
        <div className="flex gap-2">
          {(["competition", "group"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors capitalize ${
                tab === t
                  ? "bg-emerald-700 text-white"
                  : "border border-emerald-900/60 text-emerald-200/70"
              }`}
            >
              {t === "competition" ? "Competition" : "Season"}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="text-sm text-emerald-100/60 text-center py-10">Loading…</div>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-sm text-emerald-100/60 text-center py-10">
          No results yet. Submit a round to appear here.
        </div>
      )}

      <div className="space-y-2 pb-8">
        {rows.map((row: any, idx) => (
          <div
            key={row.id}
            className="flex items-center gap-3 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2"
          >
            <span className="w-6 text-center text-xs font-extrabold text-[#f5e6b0]">
              {row.position ?? idx + 1}
            </span>
            {row.profile?.avatar_url ? (
              <img src={row.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200">
                {row.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
              </div>
            )}
            <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">
              {row.profile?.name ?? "Unknown"}
            </span>
            <div className="text-right shrink-0">
              {tab === "competition" ? (
                <>
                  <div className="text-xs font-extrabold text-[#f5e6b0]">
                    {row.net_score ?? row.gross_score ?? "—"}
                  </div>
                  <div className="text-[10px] text-emerald-100/50">net</div>
                </>
              ) : (
                <>
                  <div className="text-xs font-extrabold text-[#f5e6b0]">{row.season_points ?? 0} pts</div>
                  <div className="text-[10px] text-emerald-100/50">{row.events_played ?? 0} events</div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
