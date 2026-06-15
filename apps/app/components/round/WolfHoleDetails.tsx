"use client";

import type { Participant, WolfPick, WolfMode } from "@/lib/rounds/hooks/useRoundDetail";

type WolfHoleDetailsProps = {
  participants: Participant[];
  holeNumber: number;
  pick: WolfPick | null;
  /** Wolf implied by the rotation when no explicit pick is stored. */
  rotationWolfId: string | null;
  getParticipantLabel: (p: Participant) => string;
  onChange: (pick: WolfPick) => void;
  disabled?: boolean;
};

const CHIP_BASE =
  "px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors disabled:opacity-30 disabled:cursor-not-allowed";

export default function WolfHoleDetails({
  participants,
  holeNumber,
  pick,
  rotationWolfId,
  getParticipantLabel,
  onChange,
  disabled,
}: WolfHoleDetailsProps) {
  // Effective state — falls back to the rotation wolf when nothing is stored yet,
  // matching how the scoring engine resolves the wolf.
  const wolfId = pick?.wolf_participant_id ?? rotationWolfId;
  const mode: WolfMode = pick?.wolf_mode ?? "partner";
  const partnerId = mode === "partner" ? pick?.partner_participant_id ?? null : null;

  const setWolf = (pid: string, m: WolfMode) => {
    let partner = partnerId;
    if (m !== "partner" || partner === pid) partner = null;
    onChange({ wolf_participant_id: pid, wolf_mode: m, partner_participant_id: partner });
  };
  const clearWolf = () =>
    onChange({ wolf_participant_id: null, wolf_mode: "partner", partner_participant_id: null });
  const togglePartner = (pid: string) => {
    if (!wolfId || pid === wolfId || mode !== "partner") return;
    onChange({
      wolf_participant_id: wolfId,
      wolf_mode: "partner",
      partner_participant_id: partnerId === pid ? null : pid,
    });
  };

  const chip = (
    active: boolean,
    label: string,
    onClick: () => void,
    activeClass: string,
    isDisabled?: boolean,
  ) => (
    <button
      type="button"
      disabled={disabled || isDisabled}
      onClick={onClick}
      className={`${CHIP_BASE} ${
        active ? activeClass : "border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-100/70 hover:bg-emerald-900/25"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-2xl border border-amber-700/50 bg-[#1c1606]/90 p-3 shadow-2xl">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-amber-100">🐺 Wolf · Hole {holeNumber}</div>
        <div className="text-[10px] text-amber-100/60">One wolf · partner only if not lone/blind</div>
      </div>

      <div className="space-y-1.5">
        {participants.map((p) => {
          const isWolf = wolfId === p.id;
          const isPartner = partnerId === p.id;
          return (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <div className="text-xs text-emerald-50 truncate min-w-0 flex-1">{getParticipantLabel(p)}</div>
              <div className="flex items-center gap-1 shrink-0">
                {chip(
                  isWolf && mode === "partner",
                  "Wolf",
                  () => (isWolf && mode === "partner" ? clearWolf() : setWolf(p.id, "partner")),
                  "border-amber-500 bg-amber-500/20 text-amber-100",
                )}
                {chip(
                  isPartner,
                  "Partner",
                  () => togglePartner(p.id),
                  "border-emerald-500 bg-emerald-500/20 text-emerald-100",
                  !wolfId || isWolf || mode !== "partner",
                )}
                {chip(
                  isWolf && mode === "lone",
                  "Lone",
                  () => (isWolf && mode === "lone" ? clearWolf() : setWolf(p.id, "lone")),
                  "border-amber-500 bg-amber-500/20 text-amber-100",
                )}
                {chip(
                  isWolf && mode === "blind",
                  "Blind",
                  () => (isWolf && mode === "blind" ? clearWolf() : setWolf(p.id, "blind")),
                  "border-amber-500 bg-amber-500/20 text-amber-100",
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
