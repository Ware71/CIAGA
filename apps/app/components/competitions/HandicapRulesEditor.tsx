"use client";

export type HandicapMode = "allowance_pct" | "compare_against_lowest" | "fixed" | "none";

export type HandicapRules = {
  mode: HandicapMode;
  allowance_pct: string;
  max_handicap: string;
};

type Props = {
  value: HandicapRules;
  onChange: (v: HandicapRules) => void;
  disabled?: boolean;
  compact?: boolean;
};

export function HandicapRulesEditor({ value, onChange, disabled, compact }: Props) {
  const labelClass = compact
    ? "text-[10px] text-emerald-200/60"
    : "text-[11px] text-emerald-200/65";
  const inputClass = compact
    ? "w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
    : "w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600";

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className={labelClass}>Handicap Mode</label>
        <select
          disabled={disabled}
          value={value.mode}
          onChange={(e) => {
            const m = e.target.value as HandicapMode;
            onChange({
              ...value,
              mode: m,
              allowance_pct: m === "allowance_pct" ? (value.allowance_pct || "100") : value.allowance_pct,
            });
          }}
          className={inputClass}
        >
          <option value="allowance_pct">Percentage Allowance</option>
          <option value="compare_against_lowest">Off the Lowest</option>
          <option value="fixed">Fixed Handicap</option>
          <option value="none">No Handicap (Gross Only)</option>
        </select>
        {value.mode === "compare_against_lowest" && (
          <p className="text-[10px] text-emerald-100/40">
            Best player plays off scratch. Others receive strokes equal to the difference from the lowest handicap.
          </p>
        )}
      </div>

      {value.mode === "allowance_pct" && (
        <div className="space-y-1">
          <label className={labelClass}>Handicap Allowance %</label>
          <input
            type="number"
            min={0}
            max={100}
            disabled={disabled}
            value={value.allowance_pct}
            onChange={(e) => onChange({ ...value, allowance_pct: e.target.value })}
            className={inputClass}
          />
          <p className="text-[10px] text-emerald-100/40">
            e.g. 90 = players use 90% of their course handicap
          </p>
        </div>
      )}

      {value.mode !== "none" && (
        <div className="space-y-1">
          <label className={labelClass}>Max Handicap (optional)</label>
          <input
            type="number"
            min={0}
            disabled={disabled}
            value={value.max_handicap}
            onChange={(e) => onChange({ ...value, max_handicap: e.target.value })}
            placeholder="Leave blank for no limit"
            className={`${inputClass} placeholder:text-emerald-100/35`}
          />
          <p className="text-[10px] text-emerald-100/40">Cap the maximum handicap that can be applied</p>
        </div>
      )}
    </div>
  );
}
