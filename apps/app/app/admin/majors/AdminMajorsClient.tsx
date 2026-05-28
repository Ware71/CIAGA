"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";

export default function AdminMajorsClient() {
  const router = useRouter();
  const [log, setLog] = useState<string[]>([]);
  const [competitionId, setCompetitionId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [compStatus, setCompStatus] = useState("");
  const [working, setWorking] = useState(false);

  const addLog = (msg: string) => setLog((prev) => [...prev, msg]);

  const run = async (label: string, fn: (headers: Record<string, string>) => Promise<void>) => {
    setWorking(true);
    addLog(`[${new Date().toLocaleTimeString()}] Starting: ${label}`);
    try {
      const session = await getViewerSession();
      if (!session) { addLog("Error: not signed in"); return; }
      await fn({ Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" });
      addLog(`[${new Date().toLocaleTimeString()}] Done: ${label}`);
    } catch (e: any) {
      addLog(`Error: ${e?.message ?? "unknown"}`);
    } finally {
      setWorking(false);
    }
  };

  const recomputeLeaderboard = () =>
    run("Recompute leaderboard", async (headers) => {
      if (!competitionId.trim()) { addLog("Error: competition_id required"); return; }
      const res = await fetch(`/api/majors/events/${competitionId.trim()}/leaderboard`, {
        method: "POST",
        headers,
        body: JSON.stringify({ recompute: true }),
      });
      addLog(res.ok ? "Leaderboard recomputed" : `Failed: ${res.status}`);
    });

  const recomputeStandings = () =>
    run("Recompute group standings", async (headers) => {
      if (!groupId.trim()) { addLog("Error: group_id required"); return; }
      const res = await fetch(`/api/majors/groups/${groupId.trim()}/standings/recompute`, {
        method: "POST",
        headers,
      });
      addLog(res.ok ? "Standings recomputed" : `Failed: ${res.status}`);
    });

  const updateCompStatus = () =>
    run("Update competition status", async (headers) => {
      if (!competitionId.trim() || !compStatus) { addLog("Error: competition_id and status required"); return; }
      const res = await fetch(`/api/majors/events/${competitionId.trim()}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ majors_status: compStatus }),
      });
      addLog(res.ok ? `Status updated to ${compStatus}` : `Failed: ${res.status}`);
    });

  return (
    <div className="min-h-[100dvh] bg-[#042713] text-slate-100 pb-[env(safe-area-inset-bottom)] px-4 pt-8 max-w-sm mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => router.push("/majors")} className="text-[11px] text-emerald-100/70 hover:text-emerald-50">
          ← Majors
        </button>
        <h1 className="text-lg font-semibold text-[#f5e6b0]">Majors Admin</h1>
        <div className="w-14" />
      </div>

      {/* Competition tools */}
      <section className="space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-emerald-200/65">Competition Tools</div>
        <input
          type="text"
          value={competitionId}
          onChange={(e) => setCompetitionId(e.target.value)}
          placeholder="Competition ID (UUID)"
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
        />
        <button
          type="button"
          onClick={recomputeLeaderboard}
          disabled={working}
          className="w-full py-2 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30 disabled:opacity-50"
        >
          Recompute Leaderboard
        </button>
        <div className="flex gap-2">
          <select
            value={compStatus}
            onChange={(e) => setCompStatus(e.target.value)}
            className="flex-1 rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-sm text-emerald-50"
          >
            <option value="">Set status…</option>
            <option value="upcoming">upcoming</option>
            <option value="live">live</option>
            <option value="completed">completed</option>
            <option value="cancelled">cancelled</option>
          </select>
          <button
            type="button"
            onClick={updateCompStatus}
            disabled={working}
            className="px-4 py-2 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </section>

      {/* Group tools */}
      <section className="space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-emerald-200/65">Group Tools</div>
        <input
          type="text"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          placeholder="Group ID (UUID)"
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
        />
        <button
          type="button"
          onClick={recomputeStandings}
          disabled={working}
          className="w-full py-2 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30 disabled:opacity-50"
        >
          Recompute Season Standings
        </button>
      </section>

      {/* Log */}
      {log.length > 0 && (
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/65">Log</div>
          <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 p-3 space-y-1 max-h-48 overflow-y-auto">
            {log.map((entry, i) => (
              <div key={i} className="text-[11px] text-emerald-100/70 font-mono">{entry}</div>
            ))}
          </div>
          <button type="button" onClick={() => setLog([])} className="text-[11px] text-emerald-200/55 hover:text-emerald-200">
            Clear log
          </button>
        </section>
      )}
    </div>
  );
}
