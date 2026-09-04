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

export type ThemeId = "default" | "dark" | "claret" | "light" | "sky";

/**
 * Themes were first shipped under their design names. Anyone carrying one of
 * those in localStorage is mapped forward rather than reset to the default.
 */
const RENAMED: Record<string, ThemeId> = {
  emerald: "default",
  night: "dark",
  linen: "light",
};

export type Theme = {
  id: ThemeId;
  name: string;
  blurb: string;
  /** Drives `color-scheme`, and tells the picker how to group them. */
  scheme: "dark" | "light";
  /** Ground, surface, accent — drawn as a three-band chip in the picker. */
  swatch: [string, string, string];
  /** The same three for the Majors section, so the picker shows both rooms. */
  majorsSwatch: [string, string, string];
  /** Ground colour, used for the PWA status bar before CSS has resolved. */
  ground: string;
};

export const DEFAULT_THEME: ThemeId = "default";

export const THEMES: Theme[] = [
  {
    id: "default",
    name: "Default",
    blurb: "Bottle green and gold. Majors goes mint on near-black.",
    scheme: "dark",
    swatch: ["#042713", "#0a3520", "#f5e6b0"],
    majorsSwatch: ["#01100A", "#06301e", "#7CF0BE"],
    ground: "#042713",
  },
  {
    id: "dark",
    name: "Dark",
    blurb: "Neutral near-black with one mint accent. Majors goes bone on black.",
    scheme: "dark",
    swatch: ["#0A0D0B", "#141917", "#6EE7B7"],
    majorsSwatch: ["#050605", "#0F110F", "#E8E4D6"],
    ground: "#0A0D0B",
  },
  {
    id: "claret",
    name: "Claret",
    blurb: "The jug, not the fairway. Majors goes oxblood and silver.",
    scheme: "dark",
    swatch: ["#2A0E16", "#3A141F", "#F0D6A8"],
    majorsSwatch: ["#150409", "#230810", "#D8DCE0"],
    ground: "#2A0E16",
  },
  {
    id: "light",
    name: "Light",
    blurb: "Ink on warm paper, brass figures. Majors goes green on green.",
    scheme: "light",
    swatch: ["#F2F0E7", "#FFFFFF", "#7A5C12"],
    majorsSwatch: ["#E4EDE6", "#FFFFFF", "#075E3C"],
    ground: "#F2F0E7",
  },
  {
    id: "sky",
    name: "Sky",
    blurb: "The other kind of good day — cool blue and azure. Majors goes navy.",
    scheme: "light",
    swatch: ["#EDF3FA", "#FFFFFF", "#1D5FA8"],
    majorsSwatch: ["#DCE7F5", "#FFFFFF", "#123A6B"],
    ground: "#EDF3FA",
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
    const v = window.localStorage.getItem(THEME_STORAGE_KEY) ?? "";
    if ((THEME_IDS as string[]).includes(v)) return v as ThemeId;
    return RENAMED[v] ?? DEFAULT_THEME;
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
)});var ok=${JSON.stringify(THEME_IDS)};var ren=${JSON.stringify(
  RENAMED
)};document.documentElement.dataset.theme=ok.indexOf(t)>-1?t:(ren[t]||${JSON.stringify(
  DEFAULT_THEME
)});}catch(e){document.documentElement.dataset.theme=${JSON.stringify(
  DEFAULT_THEME
)};}})();`;
