"use client";

import Image from "next/image";
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AuthUser } from "@/components/ui/auth-user";

type MenuItem = { id: string; label: string };

const homeMenuItems: MenuItem[] = [
  { id: "round", label: "New Round" },
  { id: "history", label: "Round History" },
  { id: "stats", label: "Stats" },
  { id: "social", label: "Social" },
  { id: "courses", label: "Courses" },
];

const majorsMenuItems: MenuItem[] = [
  { id: "majors-hub", label: "Majors Hub" },
  { id: "schedule", label: "Schedule" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "history", label: "History" },
  { id: "profile", label: "Majors Profile" },
];

type ViewMode = "home" | "majors";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export default function CIAGAStarter() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("home");

  // viewport-driven layout values
  const [vw, setVw] = useState(390);
  const [vh, setVh] = useState(844);

  useEffect(() => {
    const updateViewport = () => {
      if (typeof window === "undefined") return;
      const w = window.visualViewport?.width ?? window.innerWidth;
      const h = window.visualViewport?.height ?? window.innerHeight;
      setVw(w);
      setVh(h);
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", updateViewport);
    vv?.addEventListener("scroll", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      vv?.removeEventListener("resize", updateViewport);
      vv?.removeEventListener("scroll", updateViewport);
    };
  }, []);

  // Home closed offset (device-relative)
  const closedOffset = clamp(vh * 0.28, 170, 260);

  const goToMajors = () => {
    setOpen(false);
    setView("majors");
  };

  const goToHome = () => {
    setOpen(false);
    setView("home");
  };

  // ✅ WIRED: Home menu routes (including Courses)
  const handleHomeSelect = (id: string) => {
    setOpen(false);

    if (id === "courses") {
      router.push("/courses");
      return;
    }

    if (id === "round") {
      router.push("/round");
      return;
    }

    if (id === "history") {
      router.push("/history");
      return;
    }

    if (id === "stats") {
      router.push("/stats");
      return;
    }

    if (id === "social") {
      router.push("/social");
      return;
    }

    // If you later re-add "majors" to home wheel:
    // if (id === "majors") goToMajors();
  };

  // ✅ OPTIONAL WIRED: Majors menu routes (edit paths to your liking)
  const handleMajorsSelect = (id: string) => {
    setOpen(false);

    if (id === "majors-hub") {
      router.push("/majors");
      return;
    }
    if (id === "schedule") {
      router.push("/majors/schedule");
      return;
    }
    if (id === "leaderboard") {
      router.push("/majors/leaderboard");
      return;
    }
    if (id === "history") {
      router.push("/majors/history");
      return;
    }
    if (id === "profile") {
      router.push("/majors/profile");
      return;
    }
  };

  /**
   * Dynamic radial positions based on screen size.
   */
  const wheelRadius = clamp(Math.min(vw, vh) * 0.38, 115, 170);
  const wheelSide = clamp(wheelRadius * 0.85, 90, 120);

  const wheelPositions = [
    { x: 0, y: -wheelRadius },
    { x: wheelSide, y: -wheelRadius * 0.38 },
    { x: wheelSide * 0.82, y: wheelRadius * 0.54 },
    { x: -wheelSide * 0.82, y: wheelRadius * 0.54 },
    { x: -wheelSide, y: -wheelRadius * 0.38 },
  ];

  const renderRadialMenu = (items: MenuItem[], onSelect: (id: string) => void) => (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 backdrop-blur-md z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />

          {/* Wheel items */}
          {items.map((item, index) => {
            const pos = wheelPositions[index] ?? { x: 0, y: 0 };

            return (
              <motion.button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto z-20 flex items-center justify-center rounded-full border border-emerald-200/70 bg-[#0b3b21]/95 px-4 py-2 shadow-lg text-xs font-medium tracking-wide"
                initial={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
                animate={{ opacity: 1, scale: 1, x: pos.x, y: pos.y }}
                exit={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
                transition={{
                  type: "spring",
                  stiffness: 260,
                  damping: 20,
                  delay: 0.05 * index,
                }}
              >
                {item.label}
              </motion.button>
            );
          })}
        </>
      )}
    </AnimatePresence>
  );

  /**
   * Majors CLOSED position measurement
   */
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
    if (view !== "majors") return;

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
  }, [view, computeMajorsClosedY]);

  return (
    <AnimatePresence initial={false} mode="wait">
      {view === "home" ? (
        <motion.div
          key="home"
          className="min-h-screen bg-[#042713] text-slate-100 flex flex-col items-center justify-between pb-[env(safe-area-inset-bottom)] pt-8 px-4 overflow-hidden"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.22 }}
          drag="y"
          dragConstraints={{ top: -160, bottom: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.y < -80 || info.velocity.y < -500) {
              goToMajors();
            }
          }}
        >
          {/* HEADER */}
          <header className="w-full max-w-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[#0a341c]/70 backdrop-blur-sm border border-[#0a341c]/40 grid place-items-center">
                <Image
                  src="/ciaga-logo.png"
                  alt="CIAGA logo"
                  width={40}
                  height={40}
                  className="object-contain rounded-full"
                />
              </div>

              <div className="flex flex-col leading-tight">
                <span className="text-lg font-semibold tracking-wide text-[#f5e6b0]">CIAGA</span>
                <span className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                  Est. 2025
                </span>
              </div>
            </div>

            <div className="scale-[1.4] origin-top-right -translate-y-[4px]">
              <AuthUser />
            </div>
          </header>

          <p className="mt-4 text-sm text-emerald-100/80 text-center max-w-xs">
            Tap the CIAGA button to explore. Swipe up anywhere to open Majors.
          </p>

          <div className="relative flex-1 w-full max-w-sm">
            {renderRadialMenu(homeMenuItems, handleHomeSelect)}

            <motion.div
              layoutId="ciaga-main-group"
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-20 w-20 grid place-items-center z-30"
              initial={false}
              animate={{ y: open ? 0 : closedOffset }}
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
                  <Image
                    src="/ciaga-logo.png"
                    alt="CIAGA logo"
                    width={72}
                    height={72}
                    className="object-contain"
                  />
                </motion.div>
              </motion.button>
            </motion.div>
          </div>

          <footer className="mt-4 text-[10px] text-emerald-100/60 text-center">
            Tap to explore. Swipe up for Majors.
          </footer>
        </motion.div>
      ) : (
        <motion.div
          key="majors"
          // ✅ IMPORTANT: overflow-visible so the top-right dropdown can't be clipped
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
          {/* ✅ IMPORTANT: z-50 + overflow-visible so AuthUser dropdown stays above backdrop */}
          <header className="w-full max-w-sm flex items-center justify-between relative z-50 overflow-visible">
            <div className="h-10 w-[132px]" />

            {/* Anchor used for measurement (nudge is device-relative) */}
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

            {/* ✅ IMPORTANT: keep AuthUser on its own top layer */}
            <div className="relative z-50 overflow-visible pointer-events-auto scale-[1.4] origin-top-right -translate-y-[4px]">
              <AuthUser />
            </div>
          </header>

          <div className="relative flex-1 w-full max-w-sm">
            {renderRadialMenu(majorsMenuItems, handleMajorsSelect)}

            <motion.div
              layoutId="ciaga-main-group"
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
                  <Image
                    src="/ciaga-logo.png"
                    alt="CIAGA logo"
                    width={72}
                    height={72}
                    className="object-contain"
                  />
                </motion.div>
              </motion.button>

              <div className="mt-2 text-xs tracking-[0.18em] uppercase text-emerald-200/80">
                Majors
              </div>
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
                  Four flagship events with FedEx-style points. Swipe down to return home. Later we’ll
                  wire in live standings and odds.
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
      )}
    </AnimatePresence>
  );
}
