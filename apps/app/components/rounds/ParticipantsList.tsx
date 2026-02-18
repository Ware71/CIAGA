// components/rounds/ParticipantsList.tsx
"use client";

import { ParticipantHandicapRow } from "./ParticipantHandicapRow";
import { supabase } from "@/lib/supabaseClient";

type Participant = {
  id: string;
  profile_id: string | null;
  display_name: string | null;
  is_guest: boolean;
  handicap_index?: number | null;
  assigned_playing_handicap?: number | null;
  assigned_handicap_index?: number | null;
  playing_handicap_used?: number | null;
  course_handicap_used?: number | null;
};

type ParticipantsListProps = {
  roundId: string;
  participants: Participant[];
  myProfileId: string | null;
  isOwner: boolean;
  isEditable: boolean; // true if status is draft or scheduled
  onUpdate?: () => void;
  getDisplayName: (p: Participant) => string;
};

export function ParticipantsList({
  roundId,
  participants,
  myProfileId,
  isOwner,
  isEditable,
  onUpdate,
  getDisplayName,
}: ParticipantsListProps) {
  // Helper to safely extract name string from getDisplayName result
  const getNameString = (p: Participant): string => {
    const result = getDisplayName(p);
    // If getDisplayName returns an object, extract the name field
    if (typeof result === 'object' && result !== null && 'name' in result) {
      return (result as any).name || p.display_name || 'Player';
    }
    // If it's already a string, use it
    if (typeof result === 'string') {
      return result;
    }
    // Fallback
    return p.display_name || 'Player';
  };
  const handleSetHandicapIndex = async (participantId: string, value: number | null) => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/rounds/set-handicap-index", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          round_id: roundId,
          participant_id: participantId,
          assigned_handicap_index: value,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update handicap");
      }

      onUpdate?.();
    } catch (error: any) {
      throw error;
    }
  };

  // Filter out guests from handicap management
  const eligibleParticipants = participants.filter((p) => !p.is_guest);

  if (eligibleParticipants.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
        <div className="text-sm text-emerald-100/60">
          Add players to configure their handicaps
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-emerald-50">Player Handicaps</div>
        <div className="text-[11px] text-emerald-100/70">
          {isEditable
            ? "Set custom playing handicaps (optional)"
            : "View handicap snapshots from round start"}
        </div>
      </div>

      <div className="space-y-2">
        {eligibleParticipants.map((participant) => (
          <ParticipantHandicapRow
            key={participant.id}
            participantId={participant.id}
            participantName={getNameString(participant)}
            handicapIndex={participant.handicap_index ?? null}
            courseHandicap={participant.course_handicap_used ?? null}
            playingHandicap={participant.playing_handicap_used ?? null}
            assignedHandicapIndex={participant.assigned_handicap_index ?? null}
            onSetHandicapIndex={handleSetHandicapIndex}
            canEdit={isOwner || participant.profile_id === myProfileId}
            disabled={!isEditable}
          />
        ))}
      </div>

      {isEditable && (
        <div className="mt-3 rounded-lg border border-blue-900/50 bg-blue-950/20 p-3">
          <p className="text-[11px] text-blue-100/90">
            <span className="font-semibold">💡 Tip:</span> Playing handicaps are calculated
            automatically based on the settings above. You can override individual handicaps here
            for scoring purposes only - this won't affect official handicap calculations.
          </p>
        </div>
      )}
    </div>
  );
}
