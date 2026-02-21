// components/rounds/BestBallConfig.tsx
"use client";

export type BestBallScoringType = "net_strokes" | "stableford";

type BestBallConfigProps = {
  scoringType: BestBallScoringType;
  countPerHole?: number;
  teamSize?: number;
  onChange: (config: { scoring_type: BestBallScoringType; count_per_hole?: number }) => void;
  disabled?: boolean;
};

export function BestBallConfig({
  scoringType,
  countPerHole,
  teamSize = 2,
  onChange,
  disabled,
}: BestBallConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-emerald-100/80 block mb-1">Scoring Type</label>
        <select
          value={scoringType}
          onChange={(e) =>
            onChange({
              scoring_type: e.target.value as BestBallScoringType,
              count_per_hole: countPerHole,
            })
          }
          disabled={disabled}
          className="w-full rounded-lg border border-emerald-900/70 bg-[#0b3b21]/70 px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
        >
          <option value="net_strokes">Net Strokes (lowest wins)</option>
          <option value="stableford">Stableford Points (highest wins)</option>
        </select>
      </div>

      <p className="text-[11px] text-emerald-100/60">
        {scoringType === "net_strokes"
          ? "Best (lowest) net stroke score per hole counts for the team."
          : "Best (highest) stableford points per hole count for the team."}
      </p>

      {teamSize > 2 && (
        <div>
          <label className="text-xs text-emerald-100/80 block mb-1">
            Best X of {teamSize} per hole
          </label>
          <input
            type="number"
            min={1}
            max={teamSize}
            value={countPerHole ?? 1}
            onChange={(e) =>
              onChange({
                scoring_type: scoringType,
                count_per_hole: Math.max(1, Math.min(teamSize, parseInt(e.target.value) || 1)),
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
