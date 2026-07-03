// components/calendar/eventStyles.ts
import type { OccurrenceKind, PlayerDayStatus, ResolvedOccurrence } from "@/lib/calendar/types";

/** Per-kind accent colour for the flat accent-bar chips. */
export function accentColor(occ: ResolvedOccurrence): string {
  if (occ.kind === "round") return occ.roundStatus === "finished" ? "#b8993f" : "#f5e6b0";
  if (occ.kind === "event") return occ.eventStatus === "confirmed" ? "#f5e6b0" : "#9ca3af";
  if (occ.kind === "available") return "#34d399";
  return "#ef4444"; // unavailable
}

/** Month availability dot colours. */
export const STATUS_COLORS: Record<PlayerDayStatus, string> = {
  available: "#34d399", // green
  scheduled: "#b8993f", // dull gold
  unavailable: "#ef4444", // red
  none: "#6b7280", // grey
};

/** Chip styling per occurrence kind (matches the app's emerald/gold theme). */
export function chipClasses(kind: OccurrenceKind): string {
  switch (kind) {
    case "round":
      return "bg-[#f5e6b0] text-[#042713] border border-[#e9d79c]";
    case "event":
      return "bg-[#f5e6b0]/20 text-[#f5e6b0] border border-[#f5e6b0]/40";
    case "available":
      return "bg-emerald-500/20 text-emerald-100 border border-emerald-400/40";
    case "unavailable":
      return "bg-red-900/30 text-red-200 border border-red-800/50";
  }
}

/** Occurrence-aware styling — finished rounds + draft events get distinct looks. */
export function occChipClasses(occ: ResolvedOccurrence): string {
  if (occ.kind === "round" && occ.roundStatus === "finished") {
    return "bg-[#f5e6b0]/25 text-[#f5e6b0] border border-[#f5e6b0]/40";
  }
  if (occ.kind === "event") {
    return occ.eventStatus === "confirmed"
      ? "bg-[#f5e6b0]/20 text-[#f5e6b0] border border-[#f5e6b0]/50"
      : "bg-[#f5e6b0]/5 text-[#f5e6b0]/80 border border-dashed border-[#f5e6b0]/40";
  }
  return chipClasses(occ.kind);
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
