"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BottomNav } from "./BottomNav";
import { hidesMainNav, sectionFor } from "./navConfig";
import { THEME_EVENT } from "@/lib/theme/themes";

/**
 * Mounts the bottom nav, reserves room for it, and tells the chrome which
 * section it's in.
 *
 * One wrapper here covers every `min-h-screen` page in the app, which is the same
 * trick the Fantasy section's layout already used. Screens that hard-pin to the
 * viewport height with their own inner scroller subtract `--ciaga-nav-h`
 * themselves — a parent's padding can't help those.
 *
 * `children` is passed through as a prop, so the pages inside stay server
 * components despite this boundary.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const hidden = hidesMainNav(pathname);
  const section = sectionFor(pathname);

  // Bumped whenever the theme changes, purely to re-run the effect below —
  // the ground is read off computed style, so it has to be read again once the
  // tokens have been repointed.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const bump = () => setThemeTick((n) => n + 1);
    window.addEventListener(THEME_EVENT, bump);
    return () => window.removeEventListener(THEME_EVENT, bump);
  }, []);

  /**
   * Two pieces of chrome sit outside every route subtree and so can't be
   * restyled by a section's own layout:
   *
   *   - the body background, which shows through around the floating bar and
   *     anywhere a page is shorter than the viewport;
   *   - the status bar in an installed PWA, which takes its colour from the
   *     theme-color meta tag.
   *
   * Both are repainted here. globals.css holds the palettes; this only says
   * which one is in force.
   */
  useEffect(() => {
    document.body.dataset.section = section;

    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;

    // Read the resolved token rather than duplicating hex values here.
    const ground = getComputedStyle(document.body).getPropertyValue("--ciaga-ground").trim();
    if (!ground) return;

    const apply = () => {
      if (meta.getAttribute("content") !== ground) meta.setAttribute("content", ground);
    };
    apply();

    // Next owns this tag through the `viewport` export and rewrites it after we
    // do, which silently reverted the status bar to the app green. Watch it and
    // re-assert; the guard above stops the observer from seeing its own write.
    const observer = new MutationObserver(apply);
    observer.observe(meta, { attributes: true, attributeFilter: ["content"] });
    return () => observer.disconnect();
  }, [section, themeTick]);

  return (
    <>
      <div
        className={
          hidden ? undefined : "pb-[calc(env(safe-area-inset-bottom)+var(--ciaga-nav-h))]"
        }
      >
        {children}
      </div>
      <BottomNav />
    </>
  );
}
