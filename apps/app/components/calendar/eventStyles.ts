// components/calendar/eventStyles.ts
import type { CSSProperties } from "react";
import type { OccurrenceKind, PlayerDayStatus, ResolvedOccurrence } from "@/lib/calendar/types";

/** Per-kind accent colour for the flat accent-bar chips. */
export function accentColor(occ: ResolvedOccurrence): string {
  // Finished rounds read dulled, live/upcoming read at full accent.
  if (occ.kind === "round")
    return occ.roundStatus === "finished"
      ? "color-mix(in srgb, var(--sec-accent) 55%, transparent)"
      : "var(--sec-accent)";
  if (occ.kind === "event") {
    // Entered / open events read gold; not-yet-open / closed read muted grey.
    return occ.entryState === "entry_soon" || occ.entryState === "entry_closed"
      ? "#9ca3af"
      : "var(--sec-accent)";
  }
  if (occ.kind === "available") return "#34d399";
  return "#ef4444"; // unavailable
}

/** The entry-state tag for a Majors event chip (null = no tag). */
export type EntryTagTone = "entered" | "now" | "soon";
export function entryTag(occ: ResolvedOccurrence): { label: string; tone: EntryTagTone } | null {
  if (occ.kind !== "event") return null;
  switch (occ.entryState) {
    case "entered":
      return { label: "Entered", tone: "entered" };
    case "enter_now":
      return { label: "Enter now", tone: "now" };
    case "entry_soon":
      return { label: "Entry soon", tone: "soon" };
    default:
      return null; // entry_closed → no tag
  }
}

/** Pill classes for each entry-state tone. */
export const ENTRY_TAG_CLASSES: Record<EntryTagTone, string> = {
  entered: "bg-emerald-400/20 text-[color:var(--sec-text)]",
  now: "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] font-semibold",
  soon: "bg-white/10 text-[color:var(--sec-muted)]",
};

/** Diagonal-hatch fill marking a day the active filter *removed* (vs empty). */
export const REMOVED_CELL_STYLE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(148,163,184,0.16) 0, rgba(148,163,184,0.16) 3px, transparent 3px, transparent 8px)",
};
export const REMOVED_CELL_CLASS = "opacity-60";

/** Month availability dot colours. */
export const STATUS_COLORS: Record<PlayerDayStatus, string> = {
  available: "#34d399", // green
  scheduled: "color-mix(in srgb, var(--sec-accent) 60%, transparent)",
  unavailable: "#ef4444", // red
  none: "#6b7280", // grey
};

/** Chip styling per occurrence kind (matches the app's emerald/gold theme). */
export function chipClasses(kind: OccurrenceKind): string {
  switch (kind) {
    case "round":
      return "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] border border-[color:var(--sec-accent)]";
    case "event":
      return "bg-[color:color-mix(in_srgb,var(--sec-accent)_20%,transparent)] text-[color:var(--sec-accent)] border border-[color:color-mix(in_srgb,var(--sec-accent)_40%,transparent)]";
    case "available":
      return "bg-emerald-500/20 text-[color:var(--sec-text)] border border-[color:var(--sec-accent)]";
    case "unavailable":
      return "bg-red-900/30 text-red-200 border border-red-800/50";
  }
}

/** Occurrence-aware styling — finished rounds + entry-state events get distinct looks. */
export function occChipClasses(occ: ResolvedOccurrence): string {
  if (occ.kind === "round" && occ.roundStatus === "finished") {
    return "bg-[color:color-mix(in_srgb,var(--sec-accent)_25%,transparent)] text-[color:var(--sec-accent)] border border-[color:color-mix(in_srgb,var(--sec-accent)_40%,transparent)]";
  }
  if (occ.kind === "event") {
    // Not-yet-open / closed events read softer than entered / open ones.
    return occ.entryState === "entry_soon" || occ.entryState === "entry_closed"
      ? "bg-[color:color-mix(in_srgb,var(--sec-accent)_5%,transparent)] text-[color:color-mix(in_srgb,var(--sec-accent)_80%,transparent)] border border-[color:color-mix(in_srgb,var(--sec-accent)_30%,transparent)]"
      : "bg-[color:color-mix(in_srgb,var(--sec-accent)_20%,transparent)] text-[color:var(--sec-accent)] border border-[color:color-mix(in_srgb,var(--sec-accent)_50%,transparent)]";
  }
  return chipClasses(occ.kind);
}

/** Shade for free gaps < 3h inside 6am–10pm — greyed like busy, a touch lighter. */
export const UNUSABLE_SHADE = "bg-slate-500/12";
/** Shade for busy time in the time grid. */
export const BUSY_SHADE = "bg-slate-500/20";
/** Shade for explicitly-available time in the time grid. */
export const AVAILABLE_SHADE = "bg-emerald-400/15";

/** A subtle owner tint (dot colour) so layered calendars are distinguishable. */
const OWNER_PALETTE = [
  "var(--sec-accent)", // gold
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
