// components/rounds/ParticipantHandicapRow.tsx
"use client";

import { useState } from "react";

type ParticipantHandicapRowProps = {
  participantId: string;
  participantName: string;
  handicapIndex: number | null;
  courseHandicap: number | null;
  playingHandicap: number | null;
  assignedHandicapIndex: number | null;
  onSetHandicapIndex: (participantId: string, value: number | null) => Promise<void>;
  canEdit: boolean; // true if owner or if this is current user
  disabled?: boolean;
};

export function ParticipantHandicapRow({
  participantId,
  participantName,
  handicapIndex,
  courseHandicap,
  playingHandicap,
  assignedHandicapIndex,
  onSetHandicapIndex,
  canEdit,
  disabled,
}: ParticipantHandicapRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(
    assignedHandicapIndex !== null && assignedHandicapIndex !== undefined
      ? assignedHandicapIndex.toString()
      : ""
  );
  const [saving, setSaving] = useState(false);

  const hasOverride = assignedHandicapIndex !== null && assignedHandicapIndex !== undefined;

  const handleSave = async () => {
    setSaving(true);
    try {
      const numValue = editValue === "" ? null : parseFloat(editValue);
      if (numValue !== null && (numValue < 0 || numValue > 54)) {
        alert("Handicap Index must be between 0 and 54");
        return;
      }
      await onSetHandicapIndex(participantId, numValue);
      setIsEditing(false);
    } catch (error: any) {
      alert(error?.message || "Failed to update handicap");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(assignedHandicapIndex?.toString() ?? "");
    setIsEditing(false);
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await onSetHandicapIndex(participantId, null);
      setEditValue("");
      setIsEditing(false);
    } catch (error: any) {
      alert(error?.message || "Failed to clear handicap");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-emerald-900/70 bg-[#0b3b21]/40 p-3">
      {/* Player Info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-emerald-50 truncate">{participantName}</div>
        <div className="text-xs text-emerald-100/60 mt-0.5">
          HI: {handicapIndex !== null ? handicapIndex.toFixed(1) : "—"}
          {courseHandicap !== null && ` • CH: ${courseHandicap}`}
        </div>
      </div>

      {/* Playing Handicap Display/Edit */}
      <div className="flex items-center gap-2">
        {!isEditing ? (
          <>
            <div className="text-right min-w-[110px]">
              <div className="text-sm font-semibold text-emerald-50">
                PH: {playingHandicap ?? "—"}
              </div>
              {hasOverride && (
                <div className="text-[10px] text-amber-300/80 font-medium">HI override</div>
              )}
            </div>

            {canEdit && !disabled && (
              <button
                onClick={() => {
                  setEditValue(
                    assignedHandicapIndex !== null && assignedHandicapIndex !== undefined
                      ? assignedHandicapIndex.toString()
                      : ""
                  );
                  setIsEditing(true);
                }}
                className="px-2 py-1 text-xs rounded border border-emerald-700 bg-emerald-900/30 text-emerald-100 hover:bg-emerald-800/40 transition-colors"
              >
                {hasOverride ? "Edit HI" : "Set HI"}
              </button>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              max={54}
              step={0.1}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder="HI"
              className="w-16 rounded border border-emerald-900/70 bg-[#0b3b21]/70 px-2 py-1 text-xs text-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              disabled={saving}
              autoFocus
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-2 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
            >
              {saving ? "..." : "Save"}
            </button>
            {hasOverride && (
              <button
                onClick={handleClear}
                disabled={saving}
                className="px-2 py-1 text-xs rounded border border-red-700/50 bg-red-900/20 text-red-200 hover:bg-red-800/30 disabled:opacity-50 transition-colors"
              >
                Clear
              </button>
            )}
            <button
              onClick={handleCancel}
              disabled={saving}
              className="px-2 py-1 text-xs rounded border border-emerald-900/70 text-emerald-200 hover:bg-emerald-900/20 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
