"use client";

import { useRef, useState, useCallback, useLayoutEffect } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { AuthUser } from "@/components/ui/auth-user";

type MenuItem = { id: string; label: string };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

type MajorsViewProps = {
  open: boolean;
  setOpen: (fn: (prev: boolean) => boolean) => void;
  goToHome: () => void;
  majorsMenuItems: MenuItem[];
  handleMajorsSelect: (id: string) => void;
  renderRadialMenu: (items: MenuItem[], onSelect: (id: string) => void) => React.ReactNode;
  vh: number;
};

export function MajorsView({
  open,
  setOpen,
  goToHome,
  majorsMenuItems,
  handleMajorsSelect,
  renderRadialMenu,
  vh,
}: MajorsViewProps) {
  const majorsHeaderAnchorRef = useRef<HTMLDivElement | null>(null);
  const [majorsClosedY, setMajorsClosedY] = useState<number | null>(null);
  const [majorsFallbackY, setMajorsFallbackY] = useState<number>(-200);
  const majorsNudge = clamp(vh * 0.018, 8, 20);

  const computeMajorsClosedY = useCallback(() => {
    const el = majorsHeaderAnchorRef.current;
    if (!el || typeof window === "undefined") return;

    const rect = el.getBoundingClientRect();
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height === 0) return;

    const anchorCenterY = rect.top + rect.height / 2;
    const viewportCenterY = (window.visualViewport?.height ?? window.innerHeight) / 2;

    const y = anchorCenterY - viewportCenterY;
    if (Number.isFinite(y)) setMajorsClosedY(y);
  }, []);

  useLayoutEffect(() => {
    setMajorsClosedY(null);

    const h = window.visualViewport?.height ?? window.innerHeight;
    setMajorsFallbackY(-(h / 2) + h * 0.09);

    const el = majorsHeaderAnchorRef.current;
    if (!el) return;

    const run = () => computeMajorsClosedY();

    const raf = requestAnimationFrame(() => requestAnimationFrame(run));
    const t1 = window.setTimeout(run, 50);
    const t2 = window.setTimeout(run, 200);

    const onResize = () => run();
    window.addEventListener("resize", onResize);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", onResize);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => run());
      ro.observe(el);
    }

    (document as any)?.fonts?.ready?.then?.(() => run());

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onResize);
    };
  }, [computeMajorsClosedY]);

  return (
    <motion.div
      key="majors"
      className="min-h-screen bg-[#042713] text-slate-100 flex flex-col items-center pb-[env(safe-area-inset-bottom)] pt-8 px-4 overflow-visible"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.22 }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 160 }}
      dragElastic={0.2}
      onDragEnd={(_, info) => {
        if (info.offset.y > 80 || info.velocity.y > 500) {
          goToHome();
        }
      }}
    >
      <header className="w-full max-w-sm flex items-center justify-between relative z-50 overflow-visible">
        <div className="h-10 w-[132px]" />

        <div
          ref={majorsHeaderAnchorRef}
          className="absolute left-1/2 top-1/2 z-0"
          style={{
            width: 80,
            height: 80,
            opacity: 0,
            pointerEvents: "none",
            transform: `translate(-50%, -50%) translateY(${majorsNudge}px)`,
          }}
        />

        <div className="relative z-50 overflow-visible pointer-events-auto scale-[1.4] origin-top-right -translate-y-[4px]">
          <AuthUser />
        </div>
      </header>

      <div className="relative flex-1 w-full max-w-sm">
        {renderRadialMenu(majorsMenuItems, handleMajorsSelect)}

        <motion.div
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 flex flex-col items-center"
          initial={false}
          animate={{
            y: open ? 0 : majorsClosedY ?? majorsFallbackY,
            opacity: 1,
          }}
          transition={{ type: "spring", stiffness: 180, damping: 18 }}
        >
          <motion.button
            className="h-20 w-20 rounded-full bg-transparent grid place-items-center"
            onClick={() => setOpen((prev) => !prev)}
            whileTap={{ scale: 0.92 }}
            initial={false}
            animate={{ rotate: open ? 360 : 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 18 }}
          >
            <motion.div
              className="h-[72px] w-[72px] rounded-full overflow-hidden flex items-center justify-center"
              animate={{ scale: open ? 1.05 : 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 18 }}
            >
              <Image src="/ciaga-logo.png" alt="CIAGA logo" width={72} height={72} className="object-contain" />
            </motion.div>
          </motion.button>

          <div className="mt-2 text-xs tracking-[0.18em] uppercase text-emerald-200/80">Majors</div>
        </motion.div>

        <motion.div
          className="w-full mt-24 space-y-3"
          initial={false}
          animate={{
            opacity: open ? 0.25 : 1,
            scale: open ? 0.995 : 1,
          }}
          transition={{ duration: 0.18 }}
          style={{
            filter: open ? "blur(2px)" : "blur(0px)",
            pointerEvents: open ? "none" : "auto",
          }}
        >
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
            <h2 className="text-sm font-semibold text-emerald-50 mb-1">Season Majors</h2>
            <p className="text-[11px] text-emerald-100/80">
              Four flagship events with FedEx-style points. Swipe down to return home. Later we'll wire in live standings and odds.
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-emerald-50">Major 1 · Spring</span>
              <span className="text-emerald-200/80">Coming soon</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-emerald-100/80">
              <span>Course: TBD</span>
              <span>Points: —</span>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-emerald-50">Major 2 · Summer</span>
              <span className="text-emerald-200/80">Coming soon</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-emerald-100/80">
              <span>Course: TBD</span>
              <span>Points: —</span>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
