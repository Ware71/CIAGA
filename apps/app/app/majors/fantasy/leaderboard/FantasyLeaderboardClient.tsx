"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { FantasyConfig } from "@/lib/fantasy/types";

type FantasyGroup = {
  group: { id: string; name: string; image_url: string | null };
  config: FantasyConfig;
};

type Entry = {
  position: number;
  profile_id: string;
  name: string;
  avatar_url: string | null;
  pnl: number;
  staked: number;
  picks: number;
};

function pnlClass(pnl: number): string {
  if (pnl > 0) return "text-emerald-300";
  if (pnl < 0) return "text-red-300";
  return "text-emerald-100/60";
}

export default function FantasyLeaderboardClient() {
  const router = useRouter();
  const [groups, setGroups] = useState<FantasyGroup[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [scope, setScope] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        const res = await fetch("/api/fantasy/me", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (res.ok && !cancelled) {
          const j = await res.json();
          const gs: FantasyGroup[] = j.groups ?? [];
          setGroups(gs);
          if (gs.length > 0) setGroupId(gs[0].group.id);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchEntries = useCallback(async (gid: string) => {
    setLoadingEntries(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/fantasy/groups/${gid}/leaderboard`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        const j = await res.json();
        setEntries(j.entries ?? []);
        setScope(j.scope ?? "");
      }
    } finally {
      setLoadingEntries(false);
    }
  }, []);

  useEffect(() => {
    if (groupId) fetchEntries(groupId);
  }, [groupId, fetchEntries]);

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] max-w-sm mx-auto">
      <div className="px-4 pt-8 flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => router.push("/majors/fantasy")}
          className="text-[11px] text-emerald-100/70 hover:text-emerald-50"
        >
          ← Fantasy
        </button>
        <h1 className="text-lg font-bold tracking-wide text-[#f5e6b0]">Leaderboard</h1>
        <div className="w-12" />
      </div>

      {loading ? (
        <div className="text-sm text-emerald-100/60 text-center py-20">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="px-4">
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-6 text-center text-sm text-emerald-100/70">
            Fantasy picks aren&apos;t enabled in any of your groups yet.
          </div>
        </div>
      ) : (
        <div className="px-4 space-y-4 pb-12">
          {groups.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {groups.map((g) => (
                <button
                  key={g.group.id}
                  type="button"
                  onClick={() => setGroupId(g.group.id)}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${groupId === g.group.id ? "bg-emerald-700 text-white" : "border border-emerald-900/60 text-emerald-200/70"}`}
                >
                  {g.group.name}
                </button>
              ))}
            </div>
          )}

          <div className="text-[10px] text-emerald-200/45 text-center">
            Ranked by net profit — top-ups never count.
            {scope === "season" && " Current season."}
            {scope === "all_time" && " All time."}
          </div>

          {loadingEntries ? (
            <div className="text-sm text-emerald-100/60 text-center py-10">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-6 text-center text-sm text-emerald-100/70">
              No picks placed yet — the leaderboard starts with the first pick.
            </div>
          ) : (
            <div className="space-y-1.5">
              {entries.map((e) => (
                <div
                  key={e.profile_id}
                  className="flex items-center gap-3 rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2"
                >
                  <span className="w-6 text-center text-[12px] font-bold text-emerald-200/60">
                    {e.position}
                  </span>
                  {e.avatar_url ? (
                    <img src={e.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-emerald-900/60 grid place-items-center text-[11px] font-bold text-emerald-200 shrink-0">
                      {e.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-emerald-50 truncate">{e.name}</div>
                    <div className="text-[10px] text-emerald-200/45">
                      {e.picks} pick{e.picks === 1 ? "" : "s"} · {e.staked} pts staked
                    </div>
                  </div>
                  <span className={`shrink-0 text-[13px] font-bold ${pnlClass(e.pnl)}`}>
                    {e.pnl > 0 ? "+" : ""}{e.pnl}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
