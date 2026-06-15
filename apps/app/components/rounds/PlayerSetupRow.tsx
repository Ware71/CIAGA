// components/rounds/PlayerSetupRow.tsx
"use client";

import { useState } from "react";
import { formatHI } from "@/lib/rounds/handicapUtils";

export type TeeBoxOption = {
  id: string;
  name: string;
  yards: number | null;
  rating: number | null;
  slope: number | null;
};

type PlayerSetupRowProps = {
  /** Avatar element rendered by the parent (keeps avatar logic in one place). */
  avatar: React.ReactNode;
  name: string;
  /** e.g. "You · owner" / "Guest · player". */
  subtitle: string;
  isGuest: boolean;

  /** Base Handicap Index from history. */
  handicapIndex: number | null;
  /** Course Handicap (computed from base HI + tee). */
  courseHandicap: number | null;
  /** Playing Handicap preview. */
  playingHandicap: number | null;
  /** Manual HI override — when set, HI/PH are "adjusted". */
  assignedHandicapIndex: number | null;

  /** Per-player tee override id (null = round default). */
  currentTeeBoxId: string | null;
  defaultTeeBoxId: string | null;
  teeBoxes: TeeBoxOption[];

  /** Can edit this player's Handicap Index (owner, or the player themselves). */
  canEditHandicap: boolean;
  /** Can edit this player's tee (owner only). */
  canEditTee: boolean;
  disabled?: boolean;
  /** Show the "Swipe to remove" hint in the subtitle line. */
  removableHint?: boolean;

  onSetHandicapIndex: (value: number | null) => Promise<void>;
  onSetTee: (teeBoxId: string | null) => Promise<void>;
};

function Stat({
  label,
  value,
  adjusted,
}: {
  label: string;
  value: string | number | null;
  adjusted: boolean;
}) {
  return (
    <div className="text-[11px] text-emerald-100/70">
      <span className="text-emerald-100/40">{label} </span>
      <span className={`tabular-nums ${adjusted ? "italic text-amber-200/90" : "text-emerald-50"}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}

export function PlayerSetupRow({
  avatar,
  name,
  subtitle,
  isGuest,
  handicapIndex,
  courseHandicap,
  playingHandicap,
  assignedHandicapIndex,
  currentTeeBoxId,
  defaultTeeBoxId,
  teeBoxes,
  canEditHandicap,
  canEditTee,
  disabled,
  removableHint,
  onSetHandicapIndex,
  onSetTee,
}: PlayerSetupRowProps) {
  const canEdit = canEditHandicap || canEditTee;
  const [editing, setEditing] = useState(false);
  const [hiInput, setHiInput] = useState(
    assignedHandicapIndex != null ? assignedHandicapIndex.toString() : "",
  );
  const [teeInput, setTeeInput] = useState(currentTeeBoxId ?? "");
  const [savingHi, setSavingHi] = useState(false);
  const [savingTee, setSavingTee] = useState(false);

  const hiAdjusted = assignedHandicapIndex != null;
  const teeAdjusted = !!currentTeeBoxId;
  // CH derives from the tee; PH derives from both HI override and tee.
  const chAdjusted = teeAdjusted;
  const phAdjusted = hiAdjusted || teeAdjusted;

  const hiDisplay =
    hiAdjusted && assignedHandicapIndex != null
      ? formatHI(assignedHandicapIndex)
      : handicapIndex != null
        ? formatHI(handicapIndex)
        : null;

  const currentTee = teeBoxes.find((t) => t.id === currentTeeBoxId);
  const defaultTee = teeBoxes.find((t) => t.id === defaultTeeBoxId);
  const displayTee = currentTee ?? defaultTee;
  const teeName = currentTee
    ? currentTee.name
    : defaultTee
      ? `${defaultTee.name} (default)`
      : "Round default";
  const teeSpecs = displayTee
    ? [
        displayTee.rating ? `CR ${displayTee.rating}` : null,
        displayTee.slope ? `Slope ${displayTee.slope}` : null,
        displayTee.yards ? `${displayTee.yards}y` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const openEdit = () => {
    setHiInput(assignedHandicapIndex != null ? assignedHandicapIndex.toString() : "");
    setTeeInput(currentTeeBoxId ?? "");
    setEditing(true);
  };

  const saveHi = async () => {
    const num = hiInput.trim() === "" ? null : parseFloat(hiInput);
    if (num !== null && (Number.isNaN(num) || num < 0 || num > 54)) {
      alert("Handicap Index must be between 0 and 54");
      return;
    }
    setSavingHi(true);
    try {
      await onSetHandicapIndex(num);
    } catch (e: any) {
      alert(e?.message || "Failed to update handicap");
    } finally {
      setSavingHi(false);
    }
  };

  const clearHi = async () => {
    setSavingHi(true);
    try {
      await onSetHandicapIndex(null);
      setHiInput("");
    } catch (e: any) {
      alert(e?.message || "Failed to clear handicap");
    } finally {
      setSavingHi(false);
    }
  };

  const saveTee = async (value: string) => {
    setTeeInput(value);
    setSavingTee(true);
    try {
      await onSetTee(value || null);
    } catch (e: any) {
      alert(e?.message || "Failed to update tee");
    } finally {
      setSavingTee(false);
    }
  };

  return (
    <div className="p-3">
      <div className="flex items-center gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-emerald-50 truncate">{name}</div>
          <div className="text-[11px] text-emerald-100/60 truncate">
            {subtitle}
            {removableHint ? <span className="ml-2 text-emerald-100/40">Swipe to remove</span> : null}
          </div>
        </div>
        {!isGuest && canEdit && !disabled ? (
          <button
            type="button"
            onClick={() => (editing ? setEditing(false) : openEdit())}
            className="px-2 py-1 text-xs rounded border border-emerald-700 bg-emerald-900/30 text-emerald-100 hover:bg-emerald-800/40 transition-colors shrink-0"
          >
            {editing ? "Done" : "Edit"}
          </button>
        ) : null}
      </div>

      {!isGuest ? (
        <div className="mt-2 flex items-center gap-4 flex-wrap">
          <Stat label="HI" value={hiDisplay} adjusted={hiAdjusted} />
          <Stat label="CH" value={courseHandicap} adjusted={chAdjusted} />
          <Stat label="PH" value={playingHandicap} adjusted={phAdjusted} />
          <div className="ml-auto text-right">
            <div className={`text-[11px] ${teeAdjusted ? "italic text-amber-200/90" : "text-emerald-50"}`}>
              {teeName}
            </div>
            {teeSpecs ? <div className="text-[10px] text-emerald-100/50">{teeSpecs}</div> : null}
          </div>
        </div>
      ) : null}

      {editing && !isGuest ? (
        <div className="mt-3 space-y-3 rounded-xl border border-emerald-900/70 bg-[#042713]/60 p-3">
          {/* Handicap Index */}
          {canEditHandicap ? (
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] text-emerald-100/70">Handicap Index</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={54}
                step={0.1}
                value={hiInput}
                onChange={(e) => setHiInput(e.target.value)}
                placeholder="HI"
                className="w-16 rounded border border-emerald-900/70 bg-[#0b3b21]/70 px-2 py-1 text-xs text-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                disabled={savingHi}
              />
              <button
                onClick={saveHi}
                disabled={savingHi}
                className="px-2 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              >
                {savingHi ? "…" : "Save"}
              </button>
              {hiAdjusted ? (
                <button
                  onClick={clearHi}
                  disabled={savingHi}
                  className="px-2 py-1 text-xs rounded border border-red-700/50 bg-red-900/20 text-red-200 hover:bg-red-800/30 disabled:opacity-50 transition-colors"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          ) : null}

          {/* Tee */}
          {canEditTee ? (
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] text-emerald-100/70">Tee</label>
            <select
              value={teeInput}
              onChange={(e) => saveTee(e.target.value)}
              disabled={savingTee}
              className="rounded border border-emerald-900/70 bg-[#0b3b21]/70 px-2 py-1 text-xs text-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
            >
              <option value="">— round default —</option>
              {teeBoxes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.yards ? ` (${t.yards}y)` : ""}
                </option>
              ))}
            </select>
          </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
