"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import { supabase } from "@/lib/supabaseClient";
import type { FantasyConfig } from "@/lib/fantasy/types";

type FantasyGroup = {
  group: { id: string; name: string; image_url: string | null };
  config: FantasyConfig;
};

type ProfileRow = {
  id: string;
  group_id: string;
  profile_id: string;
  handicap_index: number | null;
  avg_gross: number | null;
  avg_net: number | null;
  score_stddev: number | null;
  recent_form: number | null;
  birdies_per_round: number | null;
  pars_per_round: number | null;
  bogeys_per_round: number | null;
  doubles_plus_per_round: number | null;
  par3_avg_vs_par: number | null;
  par4_avg_vs_par: number | null;
  par5_avg_vs_par: number | null;
  sample_size: number;
  confidence: "low" | "medium" | "high";
  computed_at: string;
  profile: { id: string; name: string | null; avatar_url: string | null } | null;
};

function fmt(n: number | null, dp = 1): string {
  if (n == null) return "–";
  return Number(n).toFixed(dp);
}

function confidenceBadge(confidence: ProfileRow["confidence"]): string {
  if (confidence === "high") return "text-emerald-300 border-emerald-700/50";
  if (confidence === "medium") return "text-amber-300/80 border-amber-800/40";
  return "text-emerald-200/40 border-emerald-900/50";
}

export default function ProfilesClient() {
  const router = useRouter();
  const [groups, setGroups] = useState<FantasyGroup[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await requireViewerSession();
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

  const fetchRows = useCallback(async (gid: string) => {
    setLoadingRows(true);
    try {
      const { data } = await supabase
        .from("fantasy_player_profiles")
        .select("*, profile:profiles(id, name, avatar_url)")
        .eq("group_id", gid)
        .order("avg_gross", { ascending: true, nullsFirst: false });
      setRows((data ?? []) as ProfileRow[]);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    if (groupId) fetchRows(groupId);
  }, [groupId, fetchRows]);

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
        <h1 className="text-lg font-bold tracking-wide text-[#f5e6b0]">Profiles</h1>
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

          {loadingRows ? (
            <div className="text-sm text-emerald-100/60 text-center py-10">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-6 text-center">
              <div className="text-sm text-emerald-100/70">No profiles yet</div>
              <div className="text-[11px] text-emerald-200/50 mt-1">
                Profiles are built automatically when markets are generated for an event.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((row) => {
                const name = row.profile?.name ?? "Player";
                const open = expanded === row.id;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setExpanded(open ? null : row.id)}
                    className="w-full text-left rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      {row.profile?.avatar_url ? (
                        <img src={row.profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" loading="lazy" decoding="async" />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-emerald-900/60 grid place-items-center text-[11px] font-bold text-emerald-200 shrink-0">
                          {name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-emerald-50 truncate">{name}</div>
                        <div className="text-[10px] text-emerald-200/50">
                          HI {fmt(row.handicap_index)} · avg {fmt(row.avg_gross)} gross
                        </div>
                      </div>
                      <span className={`shrink-0 text-[9px] uppercase tracking-wider border rounded-full px-2 py-0.5 ${confidenceBadge(row.confidence)}`}>
                        {row.confidence} · {row.sample_size}
                      </span>
                    </div>
                    {open && (
                      <div className="mt-2 pt-2 border-t border-emerald-900/30 grid grid-cols-3 gap-y-1.5 text-center">
                        <Stat label="Avg net" value={fmt(row.avg_net)} />
                        <Stat label="Stddev" value={fmt(row.score_stddev)} />
                        <Stat label="Form" value={row.recent_form == null ? "–" : `${row.recent_form > 0 ? "+" : ""}${fmt(row.recent_form)}`} />
                        <Stat label="Birdies/rd" value={fmt(row.birdies_per_round)} />
                        <Stat label="Pars/rd" value={fmt(row.pars_per_round)} />
                        <Stat label="Bogeys/rd" value={fmt(row.bogeys_per_round)} />
                        <Stat label="Par 3" value={signed(row.par3_avg_vs_par)} />
                        <Stat label="Par 4" value={signed(row.par4_avg_vs_par)} />
                        <Stat label="Par 5" value={signed(row.par5_avg_vs_par)} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function signed(n: number | null): string {
  if (n == null) return "–";
  return `${n > 0 ? "+" : ""}${Number(n).toFixed(2)}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-emerald-100">{value}</div>
      <div className="text-[9px] text-emerald-200/45">{label}</div>
    </div>
  );
}
