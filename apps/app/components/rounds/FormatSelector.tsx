// components/rounds/FormatSelector.tsx
"use client";

import { useState } from "react";

export type RoundFormatType =
  | "strokeplay"
  | "stableford"
  | "matchplay"
  | "team_strokeplay"
  | "team_stableford"
  | "team_bestball"
  | "scramble"
  | "greensomes"
  | "foursomes"
  | "skins"
  | "wolf";

const FORMAT_LABELS: Record<RoundFormatType, string> = {
  strokeplay: "Stroke Play",
  stableford: "Stableford",
  matchplay: "Match Play",
  team_strokeplay: "Team Stroke Play",
  team_stableford: "Team Stableford",
  team_bestball: "Best Ball",
  scramble: "Scramble",
  greensomes: "Greensomes",
  foursomes: "Foursomes (Alternate Shot)",
  skins: "Skins",
  wolf: "Wolf",
};

const FORMAT_DESCRIPTIONS: Record<RoundFormatType, string> = {
  strokeplay: "Traditional stroke play - lowest total score wins",
  stableford: "Points-based scoring system",
  matchplay: "Head-to-head match - win holes to win the match",
  team_strokeplay: "Team format - combined stroke play scores",
  team_stableford: "Team format - combined stableford points",
  team_bestball: "Team format - best score per hole counts",
  scramble: "Team format - all play from best shot",
  greensomes: "Team format - alternate shots after tee",
  foursomes: "Team format - alternate shots from tee",
  skins: "Win by having the lowest unique score on a hole",
  wolf: "Rotating team game with betting",
};

type FormatSelectorProps = {
  value: RoundFormatType;
  onChange: (format: RoundFormatType) => void;
  disabled?: boolean;
  isOwner?: boolean;
};

export function FormatSelector({ value, onChange, disabled, isOwner }: FormatSelectorProps) {
  if (!isOwner) {
    // Non-owners see read-only display
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-emerald-100">Round Format</label>
        <div className="rounded-lg border border-emerald-900/70 bg-[#0b3b21]/50 p-3">
          <div className="text-sm font-semibold text-emerald-50">{FORMAT_LABELS[value]}</div>
          <div className="text-xs text-emerald-100/70 mt-1">{FORMAT_DESCRIPTIONS[value]}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor="format-select" className="text-sm font-medium text-emerald-100">
        Round Format
        <span className="text-xs text-emerald-200/60 ml-2">(Owner only)</span>
      </label>
      <select
        id="format-select"
        value={value}
        onChange={(e) => onChange(e.target.value as RoundFormatType)}
        disabled={disabled}
        className="w-full rounded-lg border border-emerald-900/70 bg-[#0b3b21]/70 px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <optgroup label="Individual">
          <option value="strokeplay">{FORMAT_LABELS.strokeplay}</option>
          <option value="stableford">{FORMAT_LABELS.stableford}</option>
          <option value="matchplay">{FORMAT_LABELS.matchplay}</option>
        </optgroup>
        <optgroup label="Team">
          <option value="team_strokeplay">{FORMAT_LABELS.team_strokeplay}</option>
          <option value="team_stableford">{FORMAT_LABELS.team_stableford}</option>
          <option value="team_bestball">{FORMAT_LABELS.team_bestball}</option>
          <option value="scramble">{FORMAT_LABELS.scramble}</option>
          <option value="greensomes">{FORMAT_LABELS.greensomes}</option>
          <option value="foursomes">{FORMAT_LABELS.foursomes}</option>
        </optgroup>
      </select>
      <p className="text-xs text-emerald-100/60">{FORMAT_DESCRIPTIONS[value]}</p>
    </div>
  );
}
