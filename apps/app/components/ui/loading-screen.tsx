"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";

interface Props {
  isReady: boolean;
  onDone?: () => void;
}

// Duration (ms) of the CSS grow animation in loading.tsx — must stay in sync.
const GROW_MS = 450;

export function LoadingScreen({ isReady, onDone }: Props) {
  const [done, setDone] = useState(false);
  const isReadyRef = useRef(isReady);
  const logoRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isReadyRef.current = isReady;
  }, [isReady]);

  useEffect(() => {
    let cancelled = false;

    // How far along is the CSS grow animation that loading.tsx started?
    // performance.now() is ms since navigation — same clock the CSS animation uses.
    const elapsed = performance.now();
    const growDone = elapsed >= GROW_MS;
    // Interpolate to match the CSS animation's current position so there's no jump.
    const startScale = growDone ? 1 : 0.35 + (elapsed / GROW_MS) * 0.65;
    const remainingGrow = growDone ? 0 : (GROW_MS - elapsed) / 1000;

    const waitUntilReady = () =>
      new Promise<void>((resolve) => {
        if (isReadyRef.current) { resolve(); return; }
        const check = () => {
          if (isReadyRef.current || cancelled) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });

    // Accept captured refs as params to avoid unsafe ! assertions on potentially-stale ref values.
    const doExit = async (logo: HTMLElement, bg: HTMLElement) => {
      animate(logo, { scale: 0.12, opacity: 0 }, { duration: 0.45, ease: "easeIn" });
      await animate(bg, { opacity: 0 }, { duration: 0.35, delay: 0.15 });
      if (!cancelled) {
        sessionStorage.setItem("splash_shown", "1");
        setDone(true);
        onDone?.();
      }
    };

    const run = async () => {
      const logo = logoRef.current;
      const bg = bgRef.current;
      if (!logo || !bg) return;

      // Snap the logo to the interpolated CSS animation position immediately (before first paint
      // of this component). The render always uses scale(0.35) for SSR safety; we correct it here.
      logo.style.transform = `scale(${startScale})`;

      // Finish the grow phase — either skip it (CSS already done) or complete the remainder.
      if (remainingGrow > 0) {
        await animate(logo, { scale: [startScale, 1] }, { duration: remainingGrow, ease: "easeOut" });
        if (cancelled) return;
      }

      // Early exit: data arrived during the grow phase.
      if (isReadyRef.current) { await doExit(logo, bg); return; }

      // Pulse twice.
      await animate(logo, { scale: [1, 1.12, 1, 1.08, 1] }, { duration: 0.95, ease: "easeInOut" });
      if (cancelled) return;

      // Early exit: data arrived during pulse.
      if (isReadyRef.current) { await doExit(logo, bg); return; }

      // Spin 360°.
      await animate(logo, { rotate: 360 }, { duration: 0.65, ease: "easeInOut" });
      if (cancelled) return;

      // Early exit: data arrived during spin.
      if (isReadyRef.current) { await doExit(logo, bg); return; }

      // Hold in a slow spin until auth/data is ready.
      const waitSpin = animate(
        logo,
        { rotate: [360, 720] },
        { duration: 2.5, ease: "linear", repeat: Infinity, repeatType: "loop" },
      );
      await waitUntilReady();
      waitSpin.stop();
      if (cancelled) return;

      await doExit(logo, bg);
    };

    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (done) return null;

  return (
    <div className="fixed inset-0 z-[10000]">
      <div ref={bgRef} className="absolute inset-0 bg-[#042713]" />
      <div className="absolute inset-0 flex items-center justify-center">
        {/* scale(0.35) is the SSR-safe initial value; the effect corrects it to the interpolated
            CSS animation position before the first animation frame runs. */}
        <div ref={logoRef} style={{ transform: "scale(0.35)" }}>
          <Image
            src="/ciaga-logo.png"
            alt="CIAGA"
            width={176}
            height={176}
            className="rounded-full"
            priority
          />
        </div>
      </div>
    </div>
  );
}
