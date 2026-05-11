// components/rounds/PlayerTeeRow.tsx
"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type TeeBoxOption = {
  id: string;
  name: string;
  yards: number | null;
  rating: number | null;
  slope: number | null;
};

type PlayerTeeRowProps = {
  participantId: string;
  roundId: string;
  participantName: string;
  currentTeeBoxId: string | null;
  defaultTeeBoxId: string | null;
  teeBoxes: TeeBoxOption[];
  canEdit: boolean;
  disabled?: boolean;
  onUpdated: () => void;
};

export function PlayerTeeRow({
  participantId,
  roundId,
  participantName,
  currentTeeBoxId,
  defaultTeeBoxId,
  teeBoxes,
  canEdit,
  disabled,
  onUpdated,
}: PlayerTeeRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(currentTeeBoxId ?? "");
  const [saving, setSaving] = useState(false);

  const currentTee = teeBoxes.find((t) => t.id === currentTeeBoxId);
  const defaultTee = teeBoxes.find((t) => t.id === defaultTeeBoxId);
  const hasOverride = !!currentTeeBoxId;

  async function patchTee(teeBoxId: string | null) {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error("Not authenticated");
    const res = await fetch("/api/rounds/update-participant-tee", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ round_id: roundId, participant_id: participantId, tee_box_id: teeBoxId }),
    });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.error || "Failed to update tee");
    }
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await patchTee(editValue || null);
      setIsEditing(false);
      onUpdated();
    } catch (e: any) {
      alert(e?.message || "Failed to update tee");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await patchTee(null);
      setEditValue("");
      setIsEditing(false);
      onUpdated();
    } catch (e: any) {
      alert(e?.message || "Failed to clear tee");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(currentTeeBoxId ?? "");
    setIsEditing(false);
  };

  const displayTee = currentTee ?? defaultTee;
  const displayName = currentTee ? currentTee.name : defaultTee ? `${defaultTee.name} (default)` : "Round default";

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-emerald-900/70 bg-[#0b3b21]/40 p-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-emerald-50 truncate">{participantName}</div>
        {displayTee && (
          <div className="text-xs text-emerald-100/60 mt-0.5">
            {[
              displayTee.rating ? `CR ${displayTee.rating}` : null,
              displayTee.slope ? `Slope ${displayTee.slope}` : null,
              displayTee.yards ? `${displayTee.yards}y` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {!isEditing ? (
          <>
            <div className="text-right min-w-[110px]">
              <div className="text-sm font-semibold text-emerald-50">{displayName}</div>
              {hasOverride && (
                <div className="text-[10px] text-amber-300/80 font-medium">Tee override</div>
              )}
            </div>
            {canEdit && !disabled && (
              <button
                onClick={() => {
                  setEditValue(currentTeeBoxId ?? "");
                  setIsEditing(true);
                }}
                className="px-2 py-1 text-xs rounded border border-emerald-700 bg-emerald-900/30 text-emerald-100 hover:bg-emerald-800/40 transition-colors"
              >
                {hasOverride ? "Change" : "Set"}
              </button>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <select
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="rounded border border-emerald-900/70 bg-[#0b3b21]/70 px-2 py-1 text-xs text-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              disabled={saving}
            >
              <option value="">— round default —</option>
              {teeBoxes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.yards ? ` (${t.yards}y)` : ""}
                </option>
              ))}
            </select>
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
