// components/rounds/PlayingHandicapSettings.tsx
"use client";

export type PlayingHandicapMode = "none" | "allowance_pct" | "fixed" | "compare_against_lowest";

const MODE_LABELS: Record<PlayingHandicapMode, string> = {
  none: "No Handicap (Gross Only)",
  allowance_pct: "Percentage Allowance",
  fixed: "Fixed Handicap",
  compare_against_lowest: "Off the Lowest",
};

const MODE_DESCRIPTIONS: Record<PlayingHandicapMode, string> = {
  none: "Gross scores only - no handicap strokes applied",
  allowance_pct:
    "Apply a percentage of course handicap (e.g., 100% for stroke play, 85% for match play)",
  fixed: "Use a fixed playing handicap value for all participants",
  compare_against_lowest:
    "Best player plays off scratch. Others receive strokes equal to the difference from the lowest handicap.",
};

type PlayingHandicapSettingsProps = {
  mode: PlayingHandicapMode;
  value: number;
  onModeChange: (mode: PlayingHandicapMode) => void;
  onValueChange: (value: number) => void;
  disabled?: boolean;
  isOwner?: boolean;
};

export function PlayingHandicapSettings({
  mode,
  value,
  onModeChange,
  onValueChange,
  disabled,
  isOwner,
}: PlayingHandicapSettingsProps) {
  if (!isOwner) {
    // Non-owners see read-only display
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-emerald-100">Playing Handicap</label>
        <div className="rounded-lg border border-emerald-900/70 bg-[#0b3b21]/50 p-3">
          <div className="text-sm font-semibold text-emerald-50">
            {MODE_LABELS[mode]}
            {mode === "allowance_pct" && (
              <span className="text-emerald-200/80 ml-2">({value}%)</span>
            )}
            {mode === "fixed" && (
              <span className="text-emerald-200/80 ml-2">({value})</span>
            )}
          </div>
          <div className="text-xs text-emerald-100/70 mt-1">{MODE_DESCRIPTIONS[mode]}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-emerald-100">
        Playing Handicap
        <span className="text-xs text-emerald-200/60 ml-2">(Owner only)</span>
      </label>

      {/* Mode Selector */}
      <select
        value={mode}
        onChange={(e) => {
          const newMode = e.target.value as PlayingHandicapMode;
          onModeChange(newMode);
          // Set sensible defaults when mode changes
          if (newMode === "none") onValueChange(0);
          else if (newMode === "allowance_pct") onValueChange(100);
          else if (newMode === "fixed") onValueChange(18);
          else if (newMode === "compare_against_lowest") onValueChange(0);
        }}
        disabled={disabled}
        className="w-full rounded-lg border border-emerald-900/70 bg-[#0b3b21]/70 px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="none">{MODE_LABELS.none}</option>
        <option value="allowance_pct">{MODE_LABELS.allowance_pct}</option>
        <option value="fixed">{MODE_LABELS.fixed}</option>
        <option value="compare_against_lowest">{MODE_LABELS.compare_against_lowest}</option>
      </select>

      {/* Value Input (only shown for allowance_pct and fixed modes) */}
      {mode !== "none" && mode !== "compare_against_lowest" && (
        <div className="space-y-2">
          <label htmlFor="handicap-value" className="text-xs text-emerald-100/80">
            {mode === "allowance_pct" ? "Allowance Percentage" : "Fixed Handicap Value"}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="handicap-value"
              type="number"
              min={0}
              max={mode === "allowance_pct" ? 100 : 54}
              step={mode === "allowance_pct" ? 5 : 1}
              value={value}
              onChange={(e) => onValueChange(parseFloat(e.target.value) || 0)}
              disabled={disabled}
              className="flex-1 rounded-lg border border-emerald-900/70 bg-[#0b3b21]/70 px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <span className="text-sm text-emerald-100/70">
              {mode === "allowance_pct" ? "%" : ""}
            </span>
          </div>

          {/* Helper text */}
          <p className="text-xs text-emerald-100/60">
            {mode === "allowance_pct" ? (
              <>
                Common values: 100% (stroke play), 95% (4-ball), 90% (bogey), 85% (par/singles
                matchplay), 75% (4-ball matchplay)
              </>
            ) : (
              <>Maximum handicap value is 54</>
            )}
          </p>
        </div>
      )}

      <p className="text-xs text-emerald-100/60">{MODE_DESCRIPTIONS[mode]}</p>

      {/* Important note about manual overrides */}
      <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
        <p className="text-xs text-amber-100/90">
          <span className="font-semibold">Note:</span> Individual participants can override their
          playing handicap below. Manual overrides are for <strong>scoring only</strong> and do not
          affect official handicap index calculations.
        </p>
      </div>
    </div>
  );
}
