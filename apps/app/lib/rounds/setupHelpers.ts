// Round-setup helper functions and types — extracted from setup/page.tsx.

import type { RoundFormatType } from "@/components/rounds/FormatSelector";
import type { PlayingHandicapMode } from "@/components/rounds/PlayingHandicapSettings";

// ─── Types ───────────────────────────────────────────────────────

export type Round = {
  id: string;
  name: string | null;
  status: "draft" | "scheduled" | "starting" | "live" | "finished";
  course_id: string | null;
  pending_tee_box_id: string | null;
  started_at: string | null;
  courses?: { name: string | null }[] | { name: string | null } | null;
  format_type?: RoundFormatType;
  format_config?: Record<string, any>;
  side_games?: Array<any>;
  scheduled_at?: string | null;
  default_playing_handicap_mode?: PlayingHandicapMode;
  default_playing_handicap_value?: number;
};

export type ProfileJoin = {
  id?: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type Participant = {
  id: string;
  profile_id: string | null;
  is_guest: boolean;
  display_name: string | null;
  role: "owner" | "scorer" | "player";
  profiles?: ProfileJoin | ProfileJoin[] | null;
  handicap_index?: number | null;
  assigned_playing_handicap?: number | null;
  assigned_handicap_index?: number | null;
  playing_handicap_used?: number | null;
  course_handicap_used?: number | null;
};

export type ProfileLite = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

// ─── Pure helpers ────────────────────────────────────────────────

export function courseNameFromJoin(round: any): string | null {
  const c = round?.courses;
  if (!c) return null;
  if (Array.isArray(c)) return c?.[0]?.name ?? null;
  return c?.name ?? null;
}

export function niceNameFromEmail(email?: string | null) {
  if (!email) return null;
  const left = email.split("@")[0]?.trim();
  return left || null;
}

export function pickNickname(
  p: { name?: string | null; email?: string | null } | null | undefined,
) {
  return p?.name || niceNameFromEmail(p?.email) || p?.email || "User";
}

export function getProfile(p: Participant): ProfileJoin | null {
  const pr = p.profiles;
  if (!pr) return null;
  return Array.isArray(pr) ? pr[0] ?? null : pr;
}

/** WHS: Course Handicap = HI*(Slope/113) + (Course Rating - Par) */
export function calcCourseHandicap(
  hi: number,
  slope: number,
  rating: number,
  par: number,
) {
  return Math.round(hi * (slope / 113) + (rating - par));
}
