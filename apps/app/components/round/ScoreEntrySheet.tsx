"use client";

import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Participant, Hole, HoleState } from "@/lib/rounds/hooks/useRoundDetail";

function initialsFrom(name: string) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "U";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase().slice(0, 2);
}

export default function ScoreEntrySheet(props: {
  participants: Participant[];
  holes: Hole[];
  pid: string;
  holeNumber: number;
  mode: "quick" | "custom";
  customVal: string;
  setMode: (m: "quick" | "custom") => void;
  setCustomVal: (v: string) => void;
  canScore: boolean;
  isFinished: boolean;
  scoreFor: (pid: string, hole: number) => number | null;
  savingKey: string | null;
  isPortrait?: boolean;
  hideHoleState?: boolean;

  // B: hole state controls
  holeState: HoleState;
  onSetPickedUp: () => Promise<void> | void;
  onSetNotStarted: () => Promise<void> | void;

  onClose: () => void;
  onSubmit: (strokes: number | null) => Promise<void>;
  getParticipantLabel: (p: Participant) => string;
  getParticipantAvatar: (p: Participant) => string | null;

  /** Optional content rendered above the drawer card (e.g. Wolf hole details). */
  aboveContent?: React.ReactNode;
}) {
  const {
    participants,
    holes,
    pid,
    holeNumber,
    mode,
    customVal,
    setMode,
    setCustomVal,
    canScore,
    isFinished,
    scoreFor,
    savingKey,
    isPortrait = true,
    hideHoleState = false,

    holeState,
    onSetPickedUp,
    onSetNotStarted,

    onClose,
    onSubmit,
    getParticipantLabel,
    getParticipantAvatar,
    aboveContent,
  } = props;

  const p = participants.find((x) => x.id === pid)!;
  const name = getParticipantLabel(p);
  const avatarUrl = getParticipantAvatar(p);
  const holeMeta = holes.find((h) => h.hole_number === holeNumber);

  const current = scoreFor(pid, holeNumber);
  const disabled = !canScore || isFinished;
  const busy = savingKey === `${pid}:${holeNumber}`;

  const currentDisplay = useMemo(() => {
    if (busy) return "…";
    if (holeState === "picked_up") return "PU";
    if (holeState === "not_started") return "–";
    // completed:
    return typeof current === "number" ? current : "–";
  }, [busy, holeState, current]);

  const missingCount = useMemo(() => {
    let missing = 0;
    for (const pp of participants) {
      // treat picked_up as not missing
      // treat completed as not missing (even if scoreFor is temporarily null, state is authoritative)
      // treat not_started as missing
      // NOTE: this sheet is for a single hole; holeState prop is only for current pid.
      // For missingCount we still fall back to numeric check as the rest of the page will advance logic.
      const s = scoreFor(pp.id, holeNumber);
      if (typeof s !== "number") missing += 1;
    }
    return missing;
  }, [participants, holeNumber, scoreFor]);

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />

      <div
        // Landscape used to be overflow-hidden, so anything taller than the
        // viewport was unreachable. It scrolls now as a safety net — with the
        // side-by-side layout below it shouldn't normally engage, but a very
        // short viewport or a tall aboveContent (Wolf with four players) must
        // never be clipped away.
        className={`absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)] max-h-[100dvh] overflow-y-auto ${isPortrait ? "" : "overscroll-contain"}`}
      >
        {/* Portrait stacks (height to spare, width tight). Landscape is the
            reverse, so the extras sit beside the card and nothing scrolls.
            Landscape shrinks with `zoom`, not `transform: scale` — a transform
            leaves the layout box at full size, so the scroll container still
            believed it overflowed and clipped the bottom off both columns. */}
        <div
          className={isPortrait ? "" : "flex items-end justify-center gap-3"}
          style={isPortrait ? undefined : ({ zoom: 0.8 } as React.CSSProperties)}
        >
          {aboveContent ? (
            <div className={isPortrait ? "mx-auto w-full max-w-[520px] mb-2" : "w-[360px] shrink-0"}>
              {aboveContent}
            </div>
          ) : null}

          <div
            className={`${
              isPortrait ? "mx-auto w-full max-w-[520px]" : "w-[440px] shrink-0"
            } rounded-t-3xl border border-[color:var(--sec-hair)] bg-[color:var(--ciaga-ground)] shadow-2xl overflow-hidden`}
          >
          <div className="p-3 border-b border-[color:var(--sec-hair)] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar className="h-10 w-10 border border-[color:var(--sec-line)]">
                {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                <AvatarFallback>{initialsFrom(name)}</AvatarFallback>
              </Avatar>

              <div className="min-w-0">
                <div className="text-sm font-semibold text-[color:var(--sec-text)] truncate">Enter score for {name}</div>
                <div className="text-[11px] text-[color:var(--sec-muted)]">
                  Hole {holeNumber} · Par {holeMeta?.par ?? "–"} · SI {holeMeta?.stroke_index ?? "–"}
                  {missingCount ? <span> · Missing {missingCount}</span> : null}
                </div>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:var(--ciaga-ground)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
              onClick={onClose}
            >
              Close
            </Button>
          </div>

          <div className="p-3">
            <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_25%,transparent)] p-3 flex items-center justify-between">
              <div className="text-[11px] text-[color:var(--sec-muted)]">Current</div>
              <div className="text-4xl font-extrabold text-[color:var(--sec-accent)] tabular-nums">{currentDisplay}</div>
              <button
                className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_35%,transparent)] px-3 py-2 text-[11px] text-[color:var(--sec-muted)] hover:bg-[color:var(--sec-surface-2)] disabled:opacity-40"
                disabled={disabled || busy}
                onClick={() => onSubmit(null)}
              >
                Clear score
              </button>
            </div>

            {/* B: Hole state quick actions */}
            {!hideHoleState && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  className="h-11 rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] text-[color:var(--sec-text)] text-sm font-semibold hover:bg-[color:var(--sec-surface-2)] disabled:opacity-40"
                  disabled={disabled || busy}
                  onClick={() => onSetPickedUp()}
                >
                  Picked up (PU)
                </button>

                <button
                  className="h-11 rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] text-[color:var(--sec-text)] text-sm font-semibold hover:bg-[color:var(--sec-surface-2)] disabled:opacity-40"
                  disabled={disabled || busy}
                  onClick={() => onSetNotStarted()}
                >
                  Not started (—)
                </button>
              </div>
            )}

            {mode === "quick" ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <button
                    key={n}
                    className="h-11 rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] text-[color:var(--sec-text)] text-lg font-semibold hover:bg-[color:var(--sec-surface-2)] disabled:opacity-40"
                    disabled={disabled || busy}
                    onClick={() => onSubmit(n)}
                  >
                    {n}
                  </button>
                ))}

                <button
                  className="h-11 rounded-2xl border border-[color:var(--sec-hair)] bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] text-lg font-bold hover:bg-[color:var(--sec-accent)] disabled:opacity-40"
                  disabled={disabled || busy}
                  onClick={() => {
                    setMode("custom");
                    setCustomVal("10");
                  }}
                >
                  10+
                </button>

                <button
                  className="h-11 rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] text-[color:var(--sec-muted)] text-sm hover:bg-[color:var(--sec-surface-2)] disabled:opacity-40 col-span-2"
                  disabled={disabled || busy}
                  onClick={onClose}
                >
                  Done for now
                </button>
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_30%,transparent)] p-3">
                <div className="text-xs text-[color:var(--sec-muted)] mb-2">Enter any score</div>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={customVal}
                  onChange={(e) => setCustomVal(e.target.value.replace(/[^\d]/g, ""))}
                  className="w-full h-11 rounded-2xl bg-[color:var(--ciaga-ground)] border border-[color:var(--sec-hair)] px-4 text-[color:var(--sec-text)] text-lg font-semibold outline-none"
                  placeholder="10"
                />

                <div className="mt-3 flex gap-2">
                  <Button
                    variant="ghost"
                    className="flex-1 rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)] disabled:opacity-40"
                    disabled={disabled || busy}
                    onClick={() => setMode("quick")}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1 rounded-2xl bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] hover:bg-[color:var(--sec-accent)] disabled:opacity-40"
                    disabled={disabled || busy}
                    onClick={() => {
                      const n = parseInt(customVal || "", 10);
                      if (!Number.isFinite(n)) return;
                      onSubmit(n);
                    }}
                  >
                    Set score
                  </Button>
                </div>
              </div>
            )}

            {isFinished ? (
              <div className="mt-3 text-[11px] text-amber-200/80">This round is finished. Editing is disabled.</div>
            ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
