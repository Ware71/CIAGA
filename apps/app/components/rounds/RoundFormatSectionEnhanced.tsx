// components/rounds/RoundFormatSectionEnhanced.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { FormatSelector, RoundFormatType } from "./FormatSelector";
import { PlayingHandicapSettings, PlayingHandicapMode } from "./PlayingHandicapSettings";
import { StablefordConfigEditor } from "./StablefordConfigEditor";
import { SideGamesManager } from "./SideGamesManager";
import { supabase } from "@/lib/supabaseClient";

type RoundFormatSectionEnhancedProps = {
  roundId: string;
  initialFormat?: RoundFormatType;
  initialFormatConfig?: Record<string, any>;
  initialSideGames?: Array<any>;
  initialHandicapMode?: PlayingHandicapMode;
  initialHandicapValue?: number;
  isOwner: boolean;
  isEditable: boolean;
  onUpdate?: () => void;
};

export function RoundFormatSectionEnhanced({
  roundId,
  initialFormat = "strokeplay",
  initialFormatConfig = {},
  initialSideGames = [],
  initialHandicapMode = "allowance_pct",
  initialHandicapValue = 100,
  isOwner,
  isEditable,
  onUpdate,
}: RoundFormatSectionEnhancedProps) {
  const [formatType, setFormatType] = useState<RoundFormatType>(initialFormat);
  const [formatConfig, setFormatConfig] = useState(initialFormatConfig);
  const [sideGames, setSideGames] = useState(initialSideGames);
  const [handicapMode, setHandicapMode] = useState<PlayingHandicapMode>(initialHandicapMode);
  const [handicapValue, setHandicapValue] = useState(initialHandicapValue);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Track if we're currently updating to prevent reset loops
  const updatingRef = useRef(false);

  // Update local state when props change (but not if we just updated)
  useEffect(() => {
    if (!updatingRef.current) {
      setFormatType(initialFormat);
    }
  }, [initialFormat]);

  useEffect(() => {
    if (!updatingRef.current) {
      setFormatConfig(initialFormatConfig);
    }
  }, [initialFormatConfig]);

  useEffect(() => {
    if (!updatingRef.current) {
      setSideGames(initialSideGames);
    }
  }, [initialSideGames]);

  useEffect(() => {
    if (!updatingRef.current) {
      setHandicapMode(initialHandicapMode);
    }
  }, [initialHandicapMode]);

  useEffect(() => {
    if (!updatingRef.current) {
      setHandicapValue(initialHandicapValue);
    }
  }, [initialHandicapValue]);

  const handleUpdateSettings = async (updates: {
    format_type?: RoundFormatType;
    format_config?: Record<string, any>;
    side_games?: Array<any>;
    default_playing_handicap_mode?: PlayingHandicapMode;
    default_playing_handicap_value?: number;
  }) => {
    try {
      updatingRef.current = true;

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

      // Allow state updates again after a short delay
      setTimeout(() => {
        updatingRef.current = false;
      }, 500);
    } catch (error: any) {
      updatingRef.current = false;
      alert(error.message || "Failed to update settings");
      throw error;
    }
  };

  const requiresConfig = formatType === "stableford" || formatType === "team_stableford";

  return (
    <div className="space-y-4">
      {/* Format Selection */}
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

      {/* Format Configuration (Stableford) */}
      {requiresConfig && (
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
          <div className="mb-3">
            <div className="text-sm font-semibold text-emerald-50">Stableford Points</div>
            <div className="text-[11px] text-emerald-100/70">Configure the points table</div>
          </div>

          <StablefordConfigEditor
            value={formatConfig.stableford_points}
            onChange={async (points) => {
              const updated = { ...formatConfig, stableford_points: points };
              setFormatConfig(updated);
              await handleUpdateSettings({ format_config: updated });
            }}
            disabled={!isEditable}
          />
        </div>
      )}

      {/* Playing Handicap Settings */}
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
        <div className="mb-3">
          <div className="text-sm font-semibold text-emerald-50">Handicap Settings</div>
          <div className="text-[11px] text-emerald-100/70">
            {isOwner
              ? "Set default handicap calculation"
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

      {/* Side Games (Optional - Collapsed by default) */}
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-emerald-50">Side Games</div>
            <div className="text-[11px] text-emerald-100/70">
              Optional games alongside main format
            </div>
          </div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="px-2 py-1 text-xs rounded border border-emerald-700 text-emerald-200 hover:bg-emerald-900/30 transition-colors"
          >
            {showAdvanced ? "Hide" : "Show"}
          </button>
        </div>

        {showAdvanced && (
          <SideGamesManager
            value={sideGames}
            onChange={async (games) => {
              setSideGames(games);
              await handleUpdateSettings({ side_games: games });
            }}
            disabled={!isEditable}
          />
        )}

        {!showAdvanced && sideGames.length > 0 && (
          <div className="text-xs text-emerald-100/70">
            {sideGames.length} side game{sideGames.length > 1 ? "s" : ""} enabled
          </div>
        )}
      </div>
    </div>
  );
}
