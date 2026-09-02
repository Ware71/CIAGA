"use client";

import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Participant, Hole, HoleState } from "@/lib/rounds/hooks/useRoundDetail";
import { isFormatView, relToParForRange, type FormatScoreView, type FormatDisplayData } from "@/lib/rounds/formatScoring";
import { strokesReceivedOnHole, formatHI } from "@/lib/rounds/handicapUtils";
import { BadgeWrap, StrokeDots, PlusIndicator, scoreBadgeType } from "./ScorecardCells";

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

export default function ScorecardLandscape(props: {
  participants: Participant[];
  holesList: Hole[];
  landscapePlan: LandscapeCol[];
  landscapeCols: string;

  canScore: boolean;
  isFinished: boolean;
  activeHole: number;
  /** First hole with a non-removed entry (or manual override). Shows a badge when != 1. */
  startingHole?: number;
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

  displayedScoreFor: (participantId: string, holeNumber: number) => string | number | null;
  holeStateFor: (participantId: string, holeNumber: number) => HoleState;
  onOpenEntry: (participantId: string, holeNumber: number) => void;

  getParticipantLabel: (p: Participant) => string;
  getParticipantAvatar: (p: Participant) => string | null;
  /** Wolf role tag per `${participantId}:${holeNumber}` (W/WP/LW/BW). */
  wolfRoleByKey?: Record<string, "W" | "WP" | "LW" | "BW">;

  /**
   * This player's own hole. The PAR/YDS/SI rows show ONE tee (whichever the
   * toggle selects), but a player on a different tee has their own par and
   * stroke index. Defaults to identity for a single-tee round.
   */
  holeFor?: (participantId: string, hole: Hole) => Hole;
  holeCountFor?: (participantId: string) => number;
  /** Short tee name shown against each player when the round has >1 tee. */
  teeLabelFor?: (p: Participant) => string | null;
}) {
  const {
    participants,
    holesList,
    landscapePlan,
    landscapeCols,
    canScore,
    isFinished,
    activeHole,
    startingHole = 1,
    savingKey,
    scoreView,
    formatDisplay,
    metaSums,
    totals,
    displayedScoreFor,
    holeStateFor,
    onOpenEntry,
    getParticipantLabel,
    getParticipantAvatar,
    wolfRoleByKey,
    holeFor,
    holeCountFor,
    teeLabelFor,
  } = props;

  const holeOf = (pid: string, h: Hole): Hole => (holeFor ? holeFor(pid, h) : h);
  const countOf = (pid: string): number => (holeCountFor ? holeCountFor(pid) : holesList.length);

  const sumPar = (k: SumKind) => (k === "OUT" ? metaSums.parOut : k === "IN" ? metaSums.parIn : metaSums.parTot);
  const sumYds = (k: SumKind) => (k === "OUT" ? metaSums.ydsOut : k === "IN" ? metaSums.ydsIn : metaSums.ydsTot);

  // Suppress "to par" for formats where values aren't strokes (stableford, match play, skins, etc.)
  const suppressToPar = isFormatView(scoreView) && formatDisplay != null && (
    formatDisplay.higherIsBetter || formatDisplay.summaries.some(s => typeof s.total === "string")
  );

  // Format views that are stroke-based (not points/string) — show birdie/bogey badges and stroke dots
  const formatIsBadgeable = isFormatView(scoreView) && formatDisplay != null && !formatDisplay.higherIsBetter && !formatDisplay.summaries.some(s => typeof s.total === "string");

  return (
    <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid" style={{ gridTemplateColumns: landscapeCols }}>
            <div className="border-b border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)]">
              {["HOLE", "PAR", "YDS", "SI"].map((lbl) => (
                <div
                  key={lbl}
                  className="h-7 px-2.5 flex items-center text-[10px] text-[color:var(--sec-muted)] border-b border-[color:var(--sec-hair)] last:border-b-0"
                >
                  {lbl}
                </div>
              ))}
            </div>

            {landscapePlan.map((c, idx) => {
              const isActive = !isFinished && c.kind === "hole" ? c.hole.hole_number === activeHole : false;

              const cell = (v: any) => (
                <div
                  className={`h-7 flex items-center justify-center text-[10px] border-r border-[color:var(--sec-hair)] ${
                    isActive ? "bg-[color:var(--ciaga-ground)] text-[color:var(--sec-accent)]" : "bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] text-[color:var(--sec-muted)]"
                  }`}
                >
                  {v ?? ""}
                </div>
              );

              if (c.kind === "hole") {
                const isStartingHole = startingHole !== 1 && c.hole.hole_number === startingHole;
                return (
                  <div key={`meta-hole-${c.hole.hole_number}`} className="border-b border-[color:var(--sec-hair)]">
                    <div
                      className={`relative h-7 flex items-center justify-center text-[10px] border-r border-[color:var(--sec-hair)] ${
                        isActive ? "bg-[color:var(--ciaga-ground)] text-[color:var(--sec-accent)]" : "bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] text-[color:var(--sec-muted)]"
                      }`}
                      title={isStartingHole ? `Round started on hole ${startingHole}` : undefined}
                    >
                      {c.hole.hole_number}
                      {isStartingHole && (
                        <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-[color:var(--sec-accent)]" />
                      )}
                    </div>
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
                <div key={`meta-sum-${c.kind}-${idx}`} className="border-b border-[color:var(--sec-hair)]">
                  {cell(label)}
                  {cell(par ?? "–")}
                  {cell(yds ?? "–")}
                  {cell("")}
                </div>
              );
            })}
          </div>

          <div className="divide-y divide-[color:var(--sec-hair)]">
            {participants.map((p) => {
              const name = getParticipantLabel(p);
              const avatarUrl = getParticipantAvatar(p);
              const t = totals[p.id];
              const hi = typeof p.handicap_index === "number" ? formatHI(p.handicap_index) : "–";
              const ch = typeof p.course_handicap === "number" ? String(p.course_handicap) : "–";

              const isFormat = isFormatView(scoreView);
              const ph = isFormat && formatDisplay?.playingHandicaps?.[p.id] != null
                ? String(formatDisplay.playingHandicaps[p.id])
                : null;
              const teeLabel = teeLabelFor?.(p) ?? null;
              const hcpText = isFormat
                ? `HI ${hi} · PH ${ph ?? "–"}`
                : scoreView === "net"
                  ? `HI ${hi} · CH ${ch}`
                  : "";
              const hcpLabel = [teeLabel, hcpText].filter(Boolean).join(" · ");

              return (
                <div key={p.id} className="grid" style={{ gridTemplateColumns: landscapeCols }}>
                  <div className="bg-[color:color-mix(in_srgb,var(--sec-surface)_60%,transparent)]">
                    <div className="h-10 px-2.5 flex items-center gap-2 min-w-0">
                      <Avatar className="h-6 w-6 border border-[color:var(--sec-line)] shrink-0">
                        {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                        <AvatarFallback className="text-[9px]">{initialsFrom(name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-[color:var(--sec-text)] truncate">{name}</div>
                        {hcpLabel ? (
                          <div className="text-[10px] text-[color:var(--sec-muted)] leading-none">
                            {hcpLabel}
                          </div>
                        ) : null}
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

                      const state = holeStateFor(p.id, h.hole_number);
                      const puLabel = state === "picked_up" ? "PU" : (isFinished && state === "not_started" && s !== null) ? "NS" : null;

                      // This player's tee, not the displayed one.
                      const hp = holeOf(p.id, h);

                      const recv =
                        scoreView === "net" && !puLabel
                          ? strokesReceivedOnHole(p.course_handicap ?? null, hp.stroke_index ?? null, countOf(p.id))
                          : isFormatView(scoreView) && formatDisplay && !puLabel
                          ? strokesReceivedOnHole(
                              formatDisplay.playingHandicaps?.[p.id] ?? p.course_handicap ?? null,
                              hp.stroke_index ?? null,
                              countOf(p.id)
                            )
                          : 0;

                      const fmtHint =
                        isFormatView(scoreView) && formatDisplay
                          ? formatDisplay.holeResults[key]?.cssHint
                          : undefined;

                      const fmtColor =
                        fmtHint === "positive" ? "text-green-300" :
                        fmtHint === "won" ? "text-green-300" :
                        fmtHint === "negative" ? "text-[color:var(--sec-muted)]" :
                        fmtHint === "lost" ? "text-[color:var(--sec-bad)]" :
                        fmtHint === "halved" ? "text-[color:var(--sec-muted)]" :
                        "";

                      const badge = savingKey !== key ? scoreBadgeType(s, hp.par, scoreView, formatIsBadgeable) : null;

                      const wolfTag = wolfRoleByKey?.[key] ?? null;

                      return (
                        <button
                          key={`cell-hole-${idx}-${key}`}
                          className={`relative h-10 border-r border-[color:var(--sec-hair)] flex flex-col items-center justify-center font-semibold tabular-nums text-[13px]
                            ${isActive ? "bg-[color:var(--ciaga-ground)] text-[color:var(--sec-accent)]" : "bg-[color:color-mix(in_srgb,var(--sec-surface)_20%,transparent)] text-[color:var(--sec-text)]"}
                            ${disabled ? "opacity-80 cursor-default" : "hover:bg-[color:var(--sec-surface-2)]"}
                            ${fmtColor}
                          `}
                          onClick={() => onOpenEntry(p.id, h.hole_number)}
                          disabled={disabled}
                        >
                          {wolfTag ? (
                            <span className="absolute top-0 left-0 px-0.5 text-[8px] font-bold leading-none rounded-br bg-amber-500/25 text-amber-200">
                              {wolfTag}
                            </span>
                          ) : null}
                          <BadgeWrap type={badge}>
                            <span className="leading-none">{savingKey === key ? "…" : (s ?? "–")}</span>
                          </BadgeWrap>
                          {puLabel ? (
                            <div className="mt-0.5 text-[9px] font-semibold text-[color:var(--sec-muted)] leading-none">{puLabel}</div>
                          ) : recv > 0 ? (
                            <div className="mt-1 leading-none">
                              <StrokeDots count={recv} />
                            </div>
                          ) : recv < 0 ? (
                            <div className="mt-0.5 leading-none">
                              <PlusIndicator count={Math.abs(recv)} />
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

                    const [from, to] = label === "OUT" ? [1, 9] : label === "IN" ? [10, 18] : [1, 18];
                    const toPar = suppressToPar ? null : relToParForRange(p.id, holesList, displayedScoreFor, from, to, holeFor);

                    const isTot = c.kind === "totEnd";

                    return (
                      <div
                        key={`cell-sum-${p.id}-${idx}`}
                        className={`h-10 border-r border-[color:var(--sec-hair)] flex flex-col items-center justify-center font-bold tabular-nums text-[12px]
                          ${isTot ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)]" : "bg-[color:color-mix(in_srgb,var(--sec-surface)_30%,transparent)] text-[color:var(--sec-text)]"}
                        `}
                      >
                        <div className="leading-none">{value}</div>
                        <div
                          className={`text-[10px] font-semibold leading-none ${
                            isTot ? "text-[color:color-mix(in_srgb,var(--ciaga-ground)_70%,transparent)]" : "text-[color:var(--sec-muted)]"
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
