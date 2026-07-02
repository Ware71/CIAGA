// components/calendar/eventStyles.ts
import type { OccurrenceKind } from "@/lib/calendar/types";

/** Chip styling per occurrence kind (matches the app's emerald/gold theme). */
export function chipClasses(kind: OccurrenceKind): string {
  switch (kind) {
    case "round":
      return "bg-[#f5e6b0] text-[#042713] border border-[#e9d79c]";
    case "available":
      return "bg-emerald-500/20 text-emerald-100 border border-emerald-400/40";
    case "unavailable":
      return "bg-red-900/30 text-red-200 border border-red-800/50";
  }
}

/** A subtle owner tint (dot colour) so layered calendars are distinguishable. */
const OWNER_PALETTE = [
  "#f5e6b0", // gold
  "#7dd3fc", // sky
  "#f9a8d4", // pink
  "#c4b5fd", // violet
  "#86efac", // green
  "#fdba74", // orange
  "#fca5a5", // red
  "#a5f3fc", // cyan
];

export function ownerColor(profileId: string): string {
  let hash = 0;
  for (let i = 0; i < profileId.length; i++) {
    hash = (hash * 31 + profileId.charCodeAt(i)) >>> 0;
  }
  return OWNER_PALETTE[hash % OWNER_PALETTE.length];
}
