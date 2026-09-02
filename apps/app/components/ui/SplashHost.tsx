"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { markSplashReady, subscribeSplashReady } from "@/lib/ui/splashReady";

/**
 * Cold-start splash.
 *
 * Mounted once from the root layout — deliberately OUTSIDE the route Suspense
 * boundary. That's the whole point: the previous implementation rendered the
 * logo twice (a `loading.tsx` fallback, then a second copy inside HomeClient),
 * so when the boundary resolved the growing node was destroyed and replaced by
 * a fresh one pinned at scale(0.35). The result was a snap backwards mid-grow,
 * a freeze until framer-motion had downloaded, then a pop to full size. A node
 * in the layout is untouched by the swap and is reused at hydration, so there
 * is nothing to hand off and nothing to resync.
 *
 * The animation is pure CSS for the same reason it exists at all: it plays on a
 * slow connection, which is exactly when React and framer-motion haven't
 * arrived yet. Every phase runs from the first painted frame with no JS.
 *
 * JS does only three things: hide the splash before paint on a repeat visit,
 * add the exit class when the data is ready, and unmount afterwards.
 */

// Kept in one place so the exit timeout can't drift from the CSS.
const EXIT_MS = 500;
// Never spin forever if the essential load wedges entirely.
const MAX_WAIT_MS = 10_000;

const SPLASH_CSS = `
@keyframes ciaga-grow  { from { scale: 0.35 } to { scale: 1 } }
@keyframes ciaga-pulse {
  0% { scale: 1 } 25% { scale: 1.12 } 50% { scale: 1 } 75% { scale: 1.08 } 100% { scale: 1 }
}
@keyframes ciaga-spinup    { from { rotate: 0deg }    to { rotate: 360deg } }
@keyframes ciaga-spin-fast { from { rotate: 360deg }  to { rotate: 1440deg } }
@keyframes ciaga-spin-slow { from { rotate: 1440deg } to { rotate: 2520deg } }
@keyframes ciaga-spin-idle { from { rotate: 2520deg } to { rotate: 2880deg } }

#ciaga-splash {
  position: fixed;
  inset: 0;
  z-index: 10000;
  /* Follows the chosen theme. The literal fallback matters: this stylesheet is
     inlined and can paint before globals.css has been applied, and the theme
     bootstrap script runs in the same tick — so the var is usually resolved,
     and Emerald Foil is the right answer when it isn't. */
  background-color: var(--ciaga-ground, #042713);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.35s ease 0.15s;
}

#ciaga-splash-inner {
  transition: scale 0.45s ease-in, opacity 0.45s ease-in;
}

/* 'scale' and 'rotate' are independent CSS properties, so the scale track and
   the rotate track compose instead of clobbering each other the way two
   'transform' animations would. A delayed animation with 'forwards' (not
   'backwards') doesn't apply during its delay, so each rotate phase takes over
   exactly when it starts and the previous phase's fill holds until then.
   2520 % 360 === 0, so the idle loop boundary is seamless. */
#ciaga-splash-logo {
  scale: 0.35;
  animation:
    ciaga-grow      0.45s ease-out    forwards,
    ciaga-pulse     0.95s ease-in-out 0.45s,
    ciaga-spinup    0.65s ease-in     1.4s  forwards,
    ciaga-spin-fast 1.05s linear      2.05s forwards,
    ciaga-spin-slow 2.5s  ease-out    3.1s  forwards,
    ciaga-spin-idle 2.5s  linear      5.6s  infinite;
}

.ciaga-splash-exit #ciaga-splash       { opacity: 0 }
.ciaga-splash-exit #ciaga-splash-inner { scale: 0.12; opacity: 0 }

/* Repeat visit this session: hidden before it can paint. */
html[data-splash="shown"] #ciaga-splash { display: none }

@media (prefers-reduced-motion: reduce) {
  #ciaga-splash-logo { scale: 1; animation: none }
  #ciaga-splash-inner { transition: opacity 0.3s ease }
  .ciaga-splash-exit #ciaga-splash-inner { scale: 1 }
}
`;

// Runs during parse, before the overlay below it is painted — so a returning
// user never sees a frame of it. Mirrors the sessionStorage flag set on exit.
const PRE_PAINT_SCRIPT = `try{if(sessionStorage.getItem("splash_shown")==="1")document.documentElement.dataset.splash="shown"}catch(e){}`;

export function SplashHost() {
  const pathname = usePathname();
  const [done, setDone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const exitingRef = useRef(false);

  // Repeat visit — drop it from the tree. CSS has already hidden it, so this
  // only tidies up; it runs before paint either way.
  useLayoutEffect(() => {
    try {
      if (sessionStorage.getItem("splash_shown") === "1") setDone(true);
    } catch {
      // sessionStorage unavailable (private mode) — just play the splash.
    }
  }, []);

  // Home publishes readiness once the essential player info is on screen.
  // Every other route has its own loading.tsx, so the splash has done its job
  // as soon as we're hydrated — a cold start into a deep link (e.g. from a push
  // notification) shouldn't sit here waiting on data it isn't gating.
  useEffect(() => {
    if (pathname !== "/home") markSplashReady();
  }, [pathname]);

  useEffect(() => {
    if (done) return;

    let unmountTimer: ReturnType<typeof setTimeout> | null = null;

    const runExit = () => {
      if (exitingRef.current) return;
      exitingRef.current = true;

      // The class goes on <html> so both the backdrop and the exit wrapper can
      // transition while the logo keeps its own animation running underneath.
      document.documentElement.classList.add("ciaga-splash-exit");

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        // Written at the END of the exit, not the start: HomeClient reads this
        // flag to decide whether the splash is still on screen, and modals must
        // not open behind a fading overlay.
        try {
          sessionStorage.setItem("splash_shown", "1");
        } catch {
          // ignore
        }
        document.documentElement.classList.remove("ciaga-splash-exit");
        setDone(true);
        window.dispatchEvent(new CustomEvent("splash:done"));
      };

      // transitionend is the accurate signal; the timer covers the case where
      // it never fires (reduced motion, backgrounded tab, interrupted transition).
      const onEnd = (e: TransitionEvent) => {
        if (e.target !== rootRef.current) return;
        rootRef.current?.removeEventListener("transitionend", onEnd);
        if (unmountTimer) clearTimeout(unmountTimer);
        finish();
      };
      rootRef.current?.addEventListener("transitionend", onEnd);
      unmountTimer = setTimeout(finish, EXIT_MS + 100);
    };

    const unsubscribe = subscribeSplashReady(runExit);
    const safetyTimer = setTimeout(markSplashReady, MAX_WAIT_MS);

    return () => {
      unsubscribe();
      clearTimeout(safetyTimer);
      if (unmountTimer) clearTimeout(unmountTimer);
    };
  }, [done]);

  if (done) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SPLASH_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} />
      <div id="ciaga-splash" ref={rootRef} aria-hidden>
        <div id="ciaga-splash-inner">
          {/* next/image, not a raw <img>: it still renders a plain <img> into
              the SSR HTML (so it paints pre-hydration) but serves an optimised
              WebP instead of the 951 KB original, emits its own preload link,
              and shares one URL with the copies HomeClient renders — a cold
              start used to fetch this artwork twice. */}
          <Image
            id="ciaga-splash-logo"
            src="/ciaga-logo.png"
            alt="CIAGA"
            width={176}
            height={176}
            className="rounded-full"
            priority
          />
        </div>
      </div>
    </>
  );
}
