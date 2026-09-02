"use client";

import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  DEFAULT_THEME,
  readStoredTheme,
  THEME_EVENT,
  type ThemeId,
} from "@/lib/theme/themes";

/**
 * The active theme, and a setter that persists it.
 *
 * The initial state is the default rather than the stored value: the server
 * renders this page, and seeding from localStorage on the first client render
 * would be a hydration mismatch. The real value lands in a layout effect, which
 * runs before paint — and the inline bootstrap script in the root layout has
 * already stamped the attribute anyway, so nothing visibly changes.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    setThemeState(readStoredTheme());

    const onChange = (e: Event) => {
      const id = (e as CustomEvent<ThemeId>).detail;
      if (id) setThemeState(id);
    };
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    applyTheme(id);
    setThemeState(id);
  }, []);

  return { theme, setTheme };
}
