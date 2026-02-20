"use client";

import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Participant, Hole } from "@/lib/rounds/hooks/useRoundDetail";
import { isFormatView, type FormatScoreView, type FormatDisplayData } from "@/lib/rounds/formatScoring";
import { strokesReceivedOnHole } from "@/lib/rounds/handicapUtils";

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

type BadgeType = "eagle" | "birdie" | "bogey" | "double" | null;

function scoreBadgeType(s: string | number | null, par: number | null, scoreView: FormatScoreView): BadgeType {
  if (isFormatView(scoreView) || typeof s !== "number" || typeof par !== "number") return null;
  const diff = s - par;
  if (diff <= -2) return "eagle";
  if (diff === -1) return "birdie";
  if (diff === 1) return "bogey";
  if (diff >= 2) return "double";
  return null;
}

function BadgeWrap({ type, children }: { type: BadgeType; children: React.ReactNode }) {
  if (!type) return <>{children}</>;
  const cls =
    type === "eagle"
      ? "inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-[#f5e6b0] text-[#042713] px-0.5"
      : type === "birdie"
      ? "inline-flex items-center justify-center min-w-[20px] h-5 rounded-full ring-1 ring-[#f5e6b0] px-0.5"
      : type === "bogey"
      ? "inline-flex items-center justify-center min-w-[20px] h-5 ring-1 ring-white/50 px-0.5"
      : "inline-flex items-center justify-center min-w-[20px] h-5 bg-white/50 px-0.5";
  return <span className={cls}>{children}</span>;
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

export default function ScorecardPortrait(props: {
  participants: Participant[];
  holesList: Hole[];
  portraitCols: string;
  compactPlayers: boolean;

  canScore: boolean;
  isFinished: boolean;
  activeHole: number;
  savingKey: string | null;
  scoreView: FormatScoreView;
  formatDisplay: FormatDisplayData | null;

  metaSums: {
    parOut: number | null;
    parIn: number | null;
    parTot: number | null;
    ydsOut: number | null;
    ydsIn: number | null;
    ydsTot: number | null;
  };

  totals: Record<string, { out: number | string; in: number | string; total: number | string }>;

  // B: allow "PU" marker as well as numbers/null
  displayedScoreFor: (participantId: string, holeNumber: number) => string | number | null;
  onOpenEntry: (participantId: string, holeNumber: number) => void;

  getParticipantLabel: (p: Participant) => string;
  getParticipantAvatar: (p: Participant) => string | null;
}) {
  const {
    participants,
    holesList,
    portraitCols,
    compactPlayers,
    canScore,
    isFinished,
    activeHole,
    savingKey,
    scoreView,
    formatDisplay,
    metaSums,
    totals,
    displayedScoreFor,
    onOpenEntry,
    getParticipantLabel,
    getParticipantAvatar,
  } = props;

  const portraitTag = (text: string) => <div className="text-[10px] font-semibold leading-none">{text}</div>;

  const sumPar = (k: SumKind) => (k === "OUT" ? metaSums.parOut : k === "IN" ? metaSums.parIn : metaSums.parTot);
  const sumYds = (k: SumKind) => (k === "OUT" ? metaSums.ydsOut : k === "IN" ? metaSums.ydsIn : metaSums.ydsTot);

  // Suppress "to par" for formats where values aren't strokes (stableford, match play, skins, etc.)
  const suppressToPar = isFormatView(scoreView) && formatDisplay != null && (
    formatDisplay.higherIsBetter || formatDisplay.summaries.some(s => typeof s.total === "string")
  );

  return (
    <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 overflow-hidden">
      <div className="w-full">
        <div className="w-full" style={{ display: "grid", gridTemplateColumns: portraitCols }}>
          {/* Header row (portrait: compact) */}
          <div className="h-7 flex items-center justify-center text-emerald-100/80 border-b border-r border-emerald-900/60 bg-[#0b3b21]/60">
            {portraitTag("#")}
          </div>
          <div className="h-7 flex items-center justify-center text-emerald-100/80 border-b border-r border-emerald-900/60 bg-[#0b3b21]/60">
            {portraitTag("Par")}
          </div>
          <div className="h-7 flex items-center justify-center text-emerald-100/80 border-b border-r border-emerald-900/60 bg-[#0b3b21]/60">
            {portraitTag("Yds")}
          </div>
          <div className="h-7 flex items-center justify-center text-emerald-100/80 border-b border-r border-emerald-900/60 bg-[#0b3b21]/60">
            {portraitTag("SI")}
          </div>

          {participants.map((p) => {
            const name = getParticipantLabel(p);
            const avatarUrl = getParticipantAvatar(p);
            const hi = typeof p.handicap_index === "number" ? p.handicap_index.toFixed(1) : "–";
            const ch = typeof p.course_handicap === "number" ? String(p.course_handicap) : "–";

            // Format tab: show assigned HI and PH; Net: show HI/CH; Gross: no handicap info
            const isFormat = isFormatView(scoreView);
            const ph = isFormat && formatDisplay?.playingHandicaps?.[p.id] != null
              ? String(formatDisplay.playingHandicaps[p.id])
              : null;
            const hcpLabel = isFormat
              ? `HI ${hi} · PH ${ph ?? "–"}`
              : scoreView === "net"
                ? `HI ${hi} · CH ${ch}`
                : "";

            const title = `${name} · HI ${hi} · CH ${ch}${ph != null ? ` · PH ${ph}` : ""}`;

            return (
              <div
                key={`ph-${p.id}`}
                className="h-7 px-1 flex items-center justify-center border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 min-w-0"
                title={title}
              >
                {compactPlayers ? (
                  <div className="text-[10px] font-semibold text-emerald-50">{initialsFrom(name)}</div>
                ) : (
                  <div className="flex items-center gap-1 min-w-0">
                    <Avatar className="h-4.5 w-4.5 border border-emerald-200/70 shrink-0">
                      {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                      <AvatarFallback className="text-[8px]">{initialsFrom(name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col items-start min-w-0">
                      <div className="text-[10px] text-emerald-50 truncate min-w-0 leading-none">{name}</div>
                      {hcpLabel ? (
                        <div className="text-[9px] text-emerald-100/60 leading-none">
                          {hcpLabel}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Hole rows + OUT between 9 and 10 */}
          {holesList.flatMap((h) => {
            const nodes: React.ReactElement[] = [];
            const isActive = !isFinished && h.hole_number === activeHole;

            const metaCell = (v: any, key: string) => (
              <div
                key={key}
                className={`h-9 flex items-center justify-center text-[11px] border-b border-r border-emerald-900/60 ${
                  isActive ? "bg-[#042713] text-[#f5e6b0]" : "bg-[#0b3b21]/25 text-emerald-100/80"
                }`}
              >
                {v ?? "–"}
              </div>
            );

            nodes.push(
              metaCell(h.hole_number, `h-${h.hole_number}-n`),
              metaCell(h.par, `h-${h.hole_number}-p`),
              metaCell(h.yardage, `h-${h.hole_number}-y`),
              metaCell(h.stroke_index, `h-${h.hole_number}-si`)
            );

            participants.forEach((p) => {
              const s = displayedScoreFor(p.id, h.hole_number);
              const key = `${p.id}:${h.hole_number}`;
              const disabled = !canScore || isFinished;

              const recv =
                scoreView === "net"
                  ? strokesReceivedOnHole(p.course_handicap ?? null, h.stroke_index ?? null)
                  : 0;

              const fmtHint =
                isFormatView(scoreView) && formatDisplay
                  ? formatDisplay.holeResults[key]?.cssHint
                  : undefined;

              const fmtColor =
                fmtHint === "positive" ? "text-green-300" :
                fmtHint === "won" ? "text-green-300" :
                fmtHint === "negative" ? "text-emerald-100/50" :
                fmtHint === "lost" ? "text-red-300/80" :
                fmtHint === "halved" ? "text-emerald-100/70" :
                "";

              const badge = savingKey !== key ? scoreBadgeType(s, h.par, scoreView) : null;

            nodes.push(
                <button
                  key={`sc-${key}`}
                  className={`h-9 border-b border-r border-emerald-900/60 flex flex-col items-center justify-center font-semibold tabular-nums
                    ${compactPlayers ? "text-[12px]" : "text-[13px]"}
                    ${isActive ? "bg-[#042713] text-[#f5e6b0]" : "bg-[#0b3b21]/15 text-emerald-50"}
                    ${disabled ? "opacity-80 cursor-default" : "hover:bg-emerald-900/20"}
                    ${fmtColor}
                  `}
                  onClick={() => onOpenEntry(p.id, h.hole_number)}
                  disabled={disabled}
                >
                  <BadgeWrap type={badge}>
                    <span className="leading-none">{savingKey === key ? "…" : (s ?? "–")}</span>
                  </BadgeWrap>
                  {recv > 0 ? (
                    <div className="mt-1 leading-none">
                      <StrokeDots count={recv} />
                    </div>
                  ) : (
                    <div className="h-[6px]" />
                  )}
                </button>
              );
            });

            if (h.hole_number === 9) {
              const parOut = sumPar("OUT");
              const ydsOut = sumYds("OUT");

              nodes.push(
                <div
                  key="out-mid-label"
                  className="h-9 flex items-center justify-center text-[10px] font-semibold border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 text-emerald-100/80"
                >
                  OUT
                </div>,
                <div
                  key="out-mid-par"
                  className="h-9 flex items-center justify-center text-[11px] border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 text-emerald-100/80"
                >
                  {parOut ?? "–"}
                </div>,
                <div
                  key="out-mid-yds"
                  className="h-9 flex items-center justify-center text-[11px] border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 text-emerald-100/80"
                >
                  {ydsOut ?? "–"}
                </div>,
                <div key="out-mid-si" className="h-9 border-b border-r border-emerald-900/60 bg-[#0b3b21]/60" />
              );

              participants.forEach((p) => {
                const par = metaSums.parOut;
                const val = totals[p.id]?.out ?? 0;
                const toPar = suppressToPar || typeof val !== "number" ? null : (typeof par === "number" ? val - par : null);

                nodes.push(
                  <div
                    key={`out-mid-${p.id}`}
                    className="h-9 border-b border-r border-emerald-900/60 flex flex-col items-center justify-center font-bold tabular-nums text-[12px] bg-[#0b3b21]/35 text-emerald-50"
                  >
                    <div className="leading-none">{val}</div>
                    <div className="text-[10px] font-semibold text-emerald-100/70 leading-none">
                      {toPar != null ? formatToPar(toPar) : ""}
                    </div>
                  </div>
                );
              });
            }

            return nodes;
          })}

          {/* Totals rows at end: OUT / IN / TOT */}
          {(["OUT", "IN", "TOT"] as const).flatMap((label) => {
            const isTot = label === "TOT";
            const nodes: React.ReactElement[] = [];

            const par = sumPar(label);
            const yds = sumYds(label);

            nodes.push(
              <div
                key={`lbl-${label}`}
                className="h-9 flex items-center justify-center text-[10px] font-semibold border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 text-emerald-100/80"
              >
                {label}
              </div>,
              <div
                key={`par-${label}`}
                className="h-9 flex items-center justify-center text-[11px] border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 text-emerald-100/80"
              >
                {par ?? "–"}
              </div>,
              <div
                key={`yds-${label}`}
                className="h-9 flex items-center justify-center text-[11px] border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 text-emerald-100/80"
              >
                {yds ?? "–"}
              </div>,
              <div key={`si-${label}`} className="h-9 border-b border-r border-emerald-900/60 bg-[#0b3b21]/60" />
            );

            participants.forEach((p) => {
              const t = totals[p.id];
              const val = label === "OUT" ? t?.out ?? 0 : label === "IN" ? t?.in ?? 0 : t?.total ?? 0;
              const toPar = suppressToPar || typeof val !== "number" ? null : (typeof par === "number" ? val - par : null);

              nodes.push(
                <div
                  key={`tot-${label}-${p.id}`}
                  className={`h-9 border-b border-r border-emerald-900/60 flex flex-col items-center justify-center font-bold tabular-nums ${
                    compactPlayers ? "text-[12px]" : "text-[13px]"
                  } ${isTot ? "bg-[#f5e6b0] text-[#042713]" : "bg-[#0b3b21]/40 text-emerald-50"}`}
                >
                  <div className="leading-none">{val}</div>
                  <div
                    className={`text-[10px] font-semibold leading-none ${
                      isTot ? "text-[#042713]/70" : "text-emerald-100/70"
                    }`}
                  >
                    {toPar != null ? formatToPar(toPar) : ""}
                  </div>
                </div>
              );
            });

            return nodes;
          })}
        </div>
      </div>
    </div>
  );
}
