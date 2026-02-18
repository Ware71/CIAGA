// components/rounds/RoundFormatSection.tsx
"use client";

import { useState, useEffect } from "react";
import { FormatSelector, RoundFormatType } from "./FormatSelector";
import { PlayingHandicapSettings, PlayingHandicapMode } from "./PlayingHandicapSettings";
import { supabase } from "@/lib/supabaseClient";

type RoundFormatSectionProps = {
  roundId: string;
  initialFormat?: RoundFormatType;
  initialFormatConfig?: Record<string, any>;
  initialSideGames?: Array<any>;
  initialHandicapMode?: PlayingHandicapMode;
  initialHandicapValue?: number;
  isOwner: boolean;
  isEditable: boolean; // true if status is draft or scheduled
  onUpdate?: () => void; // callback after successful update
};

export function RoundFormatSection({
  roundId,
  initialFormat = "strokeplay",
  initialFormatConfig = {},
  initialSideGames = [],
  initialHandicapMode = "allowance_pct",
  initialHandicapValue = 100,
  isOwner,
  isEditable,
  onUpdate,
}: RoundFormatSectionProps) {
  const [formatType, setFormatType] = useState<RoundFormatType>(initialFormat);
  const [formatConfig, setFormatConfig] = useState(initialFormatConfig);
  const [sideGames, setSideGames] = useState(initialSideGames);
  const [handicapMode, setHandicapMode] = useState<PlayingHandicapMode>(initialHandicapMode);
  const [handicapValue, setHandicapValue] = useState(initialHandicapValue);

  // Update local state when props change
  useEffect(() => {
    setFormatType(initialFormat);
  }, [initialFormat]);

  useEffect(() => {
    setFormatConfig(initialFormatConfig);
  }, [initialFormatConfig]);

  useEffect(() => {
    setSideGames(initialSideGames);
  }, [initialSideGames]);

  useEffect(() => {
    setHandicapMode(initialHandicapMode);
  }, [initialHandicapMode]);

  useEffect(() => {
    setHandicapValue(initialHandicapValue);
  }, [initialHandicapValue]);

  const handleUpdateSettings = async (updates: {
    format_type?: RoundFormatType;
    format_config?: Record<string, any>;
    side_games?: Array<any>;
    default_playing_handicap_mode?: PlayingHandicapMode;
    default_playing_handicap_value?: number;
  }) => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/rounds/update-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          round_id: roundId,
          ...updates,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update settings");
      }

      onUpdate?.();
    } catch (error: any) {
      alert(error.message || "Failed to update settings");
      throw error;
    }
  };

  return (
    <div className="space-y-6">
      {/* Format Section */}
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
        <div className="mb-3">
          <div className="text-sm font-semibold text-emerald-50">Round Format</div>
          <div className="text-[11px] text-emerald-100/70">
            {isOwner ? "Choose the scoring format" : "View current format"}
          </div>
        </div>

        <FormatSelector
          value={formatType}
          onChange={async (format) => {
            setFormatType(format);
            await handleUpdateSettings({ format_type: format });
          }}
          disabled={!isEditable}
          isOwner={isOwner}
        />
      </div>

      {/* Playing Handicap Section */}
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
        <div className="mb-3">
          <div className="text-sm font-semibold text-emerald-50">Handicap Settings</div>
          <div className="text-[11px] text-emerald-100/70">
            {isOwner
              ? "Set default handicap calculation for all players"
              : "View current handicap settings"}
          </div>
        </div>

        <PlayingHandicapSettings
          mode={handicapMode}
          value={handicapValue}
          onModeChange={async (mode) => {
            setHandicapMode(mode);
            await handleUpdateSettings({ default_playing_handicap_mode: mode });
          }}
          onValueChange={async (value) => {
            setHandicapValue(value);
            await handleUpdateSettings({ default_playing_handicap_value: value });
          }}
          disabled={!isEditable}
          isOwner={isOwner}
        />
      </div>
    </div>
  );
}
