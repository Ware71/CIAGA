// components/rounds/WolfConfig.tsx
"use client";

export type WolfScoring = "net" | "gross";
export type WolfTieMode = "push" | "carryover";

export type WolfConfigValue = {
  scoring: WolfScoring;
  tie_mode: WolfTieMode;
  partner_wolf_points: number; // wolf + partner each, when the wolf side wins
  partner_others_points: number; // opponents each, when they beat wolf + partner
  lone_wolf_points: number; // lone wolf, when alone & wins
  lone_others_points: number; // opponents each, when they beat the lone wolf
  blind_wolf_points: number; // blind wolf, when alone & wins
  blind_others_points: number; // opponents each, when they beat the blind wolf
};

export const WOLF_CONFIG_DEFAULTS: WolfConfigValue = {
  scoring: "net",
  tie_mode: "carryover",
  partner_wolf_points: 2,
  partner_others_points: 3,
  lone_wolf_points: 4,
  lone_others_points: 1,
  blind_wolf_points: 8,
  blind_others_points: 1,
};

type WolfPointsKey =
  | "partner_wolf_points"
  | "partner_others_points"
  | "lone_wolf_points"
  | "lone_others_points"
  | "blind_wolf_points"
  | "blind_others_points";

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
    key: WolfPointsKey,
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

      <div className="space-y-2">
        <p className="text-xs font-medium text-emerald-100/90">Partner</p>
        <div className="grid grid-cols-2 gap-3">
          {numberField("Wolf side wins", "partner_wolf_points", "Points to the wolf and partner each when their side wins.")}
          {numberField("Opponents win", "partner_others_points", "Points to each opponent when they beat the wolf and partner.")}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-emerald-100/90">Lone Wolf</p>
        <div className="grid grid-cols-2 gap-3">
          {numberField("Wolf wins", "lone_wolf_points", "Points to the lone wolf when playing alone and winning.")}
          {numberField("Opponents win", "lone_others_points", "Points to each opponent when they beat the lone wolf.")}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-emerald-100/90">Blind Wolf</p>
        <div className="grid grid-cols-2 gap-3">
          {numberField("Wolf wins", "blind_wolf_points", "Points to the blind wolf (declared alone before tee shots) when winning.")}
          {numberField("Opponents win", "blind_others_points", "Points to each opponent when they beat the blind wolf.")}
        </div>
      </div>
    </div>
  );
}
