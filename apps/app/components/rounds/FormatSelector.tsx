// components/rounds/FormatSelector.tsx
"use client";

import { useState } from "react";

export type RoundFormatType =
  | "strokeplay"
  | "stableford"
  | "matchplay"
  | "pairs_stableford"
  | "team_strokeplay"
  | "team_stableford"
  | "team_bestball"
  | "scramble"
  | "greensomes"
  | "foursomes"
  | "skins"
  | "wolf";

export const TEAM_FORMATS: RoundFormatType[] = [
  "pairs_stableford",
  "team_strokeplay",
  "team_stableford",
  "team_bestball",
  "scramble",
  "greensomes",
  "foursomes",
];

export function isTeamFormat(format: RoundFormatType): boolean {
  return TEAM_FORMATS.includes(format);
}

const FORMAT_LABELS: Record<RoundFormatType, string> = {
  strokeplay: "Stroke Play",
  stableford: "Stableford",
  matchplay: "Match Play",
  pairs_stableford: "Pairs Stableford",
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
  strokeplay:
    "Each player counts every stroke. Lowest total wins.",
  stableford:
    "Points per hole based on net score relative to par. Highest total points wins.",
  matchplay:
    "Players compete head-to-head, winning individual holes. Most holes won wins the match.",
  pairs_stableford:
    "Teams score stableford points individually. Best, worst, or combined scores count per hole.",
  team_strokeplay:
    "Teams combine all members' stroke totals. Lowest combined score wins.",
  team_stableford:
    "Teams combine all members' stableford points. Highest combined points wins.",
  team_bestball:
    "Each player plays their own ball. Best scores per hole count for the team.",
  scramble:
    "All players hit, team plays from the best shot. One score per team per hole.",
  greensomes:
    "Both tee off, choose the best drive, then alternate shots until holed out.",
  foursomes:
    "Partners alternate shots playing one ball. One tees off odd holes, the other even.",
  skins:
    "Each hole is worth a skin. Lowest unique score wins. Ties can carry over.",
  wolf:
    "Rotating team game. The wolf picks a partner each hole or goes lone wolf for double points.",
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
          <option value="skins">{FORMAT_LABELS.skins}</option>
          <option value="wolf">{FORMAT_LABELS.wolf}</option>
        </optgroup>
        <optgroup label="Team">
          <option value="pairs_stableford">{FORMAT_LABELS.pairs_stableford}</option>
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
