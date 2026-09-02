/**
 * The themes the app offers, and how a choice is stored and applied.
 *
 * A theme is nothing but a redefinition of the `--sec-*` and `--nav-*` tokens
 * in globals.css — see the THEMES block there. This module holds the registry
 * the picker renders and the client-side plumbing that stamps the choice onto
 * <html>; no component needs to know a theme exists beyond that.
 *
 * Coverage: a theme reaches every screen built from components/ui/chrome.tsx.
 * Leaf pages that still carry colour literals — the scorecard, the Majors group
 * and event clients, the social feed items — do not follow yet, which matters
 * most for the light theme. The settings screen says so rather than pretending
 * otherwise.
 */

export type ThemeId = "emerald" | "night" | "claret" | "linen";

export type Theme = {
  id: ThemeId;
  name: string;
  blurb: string;
  /** Drives `color-scheme`, and tells the picker how to group them. */
  scheme: "dark" | "light";
  /** Ground, surface, accent — drawn as a three-band chip in the picker. */
  swatch: [string, string, string];
  /** Ground colour, used for the PWA status bar before CSS has resolved. */
  ground: string;
};

export const DEFAULT_THEME: ThemeId = "emerald";

export const THEMES: Theme[] = [
  {
    id: "emerald",
    name: "Emerald Foil",
    blurb: "Bottle green and gold. Majors goes cold — mint on near-black.",
    scheme: "dark",
    swatch: ["#042713", "#0a3520", "#f5e6b0"],
    ground: "#042713",
  },
  {
    id: "night",
    name: "Night Course",
    blurb: "Neutral near-black with a single mint accent. Majors goes bone.",
    scheme: "dark",
    swatch: ["#0A0D0B", "#141917", "#6EE7B7"],
    ground: "#0A0D0B",
  },
  {
    id: "claret",
    name: "Claret",
    blurb: "The jug, not the fairway — deep burgundy and cream.",
    scheme: "dark",
    swatch: ["#2A0E16", "#3A141F", "#F0D6A8"],
    ground: "#2A0E16",
  },
  {
    id: "linen",
    name: "Linen",
    blurb: "Daylight. Ink on warm paper, brass figures, the bar stays green.",
    scheme: "light",
    swatch: ["#F2F0E7", "#FFFFFF", "#7A5C12"],
    ground: "#F2F0E7",
  },
];

export const THEME_IDS = THEMES.map((t) => t.id);

export function themeById(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** localStorage key. Read by the pre-paint script in the root layout too. */
export const THEME_STORAGE_KEY = "ciaga:theme";

/** Fires on <window> whenever the theme changes, so listeners can re-read tokens. */
export const THEME_EVENT = "ciaga:theme";

export function readStoredTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return (THEME_IDS as string[]).includes(v ?? "") ? (v as ThemeId) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Applies a theme and remembers it. The attribute goes on <html> rather than
 * <body> so the pre-paint script can set it before React exists, and so the CSS
 * can out-specify `body[data-section="majors"]` without `!important`.
 */
export function applyTheme(id: ThemeId) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = id;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Private mode, or storage disabled. The theme still applies for this visit.
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: id }));
}

/**
 * The script inlined in <head>. It runs before first paint, so switching theme
 * doesn't flash the default palette on every cold start — which is exactly the
 * bug the splash work went to some trouble to avoid.
 *
 * Kept as a string on purpose: it must not depend on the bundle having loaded.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});var ok=${JSON.stringify(THEME_IDS)};document.documentElement.dataset.theme=ok.indexOf(t)>-1?t:${JSON.stringify(
  DEFAULT_THEME
)};}catch(e){document.documentElement.dataset.theme=${JSON.stringify(
  DEFAULT_THEME
)};}})();`;
