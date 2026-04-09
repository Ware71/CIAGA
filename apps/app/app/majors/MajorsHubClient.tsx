"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { MajorHubSummary, CompetitionWithGroup, MajorGroup } from "@/lib/majors/types";

type Props = {
  initialData: MajorHubSummary | null;
};

function CompetitionCard({ comp }: { comp: CompetitionWithGroup }) {
  const router = useRouter();
  const isLive = comp.majors_status === "live";
  const isCompleted = comp.majors_status === "completed";

  return (
    <button
      type="button"
      onClick={() => router.push(`/majors/competitions/${comp.id}`)}
      className="w-full text-left rounded-2xl border bg-[#0b3b21]/80 p-4 space-y-2 hover:border-emerald-700/70 transition-colors overflow-hidden relative"
      style={{
        borderColor: isLive ? "rgba(217,119,6,0.35)" : isCompleted ? "rgba(52,211,153,0.25)" : "rgba(6,78,59,0.7)",
      }}
    >
      {/* Status stripe */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
        style={{
          background: isLive
            ? "linear-gradient(to bottom, #d97706, #92400e)"
            : isCompleted
            ? "#065f46"
            : "transparent",
        }}
      />
      <div className="pl-2">
        {comp.group && (
          <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-200/55 mb-1">
            {comp.group.name}
            {comp.group.ciaga_tag !== "none" && (
              <span className="ml-1.5 text-amber-300/70">{comp.group.ciaga_tag}</span>
            )}
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-emerald-50 leading-snug">{comp.name}</span>
          <span
            className={`shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full capitalize border ${
              isLive
                ? "bg-amber-900/50 text-amber-300 border-amber-800/50"
                : isCompleted
                ? "bg-emerald-900/60 text-emerald-300 border-emerald-800/50"
                : "bg-emerald-900/40 text-emerald-200/70 border-emerald-900/60"
            }`}
          >
            {comp.majors_status}
          </span>
        </div>
        <div className="text-[11px] text-emerald-100/60 flex items-center gap-2 mt-1">
          {comp.competition_date && (
            <span>{new Date(comp.competition_date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
          )}
          {comp.course && (
            <>
              <span className="text-emerald-800">·</span>
              <span className="truncate">{comp.course.name}</span>
            </>
          )}
          {comp.format && (
            <>
              <span className="text-emerald-800">·</span>
              <span className="capitalize">{comp.format}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function GroupCard({ group, onClick }: { group: MajorGroup & { member_count: number }; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-3 space-y-2 hover:border-emerald-700/70 transition-colors"
    >
      <div className="flex items-center gap-2.5">
        {group.image_url ? (
          <img src={group.image_url} alt={group.name} className="h-9 w-9 rounded-full object-cover border border-emerald-700/40" />
        ) : (
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-800 to-emerald-950 flex items-center justify-center text-[11px] font-bold text-emerald-200 shrink-0">
            {group.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-emerald-50 truncate leading-tight">{group.name}</div>
          <div className="text-[10px] text-emerald-100/50 capitalize">{group.type.replace(/_/g, " ")}</div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-emerald-200/55">{group.member_count} member{group.member_count !== 1 ? "s" : ""}</span>
        {group.ciaga_tag !== "none" && (
          <span className="text-amber-300/70 capitalize border border-amber-800/30 rounded-full px-1.5 py-0.5">{group.ciaga_tag}</span>
        )}
      </div>
    </button>
  );
}

export default function MajorsHubClient({ initialData }: Props) {
  const router = useRouter();
  const [data, setData] = useState<MajorHubSummary | null>(initialData);
  const [loading, setLoading] = useState(!initialData);

  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        const res = await fetch("/api/majors/hub", {
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
  }, [initialData]);

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] px-4 pt-8 max-w-sm mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-[11px] text-emerald-100/70 hover:text-emerald-50 flex items-center gap-1"
        >
          ← Home
        </button>
        <h1 className="text-lg font-bold tracking-wide text-[#f5e6b0]">Majors Hub</h1>
        <div className="w-14" />
      </div>

      {loading && (
        <div className="text-sm text-emerald-100/60 text-center py-10">Loading…</div>
      )}

      {data && (
        <>
          {/* Season Snapshot */}
          <div className="rounded-2xl border border-emerald-900/70 bg-gradient-to-br from-[#0b3b21]/90 to-[#071f13]/80 p-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55 mb-4">
              Season Snapshot
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Points", value: data.season_points },
                { label: "Rank", value: data.season_rank ?? "—" },
                { label: "Events", value: data.events_entered },
                { label: "Wins", value: data.wins },
              ].map((stat) => (
                <div key={stat.label}>
                  <div className="text-2xl font-extrabold text-[#f5e6b0] leading-none">{stat.value}</div>
                  <div className="text-[10px] text-emerald-200/55 mt-1">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Competitions */}
          {data.active_competitions.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55 flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                Live Now
              </h2>
              {data.active_competitions.map((c) => (
                <CompetitionCard key={c.id} comp={c} />
              ))}
            </section>
          )}

          {/* Upcoming Competitions */}
          {data.upcoming_competitions.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55">
                Upcoming
              </h2>
              {data.upcoming_competitions.slice(0, 3).map((c) => (
                <CompetitionCard key={c.id} comp={c} />
              ))}
            </section>
          )}

          {/* My Groups */}
          {data.my_groups.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55">My Groups</h2>
                <button
                  type="button"
                  onClick={() => router.push("/majors/groups/create")}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300"
                >
                  + New
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {data.my_groups.map((g) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    onClick={() => router.push(`/majors/groups/${g.id}`)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Discover */}
          {data.discover_groups.length > 0 && (
            <section className="space-y-2 pb-8">
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55">Discover Groups</h2>
              <div className="grid grid-cols-2 gap-2">
                {data.discover_groups.map((g) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    onClick={() => router.push(`/majors/groups/${g.id}`)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Empty state */}
          {data.my_groups.length === 0 && data.active_competitions.length === 0 && data.discover_groups.length === 0 && (
            <div className="text-center py-10 space-y-3">
              <p className="text-2xl">⛳</p>
              <p className="text-sm text-emerald-100/60">No groups or competitions yet.</p>
              <button
                type="button"
                onClick={() => router.push("/majors/groups/create")}
                className="px-5 py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600"
              >
                Create a Group
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
