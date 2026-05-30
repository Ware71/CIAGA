"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";

interface Props {
  isReady: boolean;
  onDone?: () => void;
}

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

    const waitUntilReady = () =>
      new Promise<void>((resolve) => {
        if (isReadyRef.current) { resolve(); return; }
        const check = () => {
          if (isReadyRef.current || cancelled) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });

    const run = async () => {
      const logo = logoRef.current;
      const bg = bgRef.current;
      if (!logo || !bg) return;

      // grow into shot
      await animate(logo, { scale: [0.35, 1] }, { duration: 0.45, ease: "easeOut" });
      if (cancelled) return;

      // pulse twice
      await animate(logo, { scale: [1, 1.12, 1, 1.08, 1] }, { duration: 0.95, ease: "easeInOut" });
      if (cancelled) return;

      // spin
      await animate(logo, { rotate: 360 }, { duration: 0.65, ease: "easeInOut" });
      if (cancelled) return;

      // spin slowly while waiting for connection / auth
      const waitSpin = animate(logo, { rotate: [360, 720] }, { duration: 2.5, ease: "linear", repeat: Infinity, repeatType: "loop" });

      // hold until auth is ready
      await waitUntilReady();
      waitSpin.stop();
      if (cancelled) return;

      // shrink and fade out logo, then fade background
      animate(logo, { scale: 0.12, opacity: 0 }, { duration: 0.45, ease: "easeIn" });
      await animate(bg, { opacity: 0 }, { duration: 0.35, delay: 0.15 });

      if (!cancelled) {
        sessionStorage.setItem("splash_shown", "1");
        setDone(true);
        onDone?.();
      }
    };

    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (done) return null;

  return (
    <div className="fixed inset-0 z-[10000]">
      <div ref={bgRef} className="absolute inset-0 bg-[#040d06]" />
      <div className="absolute inset-0 flex items-center justify-center">
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
