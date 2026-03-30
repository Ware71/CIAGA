"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { MajorHubSummary, CompetitionWithGroup, MajorGroup } from "@/lib/majors/types";

type Props = {
  initialData: MajorHubSummary | null;
};

function CompetitionCard({ comp, showGroup = true }: { comp: CompetitionWithGroup; showGroup?: boolean }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(`/majors/competitions/${comp.id}`)}
      className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-1 hover:border-emerald-700/70 transition-colors"
    >
      {showGroup && comp.group && (
        <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-200/60">
          {comp.group.name}
          {comp.group.ciaga_tag !== "none" && (
            <span className="ml-2 text-amber-300/80">{comp.group.ciaga_tag}</span>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-emerald-50 truncate">{comp.name}</span>
        <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-900/60 text-emerald-200/80 capitalize">
          {comp.majors_status}
        </span>
      </div>
      <div className="text-[11px] text-emerald-100/70 flex items-center gap-3">
        {comp.competition_date && (
          <span>{new Date(comp.competition_date).toLocaleDateString()}</span>
        )}
        {comp.course && <span>{comp.course.name}</span>}
        {comp.format && <span className="capitalize">{comp.format}</span>}
      </div>
    </button>
  );
}

function GroupCard({ group, onClick }: { group: MajorGroup & { member_count: number }; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 w-48 text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-3 space-y-1 hover:border-emerald-700/70 transition-colors"
    >
      <div className="flex items-center gap-2">
        {group.image_url ? (
          <img src={group.image_url} alt={group.name} className="h-7 w-7 rounded-full object-cover" />
        ) : (
          <div className="h-7 w-7 rounded-full bg-emerald-900/60 flex items-center justify-center text-[10px] font-bold text-emerald-200">
            {group.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <span className="text-xs font-semibold text-emerald-50 truncate">{group.name}</span>
      </div>
      <div className="text-[10px] text-emerald-100/60 capitalize">{group.type.replace("_", " ")}</div>
      {group.ciaga_tag !== "none" && (
        <div className="text-[10px] text-amber-300/80 capitalize">{group.ciaga_tag}</div>
      )}
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

  const backArrow = (
    <button
      type="button"
      onClick={() => router.push("/")}
      className="text-[11px] text-emerald-100/70 hover:text-emerald-50 flex items-center gap-1"
    >
      ← Home
    </button>
  );

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] px-4 pt-8 max-w-sm mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        {backArrow}
        <h1 className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Majors Hub</h1>
        <div className="w-14" />
      </div>

      {loading && (
        <div className="text-sm text-emerald-100/60 text-center py-10">Loading…</div>
      )}

      {data && (
        <>
          {/* Season Snapshot */}
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65 mb-3">
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
                  <div className="text-base font-extrabold text-[#f5e6b0]">{stat.value}</div>
                  <div className="text-[10px] text-emerald-200/60">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Competitions */}
          {data.active_competitions.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">
                Live Competitions
              </h2>
              {data.active_competitions.map((c) => (
                <CompetitionCard key={c.id} comp={c} />
              ))}
            </section>
          )}

          {/* Upcoming Competitions */}
          {data.upcoming_competitions.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">
                Upcoming
              </h2>
              {data.upcoming_competitions.slice(0, 3).map((c) => (
                <CompetitionCard key={c.id} comp={c} />
              ))}
            </section>
          )}

          {/* Quick Actions */}
          <section className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => router.push("/majors/groups/create")}
              className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 text-sm font-semibold text-emerald-50 hover:border-emerald-700/70 transition-colors"
            >
              + Create Group
            </button>
            <button
              type="button"
              onClick={() => router.push("/majors/competitions/create")}
              className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 text-sm font-semibold text-emerald-50 hover:border-emerald-700/70 transition-colors"
            >
              + Create Competition
            </button>
            <button
              type="button"
              onClick={() => router.push("/majors/profile")}
              className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 text-sm font-semibold text-emerald-50 hover:border-emerald-700/70 transition-colors"
            >
              My Majors Profile
            </button>
            <button
              type="button"
              className="rounded-2xl border border-emerald-900/40 bg-[#0b3b21]/40 p-4 text-sm font-semibold text-emerald-100/40 cursor-not-allowed"
              disabled
            >
              Fantasy Picks
              <span className="ml-1 text-[10px] text-emerald-200/40">Coming soon</span>
            </button>
          </section>

          {/* My Groups */}
          {data.my_groups.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">
                  My Groups
                </h2>
              </div>
              <div className="overflow-x-auto -mx-4 px-4">
                <div className="flex gap-3 pb-2">
                  {data.my_groups.map((g) => (
                    <GroupCard
                      key={g.id}
                      group={g}
                      onClick={() => router.push(`/majors/groups/${g.id}`)}
                    />
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Discover */}
          {data.discover_groups.length > 0 && (
            <section className="space-y-2 pb-8">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">
                  Discover
                </h2>
              </div>
              <div className="overflow-x-auto -mx-4 px-4">
                <div className="flex gap-3 pb-2">
                  {data.discover_groups.map((g) => (
                    <GroupCard
                      key={g.id}
                      group={g}
                      onClick={() => router.push(`/majors/groups/${g.id}`)}
                    />
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Empty state */}
          {data.my_groups.length === 0 && data.active_competitions.length === 0 && (
            <div className="text-center py-10 space-y-3">
              <p className="text-sm text-emerald-100/60">
                You haven't joined any groups yet.
              </p>
              <button
                type="button"
                onClick={() => router.push("/majors/groups/create")}
                className="px-4 py-2 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30"
              >
                Create your first group
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
