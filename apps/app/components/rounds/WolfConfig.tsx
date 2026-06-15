// components/rounds/WolfConfig.tsx
"use client";

export type WolfScoring = "net" | "gross";
export type WolfTieMode = "push" | "carryover";

export type WolfConfigValue = {
  scoring: WolfScoring;
  tie_mode: WolfTieMode;
  points_per_hole: number;
  lone_wolf_multiplier: number;
  blind_wolf_multiplier: number;
};

export const WOLF_CONFIG_DEFAULTS: WolfConfigValue = {
  scoring: "net",
  tie_mode: "carryover",
  points_per_hole: 1,
  lone_wolf_multiplier: 2,
  blind_wolf_multiplier: 3,
};

type WolfConfigProps = {
  value?: Partial<WolfConfigValue>;
  onChange: (config: WolfConfigValue) => void;
  disabled?: boolean;
};

export function WolfConfig({ value, onChange, disabled }: WolfConfigProps) {
  const cfg: WolfConfigValue = { ...WOLF_CONFIG_DEFAULTS, ...(value ?? {}) };
  const emit = (patch: Partial<WolfConfigValue>) => onChange({ ...cfg, ...patch });

  const numberField = (
    label: string,
    key: keyof Pick<WolfConfigValue, "points_per_hole" | "lone_wolf_multiplier" | "blind_wolf_multiplier">,
    hint: string,
  ) => (
    <div>
      <label className="text-xs text-emerald-100/80 block mb-1">{label}</label>
      <input
        type="number"
        min={1}
        value={cfg[key]}
        onChange={(e) => emit({ [key]: Math.max(1, parseInt(e.target.value) || 1) } as Partial<WolfConfigValue>)}
        disabled={disabled}
        className="w-24 px-2 py-1 rounded border border-emerald-900/70 bg-[#0b3b21]/70 text-xs text-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
      />
      <p className="text-[11px] text-emerald-100/60 mt-1">{hint}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-emerald-100/80 block mb-1">Scoring</label>
        <select
          value={cfg.scoring}
          onChange={(e) => emit({ scoring: e.target.value as WolfScoring })}
          disabled={disabled}
          className="w-full rounded-lg border border-emerald-900/70 bg-[#0b3b21]/70 px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
        >
          <option value="net">Net (handicap adjusted)</option>
          <option value="gross">Gross (no handicap)</option>
        </select>
      </div>

      <div>
        <label className="text-xs text-emerald-100/80 block mb-1">Tied holes</label>
        <select
          value={cfg.tie_mode}
          onChange={(e) => emit({ tie_mode: e.target.value as WolfTieMode })}
          disabled={disabled}
          className="w-full rounded-lg border border-emerald-900/70 bg-[#0b3b21]/70 px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
        >
          <option value="carryover">Carry over (next hole pays double, then triple…)</option>
          <option value="push">Push (no points awarded)</option>
        </select>
      </div>

      {numberField("Points per hole", "points_per_hole", "Base stake awarded to each player on the winning side.")}
      {numberField("Lone Wolf multiplier", "lone_wolf_multiplier", "Stake multiplier when the wolf plays alone.")}
      {numberField("Blind Wolf multiplier", "blind_wolf_multiplier", "Stake multiplier when the wolf declares blind (alone, before tee shots).")}
    </div>
  );
}
