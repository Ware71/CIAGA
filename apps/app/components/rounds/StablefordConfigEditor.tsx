// components/rounds/StablefordConfigEditor.tsx
"use client";

import { useState, useEffect } from "react";

type StablefordPoints = {
  albatross?: number; // -3
  eagle: number; // -2
  birdie: number; // -1
  par: number; // 0
  bogey: number; // +1
  double_bogey: number; // +2
  triple_bogey_or_worse: number; // +3 or more
};

const DEFAULT_STABLEFORD: StablefordPoints = {
  albatross: 5,
  eagle: 4,
  birdie: 3,
  par: 2,
  bogey: 1,
  double_bogey: 0,
  triple_bogey_or_worse: 0,
};

const MODIFIED_STABLEFORD: StablefordPoints = {
  albatross: 8,
  eagle: 5,
  birdie: 2,
  par: 0,
  bogey: -1,
  double_bogey: -3,
  triple_bogey_or_worse: -5,
};

type StablefordConfigEditorProps = {
  value?: Partial<StablefordPoints>;
  onChange: (config: StablefordPoints) => void;
  disabled?: boolean;
};

export function StablefordConfigEditor({ value, onChange, disabled }: StablefordConfigEditorProps) {
  const [points, setPoints] = useState<StablefordPoints>({ ...DEFAULT_STABLEFORD, ...value });
  const [preset, setPreset] = useState<"default" | "modified" | "custom">("default");

  useEffect(() => {
    // Detect which preset is active
    const current = { ...DEFAULT_STABLEFORD, ...value };
    if (JSON.stringify(current) === JSON.stringify(DEFAULT_STABLEFORD)) {
      setPreset("default");
    } else if (JSON.stringify(current) === JSON.stringify(MODIFIED_STABLEFORD)) {
      setPreset("modified");
    } else {
      setPreset("custom");
    }
    setPoints(current);
  }, [value]);

  const handlePresetChange = (newPreset: "default" | "modified" | "custom") => {
    setPreset(newPreset);
    if (newPreset === "default") {
      setPoints(DEFAULT_STABLEFORD);
      onChange(DEFAULT_STABLEFORD);
    } else if (newPreset === "modified") {
      setPoints(MODIFIED_STABLEFORD);
      onChange(MODIFIED_STABLEFORD);
    }
    // custom = keep current values
  };

  const handlePointChange = (key: keyof StablefordPoints, value: number) => {
    const updated = { ...points, [key]: value };
    setPoints(updated);
    setPreset("custom"); // Any manual change = custom
    onChange(updated);
  };

  const scores = [
    { key: "albatross" as const, label: "Albatross (-3)", relative: "-3" },
    { key: "eagle" as const, label: "Eagle (-2)", relative: "-2" },
    { key: "birdie" as const, label: "Birdie (-1)", relative: "-1" },
    { key: "par" as const, label: "Par (0)", relative: "0" },
    { key: "bogey" as const, label: "Bogey (+1)", relative: "+1" },
    { key: "double_bogey" as const, label: "Double Bogey (+2)", relative: "+2" },
    { key: "triple_bogey_or_worse" as const, label: "Triple+ (+3 or more)", relative: "+3+" },
  ];

  return (
    <div className="space-y-4">
      {/* Preset Selector */}
      <div>
        <label className="text-xs text-emerald-100/80 mb-2 block">Points Table</label>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => handlePresetChange("default")}
            disabled={disabled}
            className={`
              px-3 py-2 rounded-lg text-xs font-medium transition-colors
              ${
                preset === "default"
                  ? "bg-emerald-700 text-white"
                  : "border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-100 hover:bg-[#0b3b21]/60"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            Standard
          </button>
          <button
            onClick={() => handlePresetChange("modified")}
            disabled={disabled}
            className={`
              px-3 py-2 rounded-lg text-xs font-medium transition-colors
              ${
                preset === "modified"
                  ? "bg-emerald-700 text-white"
                  : "border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-100 hover:bg-[#0b3b21]/60"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            Modified
          </button>
          <button
            disabled={true}
            className={`
              px-3 py-2 rounded-lg text-xs font-medium
              ${
                preset === "custom"
                  ? "bg-emerald-700 text-white"
                  : "border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-100/50"
              }
            `}
          >
            Custom
          </button>
        </div>
        <p className="text-[10px] text-emerald-100/60 mt-1">
          {preset === "default"
            ? "Standard stableford: +2 for par, +1 for bogey"
            : preset === "modified"
            ? "Modified: Negative points for over par"
            : "Custom points table"}
        </p>
      </div>

      {/* Points Table */}
      <div className="space-y-1.5">
        {scores.map(({ key, label, relative }) => (
          <div key={key} className="flex items-center gap-3">
            <div className="flex-1 text-xs text-emerald-100">
              <span className="font-medium">{relative}</span>
              <span className="text-emerald-100/60 ml-2">{label.split("(")[0]}</span>
            </div>
            <input
              type="number"
              min={-10}
              max={10}
              step={1}
              value={points[key] ?? 0}
              onChange={(e) => handlePointChange(key, parseInt(e.target.value, 10) || 0)}
              disabled={disabled}
              className="w-16 px-2 py-1 rounded border border-emerald-900/70 bg-[#0b3b21]/70 text-xs text-emerald-50 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
            />
            <span className="text-xs text-emerald-100/60 w-8">pts</span>
          </div>
        ))}
      </div>

      {/* Reference */}
      <div className="rounded-lg border border-blue-900/50 bg-blue-950/20 p-2">
        <p className="text-[10px] text-blue-100/90">
          <span className="font-semibold">ℹ️ Stableford Scoring:</span> Points awarded based on
          score relative to par. Higher points = better. Standard: 2pts for par, modified: 0pts for
          par.
        </p>
      </div>
    </div>
  );
}
