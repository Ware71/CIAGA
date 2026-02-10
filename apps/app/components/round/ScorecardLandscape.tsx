"use client";

import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Participant, Hole } from "@/lib/rounds/hooks/useRoundDetail";

type LandscapeCol =
  | { kind: "hole"; hole: Hole }
  | { kind: "outMid" }
  | { kind: "outEnd" }
  | { kind: "inEnd" }
  | { kind: "totEnd" };

type SumKind = "OUT" | "IN" | "TOT";

function initialsFrom(name: string) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "U";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase().slice(0, 2);
}

function formatToPar(toPar: number | null) {
  if (toPar == null) return "";
  if (toPar === 0) return "E";
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

function strokesReceivedOnHole(courseHcp: number | null | undefined, holeStrokeIndex: number | null) {
  const hcp = typeof courseHcp === "number" && Number.isFinite(courseHcp) ? Math.max(0, Math.floor(courseHcp)) : 0;
  const si = typeof holeStrokeIndex === "number" && Number.isFinite(holeStrokeIndex) ? holeStrokeIndex : null;
  if (!hcp || !si) return 0;

  const base = Math.floor(hcp / 18);
  const rem = hcp % 18;

  return base + (si <= rem ? 1 : 0);
}

function StrokeDots({ count }: { count: number }) {
  const n = Math.max(0, Math.floor(count || 0));
  if (!n) return null;

  const shown = Math.min(n, 6);
  const extra = n - shown;

  return (
    <span className="inline-flex items-center gap-1">
      {Array.from({ length: shown }).map((_, i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-[#f5e6b0] border border-emerald-900/60"
        />
      ))}
      {extra > 0 ? <span className="text-[10px] text-emerald-100/70">+{extra}</span> : null}
    </span>
  );
}

export default function ScorecardLandscape(props: {
  participants: Participant[];
  holesList: Hole[];
  landscapePlan: LandscapeCol[];
  landscapeCols: string;

  canScore: boolean;
  isFinished: boolean;
  activeHole: number;
  savingKey: string | null;
  scoreView: "gross" | "net";

  metaSums: {
    parOut: number | null;
    parIn: number | null;
    parTot: number | null;
    ydsOut: number | null;
    ydsIn: number | null;
    ydsTot: number | null;
  };

  totals: Record<string, { out: number; in: number; total: number }>;

  // B: allow "PU" marker as well as numbers/null
  displayedScoreFor: (participantId: string, holeNumber: number) => string | number | null;
  onOpenEntry: (participantId: string, holeNumber: number) => void;

  getParticipantLabel: (p: Participant) => string;
  getParticipantAvatar: (p: Participant) => string | null;
}) {
  const {
    participants,
    holesList,
    landscapePlan,
    landscapeCols,
    canScore,
    isFinished,
    activeHole,
    savingKey,
    scoreView,
    metaSums,
    totals,
    displayedScoreFor,
    onOpenEntry,
    getParticipantLabel,
    getParticipantAvatar,
  } = props;

  const sumPar = (k: SumKind) => (k === "OUT" ? metaSums.parOut : k === "IN" ? metaSums.parIn : metaSums.parTot);
  const sumYds = (k: SumKind) => (k === "OUT" ? metaSums.ydsOut : k === "IN" ? metaSums.ydsIn : metaSums.ydsTot);

  return (
    <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid" style={{ gridTemplateColumns: landscapeCols }}>
            <div className="border-b border-emerald-900/60 bg-[#0b3b21]/70">
              {["HOLE", "PAR", "YDS", "SI"].map((lbl) => (
                <div
                  key={lbl}
                  className="h-7 px-2.5 flex items-center text-[10px] text-emerald-100/70 border-b border-emerald-900/60 last:border-b-0"
                >
                  {lbl}
                </div>
              ))}
            </div>

            {landscapePlan.map((c, idx) => {
              const isActive = !isFinished && c.kind === "hole" ? c.hole.hole_number === activeHole : false;

              const cell = (v: any) => (
                <div
                  className={`h-7 flex items-center justify-center text-[10px] border-r border-emerald-900/60 ${
                    isActive ? "bg-[#042713] text-[#f5e6b0]" : "bg-[#0b3b21]/40 text-emerald-100/80"
                  }`}
                >
                  {v ?? ""}
                </div>
              );

              if (c.kind === "hole") {
                return (
                  <div key={`meta-hole-${c.hole.hole_number}`} className="border-b border-emerald-900/60">
                    {cell(c.hole.hole_number)}
                    {cell(c.hole.par)}
                    {cell(c.hole.yardage)}
                    {cell(c.hole.stroke_index)}
                  </div>
                );
              }

              const label: SumKind =
                c.kind === "outMid" ? "OUT" : c.kind === "outEnd" ? "OUT" : c.kind === "inEnd" ? "IN" : "TOT";

              const par = sumPar(label);
              const yds = sumYds(label);

              return (
                <div key={`meta-sum-${c.kind}-${idx}`} className="border-b border-emerald-900/60">
                  {cell(label)}
                  {cell(par ?? "–")}
                  {cell(yds ?? "–")}
                  {cell("")}
                </div>
              );
            })}
          </div>

          <div className="divide-y divide-emerald-900/60">
            {participants.map((p) => {
              const name = getParticipantLabel(p);
              const avatarUrl = getParticipantAvatar(p);
              const t = totals[p.id];
              const hi = typeof p.handicap_index === "number" ? p.handicap_index.toFixed(1) : "–";
              const ch = typeof p.course_handicap === "number" ? String(p.course_handicap) : "–";

              return (
                <div key={p.id} className="grid" style={{ gridTemplateColumns: landscapeCols }}>
                  <div className="bg-[#0b3b21]/60">
                    <div className="h-10 px-2.5 flex items-center gap-2 min-w-0">
                      <Avatar className="h-6 w-6 border border-emerald-200/70 shrink-0">
                        {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                        <AvatarFallback className="text-[9px]">{initialsFrom(name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-emerald-50 truncate">{name}</div>
                        <div className="text-[10px] text-emerald-100/60 leading-none">
                          HI {hi} · CH {ch}
                        </div>
                      </div>
                    </div>
                  </div>

                  {landscapePlan.map((c, idx) => {
                    if (c.kind === "hole") {
                      const h = c.hole;
                      const s = displayedScoreFor(p.id, h.hole_number);
                      const key = `${p.id}:${h.hole_number}`;
                      const isActive = !isFinished && h.hole_number === activeHole;
                      const disabled = !canScore || isFinished;

                      const recv =
                        scoreView === "net"
                          ? strokesReceivedOnHole(p.course_handicap ?? null, h.stroke_index ?? null)
                          : 0;

                      return (
                        <button
                          key={`cell-hole-${idx}-${key}`}
                          className={`h-10 border-r border-emerald-900/60 flex flex-col items-center justify-center font-semibold tabular-nums text-[13px]
                            ${isActive ? "bg-[#042713] text-[#f5e6b0]" : "bg-[#0b3b21]/20 text-emerald-50"}
                            ${disabled ? "opacity-80 cursor-default" : "hover:bg-emerald-900/20"}
                          `}
                          onClick={() => onOpenEntry(p.id, h.hole_number)}
                          disabled={disabled}
                        >
                          <div className="leading-none">{savingKey === key ? "…" : (s ?? "–")}</div>
                          {scoreView === "net" && recv > 0 ? (
                            <div className="mt-1 leading-none">
                              <StrokeDots count={recv} />
                            </div>
                          ) : (
                            <div className="h-[6px]" />
                          )}
                        </button>
                      );
                    }

                    const value =
                      c.kind === "outMid" || c.kind === "outEnd"
                        ? t?.out ?? 0
                        : c.kind === "inEnd"
                        ? t?.in ?? 0
                        : t?.total ?? 0;

                    const label: SumKind =
                      c.kind === "outMid" || c.kind === "outEnd" ? "OUT" : c.kind === "inEnd" ? "IN" : "TOT";

                    const par = sumPar(label);
                    const toPar = typeof par === "number" ? value - par : null;

                    const isTot = c.kind === "totEnd";

                    return (
                      <div
                        key={`cell-sum-${p.id}-${idx}`}
                        className={`h-10 border-r border-emerald-900/60 flex flex-col items-center justify-center font-bold tabular-nums text-[12px]
                          ${isTot ? "bg-[#f5e6b0] text-[#042713]" : "bg-[#0b3b21]/30 text-emerald-50"}
                        `}
                      >
                        <div className="leading-none">{value}</div>
                        <div
                          className={`text-[10px] font-semibold leading-none ${
                            isTot ? "text-[#042713]/70" : "text-emerald-100/70"
                          }`}
                        >
                          {toPar != null ? formatToPar(toPar) : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
