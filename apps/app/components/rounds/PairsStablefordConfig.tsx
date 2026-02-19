// components/rounds/PairsStablefordConfig.tsx
"use client";

export type PairsScoringMode = "best" | "worst" | "combined";

type PairsStablefordConfigProps = {
  scoringMode: PairsScoringMode;
  countPerHole?: number;
  teamSize?: number;
  onChange: (config: { scoring_mode: PairsScoringMode; count_per_hole?: number }) => void;
  disabled?: boolean;
};

export function PairsStablefordConfig({
  scoringMode,
  countPerHole,
  teamSize = 2,
  onChange,
  disabled,
}: PairsStablefordConfigProps) {
  const needsCount = scoringMode !== "combined" && teamSize > 2;

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-emerald-100/80 block mb-1">Scoring Mode</label>
        <select
          value={scoringMode}
          onChange={(e) => {
            const mode = e.target.value as PairsScoringMode;
            onChange({
              scoring_mode: mode,
              count_per_hole: mode === "combined" ? undefined : countPerHole,
            });
          }}
          disabled={disabled}
          className="w-full rounded-lg border border-emerald-900/70 bg-[#0b3b21]/70 px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
        >
          <option value="best">Best score(s) count</option>
          <option value="worst">Worst score(s) count</option>
          <option value="combined">All scores combined</option>
        </select>
      </div>

      <p className="text-[11px] text-emerald-100/60">
        {scoringMode === "best" && "Each hole: the highest stableford points from the team count."}
        {scoringMode === "worst" && "Each hole: the lowest stableford points from the team count."}
        {scoringMode === "combined" && "Each hole: all team members' stableford points are added together."}
      </p>

      {needsCount && (
        <div>
          <label className="text-xs text-emerald-100/80 block mb-1">
            How many scores count per hole? (out of {teamSize})
          </label>
          <input
            type="number"
            min={1}
            max={teamSize - 1}
            value={countPerHole ?? 1}
            onChange={(e) =>
              onChange({
                scoring_mode: scoringMode,
                count_per_hole: Math.max(1, Math.min(teamSize - 1, parseInt(e.target.value) || 1)),
              })
            }
            disabled={disabled}
            className="w-20 px-2 py-1 rounded border border-emerald-900/70 bg-[#0b3b21]/70 text-xs text-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      )}
    </div>
  );
}
