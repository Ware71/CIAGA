// components/rounds/SideGamesManager.tsx
"use client";

import { useState } from "react";

type SideGame = {
  name: "skins" | "wolf" | "nassau";
  enabled: boolean;
  config?: Record<string, any>;
};

const AVAILABLE_GAMES = [
  {
    id: "skins" as const,
    label: "Skins",
    description: "Lowest unique score on each hole wins",
    defaultConfig: { carryover: true, value_per_skin: 1 },
  },
  {
    id: "wolf" as const,
    label: "Wolf",
    description: "Rotating team game with betting",
    defaultConfig: { points_per_hole: 1, lone_wolf_multiplier: 2 },
  },
  {
    id: "nassau" as const,
    label: "Nassau",
    description: "Front 9, back 9, and total competition",
    defaultConfig: { stakes: { front: 5, back: 5, total: 10 } },
  },
];

type SideGamesManagerProps = {
  value: Array<any>;
  onChange: (games: Array<any>) => void;
  disabled?: boolean;
};

export function SideGamesManager({ value = [], onChange, disabled }: SideGamesManagerProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const enabledGames = new Set(value.map((g: any) => g.name));

  const toggleGame = (gameId: string) => {
    const game = AVAILABLE_GAMES.find((g) => g.id === gameId);
    if (!game) return;

    if (enabledGames.has(gameId)) {
      // Remove game
      onChange(value.filter((g: any) => g.name !== gameId));
    } else {
      // Add game with default config
      onChange([
        ...value,
        {
          name: gameId,
          enabled: true,
          config: game.defaultConfig,
        },
      ]);
    }
  };

  const updateGameConfig = (gameId: string, config: Record<string, any>) => {
    onChange(
      value.map((g: any) => (g.name === gameId ? { ...g, config: { ...g.config, ...config } } : g))
    );
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-emerald-100/80 mb-2">
        {enabledGames.size === 0
          ? "No side games enabled"
          : `${enabledGames.size} side game${enabledGames.size > 1 ? "s" : ""} enabled`}
      </div>

      {AVAILABLE_GAMES.map((game) => {
        const isEnabled = enabledGames.has(game.id);
        const gameData = value.find((g: any) => g.name === game.id);
        const isExpanded = expanded === game.id;

        return (
          <div
            key={game.id}
            className={`
              rounded-lg border transition-colors
              ${
                isEnabled
                  ? "border-emerald-700 bg-emerald-950/30"
                  : "border-emerald-900/70 bg-[#0b3b21]/40"
              }
            `}
          >
            {/* Game Header */}
            <div className="p-3 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => toggleGame(game.id)}
                    disabled={disabled}
                    className="rounded border-emerald-700 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                  />
                  <label className="text-sm font-medium text-emerald-50 cursor-pointer select-none">
                    {game.label}
                  </label>
                </div>
                <p className="text-[11px] text-emerald-100/60 mt-0.5 ml-6">{game.description}</p>
              </div>

              {isEnabled && (
                <button
                  onClick={() => setExpanded(isExpanded ? null : game.id)}
                  className="px-2 py-1 text-[11px] rounded border border-emerald-700 text-emerald-200 hover:bg-emerald-900/30 transition-colors"
                >
                  {isExpanded ? "Hide" : "Config"}
                </button>
              )}
            </div>

            {/* Game Config (Expanded) */}
            {isEnabled && isExpanded && (
              <div className="px-3 pb-3 border-t border-emerald-900/50 pt-3 space-y-2">
                {game.id === "skins" && (
                  <>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={gameData?.config?.carryover ?? true}
                        onChange={(e) =>
                          updateGameConfig(game.id, { carryover: e.target.checked })
                        }
                        disabled={disabled}
                        className="rounded border-emerald-700 text-emerald-600 focus:ring-emerald-500"
                      />
                      <label className="text-xs text-emerald-100">Carry over ties to next hole</label>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-emerald-100">Value per skin:</label>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={gameData?.config?.value_per_skin ?? 1}
                        onChange={(e) =>
                          updateGameConfig(game.id, {
                            value_per_skin: parseFloat(e.target.value),
                          })
                        }
                        disabled={disabled}
                        className="w-20 px-2 py-1 rounded border border-emerald-900/70 bg-[#0b3b21]/70 text-xs text-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </>
                )}

                {game.id === "wolf" && (
                  <>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-emerald-100">Points per hole:</label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={gameData?.config?.points_per_hole ?? 1}
                        onChange={(e) =>
                          updateGameConfig(game.id, {
                            points_per_hole: parseInt(e.target.value),
                          })
                        }
                        disabled={disabled}
                        className="w-20 px-2 py-1 rounded border border-emerald-900/70 bg-[#0b3b21]/70 text-xs text-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-emerald-100">Lone wolf multiplier:</label>
                      <input
                        type="number"
                        min={1}
                        step={0.5}
                        value={gameData?.config?.lone_wolf_multiplier ?? 2}
                        onChange={(e) =>
                          updateGameConfig(game.id, {
                            lone_wolf_multiplier: parseFloat(e.target.value),
                          })
                        }
                        disabled={disabled}
                        className="w-20 px-2 py-1 rounded border border-emerald-900/70 bg-[#0b3b21]/70 text-xs text-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </>
                )}

                {game.id === "nassau" && (
                  <p className="text-[11px] text-emerald-100/60 italic">
                    Standard rules apply - no additional configuration needed
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {enabledGames.size > 0 && (
        <div className="rounded-lg border border-blue-900/50 bg-blue-950/20 p-2">
          <p className="text-[10px] text-blue-100/90">
            <span className="font-semibold">ℹ️ Side Games:</span> These games run alongside the main
            format. Results are tracked separately and don't affect handicaps.
          </p>
        </div>
      )}
    </div>
  );
}
