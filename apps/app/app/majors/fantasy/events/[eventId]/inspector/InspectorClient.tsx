"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { safeJson } from "@/lib/fantasy/safeJson";

/**
 * Odds Inspector — sandbox-only dev tool. Renders every input the pricing
 * simulation consumed (profiles, resolved handicaps, per-hole μ/σ) alongside
 * the sim outputs and current market prices, so a mispriced board can be
 * traced to its cause in one screen.
 */

type InspectPayload = {
  event: {
    id: string; name: string; status: string; eventDate: string | null;
    numRounds: number | null; scoringModel: string | null;
    handicapRules: Record<string, unknown> | null; allowancePct: number;
    rankingBasis: string;
  };
  state: {
    version: number; odds_stale: boolean; is_final: boolean;
    last_refreshed_at: string | null; changed_reason: string | null;
  } | null;
  jobs: {
    id: string; status: string; reason: string; debounce_until: string;
    attempts: number; locked_at: string | null; last_error: string | null;
    created_at: string; updated_at: string;
  }[];
  simMeta: { version: number; simulationCount: number };
  holes: { holeNumber: number; par: number; yardage: number | null; strokeIndex: number }[];
  players: {
    profileId: string; name: string; playingHandicap: number;
    playingHandicapSource: string; completedHoles: number; roundComplete: boolean;
    modelPath: string;
    profile: {
      handicap_index: number | null; avg_gross: number | null; avg_net: number | null;
      score_stddev: number | null; recent_form: number | null;
      avg_differential: number | null; differential_stddev: number | null;
      differential_sample_size: number | null; differential_effective_n: number | null;
      birdies_per_round: number | null; eagles_per_round: number | null;
      sample_size: number; confidence: string; computed_at: string;
      recent_rounds: { playedAt: string; gross18: number; birdies: number; holes: number }[] | null;
      hole_splits: Record<string, unknown> | null;
    } | null;
    model: {
      sigmaPerHole: number; sigmaRound: number; sigmaSource: string; sigmaClamped: boolean;
      muByHole: number[]; eByHole: number[];
      formStatus: string;
      calibration: {
        birdie: {
          observedRate: number | null; sampleRounds: number; priorMean: number;
          priorStrength: number; targetRate: number; targetMass: number;
          preMass: number; postMass: number; factor: number; capped: boolean;
        };
        eagle: {
          observedRate: number | null; sampleRounds: number; priorMean: number;
          priorStrength: number; targetRate: number; targetMass: number;
          preMass: number; postMass: number; capped: boolean;
        };
        meanResidual: number; iterations: number;
      };
    };
    sim: {
      meanGross: number; meanNet: number; winProb: number;
      pFirstInclTies: number; expectedBirdies: number;
      topNProb: Record<number, number>;
      grossPercentiles: Record<string, number>; netPercentiles: Record<string, number>;
    };
  }[];
  markets: {
    id: string; marketType: string; displayName: string; status: string;
    params: Record<string, unknown>;
    selections: { key: string; label: string; probability: number; decimalOdds: number; eventVersion: number }[];
    probabilitySum: number;
  }[];
  generatedAt: string;
  error?: string;
};

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const num = (n: number | null | undefined, d = 1) => (n == null ? "—" : Number(n).toFixed(d));
const ago = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export default function InspectorClient({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [data, setData] = useState<InspectPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);
  const [openMarket, setOpenMarket] = useState<string | null>(null);

  const isSandbox = process.env.NEXT_PUBLIC_APP_ENV === "sandbox";

  const fetchData = useCallback(async () => {
    const session = await getViewerSession();
    if (!session) return;
    const res = await fetch(`/api/fantasy/events/${eventId}/inspect`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const j = (await safeJson(res)) as InspectPayload;
    if (res.ok) {
      setData(j);
      setError(null);
    } else {
      setError(j.error ?? "Failed to load");
    }
  }, [eventId]);

  useEffect(() => {
    if (!isSandbox) return;
    (async () => {
      setLoading(true);
      try {
        await fetchData();
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchData, isSandbox]);

  const exportExcel = useCallback(async () => {
    const session = await getViewerSession();
    if (!session) return;
    setBusy("export");
    setError(null);
    try {
      const res = await fetch(`/api/fantasy/events/${eventId}/inspect/export`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!res.ok) {
        const j = await safeJson(res);
        setError((j as { error?: string }).error ?? "Export failed");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="?([^"]+)"?/.exec(disposition);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] ?? "fantasy-inspect.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }, [eventId]);

  const runAction = useCallback(
    async (label: string, path: string, body?: unknown) => {
      const session = await getViewerSession();
      if (!session) return;
      setBusy(label);
      setError(null);
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const j = await safeJson(res);
        if (!res.ok) setError((j as { error?: string }).error ?? `${label} failed`);
        await fetchData();
      } finally {
        setBusy(null);
      }
    },
    [fetchData]
  );

  if (!isSandbox) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center text-emerald-100/60">
        The odds inspector is only available in the sandbox environment.
      </main>
    );
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-16 text-center text-emerald-100/60">
        Loading inspector…
      </main>
    );
  }

  const th = "px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-emerald-100/50";
  const td = "px-2 py-1.5 text-[11px] text-emerald-100/90 whitespace-nowrap";
  const card = "rounded-xl border border-emerald-900/70 bg-[#03200f] p-3";

  return (
    <main className="mx-auto max-w-5xl px-3 pb-24 pt-4 space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => router.push(`/majors/fantasy/events/${eventId}`)}
          className="rounded-lg border border-emerald-900/70 px-2.5 py-1.5 text-xs text-emerald-100/70"
        >
          ← Markets
        </button>
        <h1 className="text-base font-semibold text-emerald-50">Odds Inspector</h1>
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200">
          sandbox dev tool
        </span>
        <div className="ml-auto flex gap-2">
          <button
            disabled={!!busy}
            onClick={() => runAction("regenerate", `/api/fantasy/events/${eventId}/generate`)}
            className="rounded-lg border border-emerald-700/70 bg-emerald-800/40 px-2.5 py-1.5 text-xs text-emerald-100 disabled:opacity-50"
          >
            {busy === "regenerate" ? "Repricing…" : "Regenerate + reprice"}
          </button>
          <button
            disabled={!!busy}
            onClick={() => runAction("rebuild", `/api/fantasy/events/${eventId}/rebuild-profiles`)}
            className="rounded-lg border border-emerald-700/70 bg-emerald-800/40 px-2.5 py-1.5 text-xs text-emerald-100 disabled:opacity-50"
          >
            {busy === "rebuild" ? "Rebuilding…" : "Rebuild profiles"}
          </button>
          <button
            disabled={!!busy}
            onClick={exportExcel}
            className="rounded-lg border border-emerald-700/70 bg-emerald-800/40 px-2.5 py-1.5 text-xs text-emerald-100 disabled:opacity-50"
          >
            {busy === "export" ? "Exporting…" : "Export Excel"}
          </button>
          <button
            disabled={!data}
            onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2))}
            className="rounded-lg border border-emerald-900/70 px-2.5 py-1.5 text-xs text-emerald-100/70"
          >
            Copy JSON
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Event + state */}
          <section className={card}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-emerald-100/80 sm:grid-cols-4">
              <div><span className="text-emerald-100/50">Event</span> {data.event.name}</div>
              <div><span className="text-emerald-100/50">Status</span> {data.event.status}</div>
              <div><span className="text-emerald-100/50">Scoring</span> {data.event.scoringModel ?? "—"} / ranks {data.event.rankingBasis}</div>
              <div><span className="text-emerald-100/50">Allowance</span> {data.event.allowancePct}%</div>
              <div><span className="text-emerald-100/50">Rounds</span> {data.event.numRounds ?? 1}</div>
              <div><span className="text-emerald-100/50">Version</span> v{data.simMeta.version} · {data.simMeta.simulationCount.toLocaleString()} sims</div>
              <div><span className="text-emerald-100/50">Stale</span> {data.state ? String(data.state.odds_stale) : "no state"}</div>
              <div><span className="text-emerald-100/50">Refreshed</span> {ago(data.state?.last_refreshed_at)}</div>
            </div>
          </section>

          {/* Players */}
          <section className={card}>
            <h2 className="mb-2 text-xs font-semibold text-emerald-50">
              Players ({data.players.length}) — tap a row for per-hole μ + recent rounds
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-emerald-900/60">
                    <th className={th}>Player</th>
                    <th className={th}>PH</th>
                    <th className={th}>PH source</th>
                    <th className={th}>Path</th>
                    <th className={th}>HI</th>
                    <th className={th}>Diffs</th>
                    <th className={th}>Avg diff</th>
                    <th className={th}>σ diff</th>
                    <th className={th}>Neff</th>
                    <th className={th}>Shape</th>
                    <th className={th}>Avg gross</th>
                    <th className={th}>σ round</th>
                    <th className={th}>Form</th>
                    <th className={th}>Brd/rd</th>
                    <th className={th}>Mean G</th>
                    <th className={th}>Mean N</th>
                    <th className={th} title="Ties split evenly — prices the outright">Win</th>
                    <th className={th} title="Shared firsts in full — prices finish-position 1">P1st</th>
                    <th className={th}>Top3</th>
                    <th className={th}>G p5–p95</th>
                    <th className={th}>Built</th>
                  </tr>
                </thead>
                <tbody>
                  {data.players.map((p) => (
                    <PlayerRows
                      key={p.profileId}
                      p={p}
                      holes={data.holes}
                      open={openPlayer === p.profileId}
                      onToggle={() => setOpenPlayer(openPlayer === p.profileId ? null : p.profileId)}
                      td={td}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Markets */}
          <section className={card}>
            <h2 className="mb-2 text-xs font-semibold text-emerald-50">
              Markets ({data.markets.length}) — Σp flagged when a one-winner market drifts from 1
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-emerald-900/60">
                    <th className={th}>Market</th>
                    <th className={th}>Type</th>
                    <th className={th}>Status</th>
                    <th className={th}>Sel.</th>
                    <th className={th}>Σp</th>
                  </tr>
                </thead>
                <tbody>
                  {data.markets.map((m) => {
                    // score_total sums to ~N (N score values, each an independent
                    // under/exact/over triad) — excluded from the Σp≈1 check below.
                    const singleWinner = ["outright_winner", "h2h"].includes(m.marketType);
                    const sumOff = singleWinner && Math.abs(m.probabilitySum - 1) > 0.05;
                    return (
                      <>
                        <tr
                          key={m.id}
                          onClick={() => setOpenMarket(openMarket === m.id ? null : m.id)}
                          className="cursor-pointer border-b border-emerald-950/60 hover:bg-emerald-900/20"
                        >
                          <td className={td}>{m.displayName}</td>
                          <td className={td}>{m.marketType}</td>
                          <td className={td}>{m.status}</td>
                          <td className={td}>{m.selections.length}</td>
                          <td className={`${td} ${sumOff ? "text-amber-300" : ""}`}>
                            {m.probabilitySum.toFixed(3)}{sumOff ? " ⚠" : ""}
                          </td>
                        </tr>
                        {openMarket === m.id && (
                          <tr key={`${m.id}-detail`}>
                            <td colSpan={5} className="bg-emerald-950/40 px-3 py-2">
                              <div className="flex flex-wrap gap-2">
                                {m.selections.map((s) => (
                                  <span
                                    key={s.key}
                                    className="rounded-md border border-emerald-900/70 px-2 py-1 text-[10px] text-emerald-100/80"
                                  >
                                    {s.label}: {pct(s.probability)} → {s.decimalOdds.toFixed(2)} (v{s.eventVersion})
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Refresh jobs */}
          <section className={card}>
            <h2 className="mb-2 text-xs font-semibold text-emerald-50">Refresh jobs (last {data.jobs.length})</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-emerald-900/60">
                    <th className={th}>Status</th>
                    <th className={th}>Reason</th>
                    <th className={th}>Attempts</th>
                    <th className={th}>Updated</th>
                    <th className={th}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((j) => (
                    <tr key={j.id} className="border-b border-emerald-950/60">
                      <td className={td}>{j.status}</td>
                      <td className={td}>{j.reason}</td>
                      <td className={td}>{j.attempts}</td>
                      <td className={td}>{ago(j.updated_at)}</td>
                      <td className={`${td} max-w-[280px] overflow-hidden text-ellipsis`}>{j.last_error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function PlayerRows({
  p,
  holes,
  open,
  onToggle,
  td,
}: {
  p: InspectPayload["players"][number];
  holes: InspectPayload["holes"];
  open: boolean;
  onToggle: () => void;
  td: string;
}) {
  const prof = p.profile;
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-emerald-950/60 hover:bg-emerald-900/20"
      >
        <td className={`${td} font-medium`}>{p.name}</td>
        <td className={td}>{p.playingHandicap}</td>
        <td className={td}>{p.playingHandicapSource.replaceAll("_", " ")}</td>
        <td className={`${td} ${p.modelPath === "differential" ? "text-emerald-300" : "text-amber-300"}`}>
          {p.modelPath}
        </td>
        <td className={td}>{num(prof?.handicap_index)}</td>
        <td className={td}>{prof?.differential_sample_size ?? 0}</td>
        <td className={td}>{num(prof?.avg_differential)}</td>
        <td className={td}>{num(prof?.differential_stddev)}</td>
        <td className={td}>{num(prof?.differential_effective_n)}</td>
        <td className={td}>{prof?.sample_size ?? 0} ({prof?.confidence ?? "—"})</td>
        <td className={td}>{num(prof?.avg_gross)}</td>
        <td className={td}>{num(prof?.score_stddev)}</td>
        <td className={td}>{num(prof?.recent_form)}</td>
        <td className={td}>{num(prof?.birdies_per_round)}</td>
        <td className={td}>{num(p.sim.meanGross)}</td>
        <td className={td}>{num(p.sim.meanNet)}</td>
        <td className={td}>{pct(p.sim.winProb)}</td>
        <td className={td}>{pct(p.sim.pFirstInclTies)}</td>
        <td className={td}>{p.sim.topNProb[3] != null ? pct(p.sim.topNProb[3]) : "—"}</td>
        <td className={td}>{p.sim.grossPercentiles.p5}–{p.sim.grossPercentiles.p95}</td>
        <td className={td}>{ago(prof?.computed_at)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={21} className="bg-emerald-950/40 px-3 py-2">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {holes.map((h, i) => (
                  <span
                    key={h.holeNumber}
                    className="rounded-md border border-emerald-900/70 px-1.5 py-0.5 text-[10px] text-emerald-100/80"
                    title={`Par ${h.par} · SI ${h.strokeIndex}${h.yardage ? ` · ${h.yardage}y` : ""} · μ = latent mean, E = calibrated expected score (both vs par)`}
                  >
                    H{h.holeNumber}: μ+{p.model.muByHole[i]?.toFixed(2)} / E+{p.model.eByHole[i]?.toFixed(2)}
                  </span>
                ))}
                <span className="rounded-md border border-emerald-700/70 px-1.5 py-0.5 text-[10px] text-emerald-200">
                  σ/hole {p.model.sigmaPerHole.toFixed(2)} ({p.model.sigmaSource}
                  {p.model.sigmaClamped ? ", clamped" : ""})
                </span>
              </div>
              <div className="text-[10px] text-emerald-100/60">
                Birdie calibration: obs {num(p.model.calibration.birdie.observedRate, 2)}/rd over{" "}
                {p.model.calibration.birdie.sampleRounds} rds · prior{" "}
                {p.model.calibration.birdie.priorMean.toFixed(2)} (K {p.model.calibration.birdie.priorStrength}) →
                target {p.model.calibration.birdie.targetRate.toFixed(2)}/rd · model pre-cal{" "}
                {p.model.calibration.birdie.preMass.toFixed(2)} → post{" "}
                {p.model.calibration.birdie.postMass.toFixed(2)}
                {p.model.calibration.birdie.capped ? " · CAPPED" : ""} · sim E[brd]{" "}
                {p.sim.expectedBirdies.toFixed(2)} · mean residual{" "}
                {p.model.calibration.meanResidual.toFixed(3)} ({p.model.calibration.iterations} passes)
              </div>
              {prof?.recent_rounds && prof.recent_rounds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {prof.recent_rounds.map((r, i) => (
                    <span
                      key={i}
                      className="rounded-md bg-emerald-900/30 px-1.5 py-0.5 text-[10px] text-emerald-100/70"
                    >
                      {new Date(r.playedAt).toLocaleDateString()} · {r.gross18} ({r.holes}h, {r.birdies} brd)
                    </span>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-emerald-100/50">
                Net percentiles: p5 {p.sim.netPercentiles.p5} · p50 {p.sim.netPercentiles.p50} · p95 {p.sim.netPercentiles.p95}
                {" · "}completed holes {p.completedHoles}{p.roundComplete ? " · round complete" : ""}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
