"use client";

import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Participant, Hole } from "@/lib/rounds/hooks/useRoundDetail";

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
  onClose: () => void;
  onSubmit: (strokes: number | null) => Promise<void>;
  getParticipantLabel: (p: Participant) => string;
  getParticipantAvatar: (p: Participant) => string | null;
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
    onClose,
    onSubmit,
    getParticipantLabel,
    getParticipantAvatar,
  } = props;

  const p = participants.find((x) => x.id === pid)!;
  const name = getParticipantLabel(p);
  const avatarUrl = getParticipantAvatar(p);
  const holeMeta = holes.find((h) => h.hole_number === holeNumber);

  const current = scoreFor(pid, holeNumber);
  const disabled = !canScore || isFinished;
  const busy = savingKey === `${pid}:${holeNumber}`;

  const missingCount = useMemo(() => {
    let missing = 0;
    for (const pp of participants) {
      const s = scoreFor(pp.id, holeNumber);
      if (typeof s !== "number") missing += 1;
    }
    return missing;
  }, [participants, holeNumber, scoreFor]);

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />

      <div className="absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-[520px] rounded-t-3xl border border-emerald-900/70 bg-[#061f12] shadow-2xl overflow-hidden">
          <div className="p-3 border-b border-emerald-900/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar className="h-10 w-10 border border-emerald-200/70">
                {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                <AvatarFallback>{initialsFrom(name)}</AvatarFallback>
              </Avatar>

              <div className="min-w-0">
                <div className="text-sm font-semibold text-emerald-50 truncate">Enter score for {name}</div>
                <div className="text-[11px] text-emerald-100/70">
                  Hole {holeNumber} · Par {holeMeta?.par ?? "–"} · SI {holeMeta?.stroke_index ?? "–"}
                  {missingCount ? <span> · Missing {missingCount}</span> : null}
                </div>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl border border-emerald-900/70 bg-[#042713] text-emerald-50 hover:bg-emerald-900/20"
              onClick={onClose}
            >
              Close
            </Button>
          </div>

          <div className="p-3">
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/25 p-3 flex items-center justify-between">
              <div className="text-[11px] text-emerald-100/70">Current</div>
              <div className="text-4xl font-extrabold text-[#f5e6b0] tabular-nums">{busy ? "…" : current ?? "–"}</div>
              <button
                className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/35 px-3 py-2 text-[11px] text-emerald-100/80 hover:bg-emerald-900/20 disabled:opacity-40"
                disabled={disabled || busy}
                onClick={() => onSubmit(null)}
              >
                Clear
              </button>
            </div>

            {mode === "quick" ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <button
                    key={n}
                    className="h-11 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 text-lg font-semibold hover:bg-emerald-900/25 disabled:opacity-40"
                    disabled={disabled || busy}
                    onClick={() => onSubmit(n)}
                  >
                    {n}
                  </button>
                ))}

                <button
                  className="h-11 rounded-2xl border border-emerald-900/70 bg-[#f5e6b0] text-[#042713] text-lg font-bold hover:bg-[#e9d79c] disabled:opacity-40"
                  disabled={disabled || busy}
                  onClick={() => {
                    setMode("custom");
                    setCustomVal("10");
                  }}
                >
                  10+
                </button>

                <button
                  className="h-11 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-100/80 text-sm hover:bg-emerald-900/25 disabled:opacity-40 col-span-2"
                  disabled={disabled || busy}
                  onClick={onClose}
                >
                  Done for now
                </button>
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/30 p-3">
                <div className="text-xs text-emerald-100/70 mb-2">Enter any score</div>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={customVal}
                  onChange={(e) => setCustomVal(e.target.value.replace(/[^\d]/g, ""))}
                  className="w-full h-11 rounded-2xl bg-[#042713] border border-emerald-900/70 px-4 text-emerald-50 text-lg font-semibold outline-none"
                  placeholder="10"
                />

                <div className="mt-3 flex gap-2">
                  <Button
                    variant="ghost"
                    className="flex-1 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 hover:bg-emerald-900/20 disabled:opacity-40"
                    disabled={disabled || busy}
                    onClick={() => setMode("quick")}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1 rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c] disabled:opacity-40"
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
  );
}
