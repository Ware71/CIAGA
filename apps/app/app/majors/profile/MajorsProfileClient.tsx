"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import type { MajorProfileData } from "@/lib/majors/types";

export default function MajorsProfileClient() {
  const router = useRouter();
  const [data, setData] = useState<MajorProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await requireViewerSession();
        if (!session || cancelled) return;
        const res = await fetch("/api/majors/profile", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setData(json);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] px-4 pt-8 max-w-sm mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => router.push("/majors")} className="text-[11px] text-emerald-100/70 hover:text-emerald-50">
          ← Hub
        </button>
        <h1 className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Majors Profile</h1>
        <div className="w-14" />
      </div>

      {loading && (
        <div className="text-sm text-emerald-100/60 text-center py-10">Loading…</div>
      )}

      {data && (
        <>
          {/* Profile header */}
          <div className="flex items-center gap-4">
            {data.profile.avatar_url ? (
              <img src={data.profile.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover border border-emerald-900/60" loading="lazy" decoding="async" />
            ) : (
              <div className="h-14 w-14 rounded-full bg-emerald-900/60 grid place-items-center text-xl font-bold text-emerald-200">
                {data.profile.name?.slice(0, 2).toUpperCase() ?? "?"}
              </div>
            )}
            <div>
              <div className="text-base font-extrabold text-emerald-50">{data.profile.name ?? "Player"}</div>
              <div className="text-[11px] text-emerald-200/60">CIAGA Majors</div>
            </div>
          </div>

          {/* Season Summary */}
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65 mb-3">
              This Season
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Points", value: data.season_summary.points },
                { label: "Events", value: data.season_summary.events },
                { label: "Wins", value: data.season_summary.wins },
                { label: "Podiums", value: data.season_summary.podiums },
              ].map((stat) => (
                <div key={stat.label}>
                  <div className="text-base font-extrabold text-[#f5e6b0]">{stat.value}</div>
                  <div className="text-[10px] text-emerald-200/60">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Career Stats */}
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65 mb-3">
              Career
            </div>
            <div className="space-y-2">
              {[
                { label: "Total events", value: data.career.total_events },
                { label: "Total wins", value: data.career.total_wins },
                { label: "Podiums", value: data.career.total_podiums },
                { label: "Avg. position", value: data.career.avg_position?.toFixed(1) ?? "—" },
                { label: "Total points", value: data.career.total_points },
              ].map((stat) => (
                <div key={stat.label} className="flex items-center justify-between">
                  <span className="text-[12px] text-emerald-100/70">{stat.label}</span>
                  <span className="text-[12px] font-extrabold text-emerald-50">{stat.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Results */}
          {data.recent_results.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">
                Recent Results
              </h2>
              {data.recent_results.map((item) => (
                <button
                  key={item.event.id}
                  type="button"
                  onClick={() => router.push(`/majors/events/${item.event.id}`)}
                  className="w-full text-left flex items-center justify-between rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-4 py-3 hover:border-emerald-700/50"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] text-emerald-200/55 truncate">
                      {item.event.group?.name ?? ""}
                    </div>
                    <div className="text-sm font-semibold text-emerald-50 truncate">
                      {item.event.name}
                    </div>
                  </div>
                  <div className="shrink-0 text-right ml-3">
                    <div className="text-sm font-extrabold text-[#f5e6b0]">
                      {item.entry?.position != null ? `#${item.entry.position}` : "—"}
                    </div>
                    {item.entry?.points_earned != null && item.entry.points_earned > 0 && (
                      <div className="text-[10px] text-amber-300/70">+{item.entry.points_earned} pts</div>
                    )}
                  </div>
                </button>
              ))}
            </section>
          )}

          {/* Group Memberships */}
          {data.group_memberships.length > 0 && (
            <section className="space-y-2 pb-8">
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">
                My Groups
              </h2>
              {data.group_memberships.map((m) => (
                <button
                  key={m.group.id}
                  type="button"
                  onClick={() => router.push(`/majors/groups/${m.group.id}`)}
                  className="w-full text-left flex items-center justify-between rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-4 py-3 hover:border-emerald-700/50"
                >
                  <div>
                    <div className="text-sm font-semibold text-emerald-50">{m.group.name}</div>
                    <div className="text-[10px] text-emerald-200/55 capitalize">
                      {m.role} · {m.group.type.replace("_", " ")}
                    </div>
                  </div>
                  {m.standing && (
                    <div className="text-right">
                      <div className="text-xs font-extrabold text-[#f5e6b0]">
                        {m.standing.position != null ? `#${m.standing.position}` : "—"}
                      </div>
                      <div className="text-[10px] text-emerald-100/50">{m.standing.season_points} pts</div>
                    </div>
                  )}
                </button>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
