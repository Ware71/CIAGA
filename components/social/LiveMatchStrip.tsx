// components/social/LiveMatchStrip.tsx
"use client";

import { useEffect, useState } from "react";
import { fetchLiveMatches } from "@/lib/social/api";

type LiveRound = {
  round_id: string;
  course_name: string;
  started_at: string | null;
  title: string;
  summary: string;
  participants: Array<{ id: string; name: string; avatar_url: string | null }>;
};

export default function LiveMatchStrip() {
  const [matches, setMatches] = useState<LiveRound[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetchLiveMatches();
      setMatches((res.matches ?? []) as LiveRound[]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-sm font-extrabold text-emerald-50">Live Matches</div>
        <div className="text-xs font-semibold text-emerald-100/60">{isLoading ? "Updating…" : null}</div>
      </div>

      <div className="mt-3">
        {matches.length === 0 ? (
          <div className="text-sm font-semibold text-emerald-100/70">No live matches right now.</div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {matches.map((m) => (
              <a
                key={m.round_id}
                href={`/round/${m.round_id}`}
                className={[
                  "min-w-[240px] rounded-xl border border-emerald-900/70 bg-[#042713]/55 p-3",
                  "hover:bg-[#042713]/75 transition",
                ].join(" ")}
              >
                <div className="text-sm font-extrabold text-emerald-50">{m.title}</div>
                <div className="mt-1 text-xs font-semibold text-emerald-100/70">{m.summary}</div>

                <div className="mt-2 flex -space-x-2">
                  {m.participants.slice(0, 5).map((p) => (
                    <div
                      key={p.id}
                      className="h-7 w-7 rounded-full border border-emerald-900/70 bg-[#0b3b21] overflow-hidden"
                      title={p.name}
                    >
                      {p.avatar_url ? (
                        <img src={p.avatar_url} alt={p.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-[10px] font-extrabold text-emerald-100/70">
                          {p.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
