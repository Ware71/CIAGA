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
    ? "text-[10px] text-[color:var(--sec-muted)]"
    : "text-[11px] text-[color:var(--sec-muted)]";
  const inputClass = compact
    ? "w-full rounded-xl bg-[color:var(--sec-surface)] border border-[color:var(--sec-hair)] px-3 py-2 text-sm text-[color:var(--sec-text)] focus:outline-none focus:border-[color:var(--sec-line)]"
    : "w-full rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_60%,transparent)] px-4 py-2.5 text-sm text-[color:var(--sec-text)] focus:outline-none focus:border-[color:var(--sec-line)]";

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
              allowance_pct: (m === "allowance_pct" || m === "compare_against_lowest") ? (value.allowance_pct || "100") : value.allowance_pct,
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
          <p className="text-[10px] text-[color:var(--sec-muted)]">
            Best player plays off scratch. Others receive strokes equal to the difference from the lowest handicap.
          </p>
        )}
      </div>

      {(value.mode === "allowance_pct" || value.mode === "compare_against_lowest") && (
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
          <p className="text-[10px] text-[color:var(--sec-muted)]">
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
            className={`${inputClass} placeholder:text-[color:var(--sec-muted)]`}
          />
          <p className="text-[10px] text-[color:var(--sec-muted)]">Cap the maximum handicap that can be applied</p>
        </div>
      )}
    </div>
  );
}
