"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { CompetitionWithGroup, LeaderboardEntryWithProfile } from "@/lib/majors/types";

type Tab = "overview" | "leaderboard" | "players" | "rules" | "results";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "players", label: "Players" },
  { id: "rules", label: "Rules" },
  { id: "results", label: "Results" },
];

type FinishedRound = { id: string; name: string | null; finished_at: string | null; course: string | null };

function SubmitRoundSheet({
  competitionId,
  rounds,
  onClose,
  onSubmit,
}: {
  competitionId: string;
  rounds: FinishedRound[];
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/competitions/${competitionId}/submit-round`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ round_id: selected }),
      });
      if (res.ok) { onSubmit(); onClose(); }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div
        className="w-full max-w-sm mx-auto rounded-t-3xl bg-[#0b3b21] border-t border-emerald-900/70 px-4 pt-5 pb-[env(safe-area-inset-bottom)] space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-emerald-50">Submit a Round</div>
        {rounds.length === 0 ? (
          <div className="text-sm text-emerald-100/60 py-4 text-center">
            No finished rounds available to submit.
          </div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {rounds.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r.id)}
                className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                  selected === r.id
                    ? "border-emerald-500 bg-emerald-900/50"
                    : "border-emerald-900/50 bg-emerald-900/20 hover:border-emerald-700/50"
                }`}
              >
                <div className="text-sm font-semibold text-emerald-50">{r.name ?? r.course ?? r.id.slice(0, 8)}</div>
                {r.finished_at && (
                  <div className="text-[10px] text-emerald-100/55">
                    {new Date(r.finished_at).toLocaleDateString()}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-full border border-emerald-900/60 text-sm text-emerald-200/70">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selected || submitting}
            className="flex-1 py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CompetitionDetailClient({ competitionId }: { competitionId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [competition, setCompetition] = useState<CompetitionWithGroup | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntryWithProfile[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEntered, setIsEntered] = useState(false);
  const [entering, setEntering] = useState(false);
  const [showSubmitSheet, setShowSubmitSheet] = useState(false);
  const [finishedRounds, setFinishedRounds] = useState<FinishedRound[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        setMyProfileId(session.profileId);
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        const [compRes, lbRes, entriesRes, roundsRes] = await Promise.all([
          fetch(`/api/majors/competitions/${competitionId}`, { headers }),
          fetch(`/api/majors/competitions/${competitionId}/leaderboard`, { headers }),
          fetch(`/api/majors/competitions/${competitionId}?include=entries`, { headers }),
          // Fetch finished rounds for submit sheet
          fetch(`/api/rounds?status=finished&limit=20`, { headers }),
        ]);

        if (cancelled) return;
        if (compRes.ok) {
          const j = await compRes.json();
          setCompetition(j.competition);
        }
        if (lbRes.ok) {
          const j = await lbRes.json();
          setLeaderboard(j.rows ?? []);
        }

        // Fetch competition entries directly
        const { supabase: _ } = await import("@supabase/supabase-js").catch(() => ({ supabase: null })) as any;

        // Load finished rounds
        if (roundsRes.ok) {
          const j = await roundsRes.json();
          const rounds = (j.rounds ?? []) as any[];
          setFinishedRounds(rounds.map((r: any) => ({
            id: r.id,
            name: r.name,
            finished_at: r.finished_at,
            course: null,
          })));
        }

        // Check if user is entered
        const checkEntryRes = await fetch(
          `/api/majors/competitions/${competitionId}/enter`,
          { method: "GET", headers }
        ).catch(() => null);
        // GET on enter endpoint doesn't exist — check via profile
        setIsEntered(false); // Will refine below
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [competitionId]);

  // Check entry status from leaderboard or entries list
  useEffect(() => {
    if (myProfileId && leaderboard.length > 0) {
      setIsEntered(leaderboard.some((e) => e.profile_id === myProfileId));
    }
  }, [leaderboard, myProfileId]);

  const handleEnter = async () => {
    setEntering(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/competitions/${competitionId}/enter`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) setIsEntered(true);
    } finally {
      setEntering(false);
    }
  };

  const handleSubmitDone = async () => {
    // Refresh leaderboard
    const session = await getViewerSession();
    if (!session) return;
    const res = await fetch(`/api/majors/competitions/${competitionId}/leaderboard`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (res.ok) {
      const j = await res.json();
      setLeaderboard(j.rows ?? []);
      setIsEntered(true);
    }
  };

  const now = new Date();
  const entryOpen = competition
    ? (!competition.entry_window_start || new Date(competition.entry_window_start) <= now) &&
      (!competition.entry_window_end || new Date(competition.entry_window_end) >= now) &&
      competition.majors_status !== "completed" &&
      competition.majors_status !== "cancelled"
    : false;

  const visibleTabs = competition?.majors_status === "completed"
    ? TABS
    : TABS.filter((t) => t.id !== "results");

  const tabContent: Record<Tab, React.ReactNode> = {
    overview: competition ? (
      <div className="space-y-4">
        {competition.description && (
          <p className="text-[13px] text-emerald-100/75 leading-relaxed">{competition.description}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Format", value: competition.format ?? competition.competition_type },
            { label: "Scoring", value: competition.scoring_model },
            { label: "Rounds", value: competition.num_rounds },
            { label: "Status", value: competition.majors_status },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2">
              <div className="text-[10px] text-emerald-200/55 uppercase tracking-wider">{item.label}</div>
              <div className="text-sm font-semibold text-emerald-50 capitalize">{item.value ?? "—"}</div>
            </div>
          ))}
        </div>
        {competition.competition_date && (
          <div className="text-[12px] text-emerald-100/60">
            Date: {new Date(competition.competition_date).toLocaleDateString()}
          </div>
        )}
        {competition.course && (
          <div className="text-[12px] text-emerald-100/60">Course: {competition.course.name}</div>
        )}
        {competition.entry_window_end && (
          <div className="text-[12px] text-emerald-100/60">
            Entry closes: {new Date(competition.entry_window_end).toLocaleDateString()}
          </div>
        )}

        {/* Entry/Submit CTAs */}
        {!isEntered && entryOpen && (
          <button
            type="button"
            onClick={handleEnter}
            disabled={entering}
            className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {entering ? "Entering…" : "Enter Competition"}
          </button>
        )}
        {isEntered && (
          <div className="flex gap-3">
            <div className="flex-1 py-3 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-300 text-center">
              ✓ Entered
            </div>
            <button
              type="button"
              onClick={() => setShowSubmitSheet(true)}
              className="flex-1 py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600"
            >
              Submit Round
            </button>
          </div>
        )}
      </div>
    ) : null,

    leaderboard: (
      <div className="space-y-2">
        {leaderboard.length === 0 && (
          <div className="text-sm text-emerald-100/60 text-center py-8">
            No results yet. Submit a round to appear here.
          </div>
        )}
        {leaderboard.map((row) => (
          <div key={row.id} className="flex items-center gap-3 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2">
            <span className="w-6 text-center text-xs font-extrabold text-[#f5e6b0]">{row.position ?? "—"}</span>
            {row.profile?.avatar_url ? (
              <img src={row.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200">
                {row.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
              </div>
            )}
            <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{row.profile?.name ?? "Unknown"}</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-[#f5e6b0]">{row.net_score ?? row.gross_score ?? "—"}</div>
              <div className="text-[10px] text-emerald-100/50">{row.rounds_submitted} rnd</div>
            </div>
          </div>
        ))}
      </div>
    ),

    players: (
      <div className="space-y-2">
        {entries.length === 0 && (
          <div className="text-sm text-emerald-100/60 text-center py-8">No entries yet.</div>
        )}
      </div>
    ),

    rules: competition ? (
      <div className="space-y-4 text-[13px] text-emerald-100/75 leading-relaxed">
        {competition.rules_text ? (
          <p>{competition.rules_text}</p>
        ) : (
          <p className="text-emerald-100/50">No custom rules specified.</p>
        )}
        <div className="space-y-2">
          {competition.scoring_model && (
            <div><span className="text-emerald-200/60">Scoring:</span> {competition.scoring_model}</div>
          )}
          {competition.num_rounds > 1 && (
            <div><span className="text-emerald-200/60">Rounds:</span> {competition.num_rounds}</div>
          )}
          {competition.standings_contribution !== "event_only" && (
            <div><span className="text-emerald-200/60">Contributes to:</span> {competition.standings_contribution}</div>
          )}
        </div>
      </div>
    ) : null,

    results: (
      <div className="space-y-2">
        {leaderboard.length === 0 ? (
          <div className="text-sm text-emerald-100/60 text-center py-8">No final results.</div>
        ) : (
          leaderboard.map((row) => (
            <div key={row.id} className="flex items-center gap-3 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2">
              <span className="w-6 text-center text-xs font-extrabold text-[#f5e6b0]">{row.position ?? "—"}</span>
              <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{row.profile?.name ?? "Unknown"}</span>
              <div className="text-right">
                <div className="text-xs font-extrabold text-[#f5e6b0]">{row.net_score ?? row.gross_score ?? "—"}</div>
                {row.points_earned != null && row.points_earned > 0 && (
                  <div className="text-[10px] text-amber-300/70">+{row.points_earned} pts</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    ),
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <div className="text-sm text-emerald-100/60">Loading…</div>
      </div>
    );
  }

  if (!competition) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-4">
        <div className="text-sm text-emerald-100/60">Competition not found.</div>
        <button type="button" onClick={() => router.push("/majors")} className="text-sm text-emerald-200 underline">
          Back to Hub
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] pt-8 max-w-sm mx-auto">
      {/* Header */}
      <div className="px-4 flex items-center justify-between mb-2">
        <button type="button" onClick={() => router.back()} className="text-[11px] text-emerald-100/70 hover:text-emerald-50">
          ← Back
        </button>
        <h1 className="text-base font-semibold text-[#f5e6b0] truncate max-w-[180px]">{competition.name}</h1>
        <div className="w-14" />
      </div>

      {competition.group && (
        <div className="px-4 mb-4">
          <button
            type="button"
            onClick={() => router.push(`/majors/groups/${competition.group!.id}`)}
            className="text-[11px] text-emerald-200/60 hover:text-emerald-200"
          >
            {competition.group.name} →
          </button>
        </div>
      )}

      {/* Tab strip */}
      <div className="overflow-x-auto px-4 mb-5">
        <div className="flex gap-2">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                tab === t.id
                  ? "bg-emerald-700 text-white"
                  : "border border-emerald-900/60 text-emerald-200/70 hover:text-emerald-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-8">{tabContent[tab]}</div>

      {showSubmitSheet && (
        <SubmitRoundSheet
          competitionId={competitionId}
          rounds={finishedRounds}
          onClose={() => setShowSubmitSheet(false)}
          onSubmit={handleSubmitDone}
        />
      )}
    </div>
  );
}
