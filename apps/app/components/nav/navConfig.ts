import {
  CalendarDays,
  LayoutGrid,
  MessageCircle,
  Trophy,
  type LucideIcon,
} from "lucide-react";

/**
 * Every routing decision the bottom nav makes lives here: which tabs exist, where
 * the bar hides, and which options the long-press wheel offers per section.
 *
 * Kept free of React so it can be unit-tested and imported from both bars.
 */

export type TabDef = {
  href: string;
  /** Icon-only in the UI, so this is the accessible name. */
  label: string;
  Icon: LucideIcon;
  /** Keeps the parent tab lit across its children. */
  match: (pathname: string) => boolean;
};

export type WheelItem = { id: string; label: string; href: string };

/**
 * Total space the floating bar reserves at the bottom of every scroll container.
 * The docked logo, not the pill, sets this: its base sits on the pill's base, so
 * the reserve is the 12px margin plus the 84px button — the 60px pill fits inside
 * that. Mirrored as `--ciaga-nav-h` in globals.css — change both together.
 */
export const NAV_H = 96;

const isMajors = (p: string) => p === "/majors" || p.startsWith("/majors/");
const isFantasy = (p: string) => p === "/majors/fantasy" || p.startsWith("/majors/fantasy/");

/** Rendered left of the docked logo. Majors leads — it's the reason the society exists. */
export const TABS_LEFT: TabDef[] = [
  {
    href: "/majors",
    label: "Majors",
    Icon: Trophy,
    match: isMajors,
  },
  {
    href: "/social",
    label: "Social",
    Icon: MessageCircle,
    match: (p) => p === "/social" || p.startsWith("/social/"),
  },
];

/** Rendered right of the docked logo. */
export const TABS_RIGHT: TabDef[] = [
  {
    href: "/calendar",
    label: "Calendar",
    Icon: CalendarDays,
    match: (p) => p === "/calendar",
  },
  {
    href: "/more",
    label: "More",
    Icon: LayoutGrid,
    // /profile has no tab of its own and is reached from More, so keep More lit there.
    match: (p) => p === "/more" || p.startsWith("/more/") || p === "/profile",
  },
];

export const ALL_TABS = [...TABS_LEFT, ...TABS_RIGHT];

/**
 * Screens that own the full viewport, where the bar would steal thumb room or
 * invite a mis-tap out of something half-finished.
 *
 * `/majors/fantasy/**` is in here deliberately: that section keeps its own bar
 * (app/majors/fantasy/layout.tsx) rather than stacking two.
 */
export function hidesMainNav(pathname: string): boolean {
  if (pathname === "/") return true; // redirects to /home; never paint a bar mid-hop
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return true;
  if (pathname.startsWith("/onboarding/")) return true;
  if (pathname.startsWith("/invite/")) return true;
  if (isFantasy(pathname)) return true;

  // Live scoring and the setup wizard, but NOT the /round list itself.
  if (/^\/round\/[^/]+/.test(pathname)) return true;

  // Full-page creation wizards and the odds inspector.
  if (pathname.endsWith("/create")) return true;
  if (pathname.endsWith("/inspector")) return true;

  return false;
}

/**
 * The long-press wheel. Lifted from the two hardcoded arrays that used to live in
 * HomeClient, now keyed on route so the options match the screen you are on.
 *
 * Anything unmapped falls back to the home set, so the wheel is never empty.
 */
const HOME_WHEEL: WheelItem[] = [
  { id: "round", label: "New Round", href: "/round" },
  { id: "history", label: "Round History", href: "/history" },
  { id: "stats", label: "Stats", href: "/stats" },
  { id: "courses", label: "Courses", href: "/courses" },
  { id: "calendar", label: "Calendar", href: "/calendar" },
];

// History merged into Schedule (fixtures + results), so this is four, not five.
const MAJORS_WHEEL: WheelItem[] = [
  { id: "majors-hub", label: "Majors Hub", href: "/majors" },
  { id: "schedule", label: "Schedule", href: "/majors/schedule" },
  { id: "fantasy", label: "Fantasy Picks", href: "/majors/fantasy" },
  { id: "majors-profile", label: "Profile", href: "/majors/profile" },
];

const STATS_WHEEL: WheelItem[] = [
  { id: "projections", label: "Projections", href: "/stats/projections" },
  { id: "course-records", label: "Course Records", href: "/stats/course-records" },
  { id: "hole-scoring", label: "Hole Scoring", href: "/stats/hole-scoring" },
  { id: "scoring-breakdown", label: "Scoring", href: "/stats/scoring-breakdown" },
  { id: "milestones", label: "Milestones", href: "/stats/milestones" },
  { id: "shot-tracking", label: "Shot Tracking", href: "/stats/shot-tracking" },
];

const MORE_WHEEL: WheelItem[] = [
  { id: "profile", label: "Profile", href: "/profile" },
  { id: "stats", label: "Stats", href: "/stats" },
  { id: "courses", label: "Courses", href: "/courses" },
  { id: "history", label: "Round History", href: "/history" },
  { id: "calculator", label: "Handicap Calc", href: "/more/handicap-calculator" },
  { id: "settings", label: "Settings", href: "/more/settings" },
];

/**
 * Which palette the app chrome should wear. The bottom bar and the body ground
 * are mounted outside every route subtree, so they can't inherit a section's
 * styling — AppFrame stamps this on <body> and globals.css does the repaint.
 */
export function sectionFor(pathname: string): "majors" | "default" {
  return isMajors(pathname) ? "majors" : "default";
}

export function wheelItemsFor(pathname: string): WheelItem[] {
  if (pathname === "/more" || pathname.startsWith("/more/") || pathname === "/profile") {
    return MORE_WHEEL;
  }
  if (pathname === "/stats" || pathname.startsWith("/stats/")) return STATS_WHEEL;
  if (isMajors(pathname)) return MAJORS_WHEEL;
  return HOME_WHEEL;
}
