'use client';

import Image from "next/image";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AuthUser } from "@/components/ui/auth-user";

type MenuItem = { id: string; label: string };

const homeMenuItems: MenuItem[] = [
  { id: "round", label: "New Round" },
  { id: "majors", label: "Majors" },
  { id: "stats", label: "Stats" },
  { id: "courses", label: "Courses" },
  { id: "profile", label: "Profile" },
];

const majorsMenuItems: MenuItem[] = [
  { id: "majors-hub", label: "Majors Hub" },
  { id: "schedule", label: "Schedule" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "history", label: "History" },
  { id: "profile", label: "Profile" },
];

type ViewMode = "home" | "majors";

export default function CIAGAStarter() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("home");

  // Dynamic distance from the centre (based on screen height)
  const [closedOffset, setClosedOffset] = useState(210);

  useEffect(() => {
    const computeOffset = () => {
      if (typeof window === "undefined") return;
      const h = window.innerHeight;
      const offset = Math.min(260, Math.max(170, h * 0.28));
      setClosedOffset(offset);
    };

    computeOffset();
    window.addEventListener("resize", computeOffset);
    return () => window.removeEventListener("resize", computeOffset);
  }, []);

  // Majors: use the same offset, but a bit smaller so it doesn't hit the notch.
  // This stays dynamic because it's derived from closedOffset.
  const majorsClosedOffset = closedOffset * 0.4; // tweak 0.6–0.8 if needed

  const goToMajors = () => {
    setOpen(false);
    setView("majors");
  };

  const goToHome = () => {
    setOpen(false);
    setView("home");
  };

  const handleHomeSelect = (id: string) => {
    console.log("Home menu selected:", id);
    if (id === "majors") goToMajors();
  };

  const handleMajorsSelect = (id: string) => {
    console.log("Majors menu selected:", id);
  };

  // Shared radial menu – centred; blur covers the whole container we render it in
  const renderRadialMenu = (items: MenuItem[], onSelect: (id: string) => void) => (
    <AnimatePresence>
      {open && (
        <>
          {/* Blur overlay relative to the container we're inside */}
          <motion.div
            className="absolute inset-0 rounded-[32px] backdrop-blur-md z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {items.map((item, index) => {
            const positions = [
              { x: 0, y: -130 },
              { x: 110, y: -50 },
              { x: 90, y: 70 },
              { x: -90, y: 70 },
              { x: -110, y: -50 },
            ];
            const pos = positions[index];

            return (
              <motion.button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto z-20 flex items-center justify-center rounded-full border border-emerald-200/70 bg-[#0b3b21]/95 px-4 py-2 shadow-lg text-xs font-medium tracking-wide"
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
                <span className="text-lg font-semibold tracking-wide text-[#f5e6b0]">
                  CIAGA
                </span>
                <span className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                  Est. 2025
                </span>
              </div>
            </div>

            <AuthUser />
          </header>

          {/* Subheading */}
          <p className="mt-4 text-sm text-emerald-100/80 text-center max-w-xs">
            Tap the CIAGA button to explore. Swipe up anywhere to open Majors.
          </p>

          {/* HOME – wheel + blur area */}
          <div className="relative flex-1 w-full max-w-sm flex items-center justify-center">
            {renderRadialMenu(homeMenuItems, handleHomeSelect)}

            <motion.div
              layoutId="ciaga-main-group"
              className="relative h-20 w-20 grid place-items-center z-30"
              initial={false}
              animate={{
                y: open ? 0 : closedOffset, // bottom when closed, centre when open
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
            </motion.div>
          </div>

          <footer className="mt-4 text-[10px] text-emerald-100/60 text-center">
            Tap to explore. Swipe up for Majors.
          </footer>
        </motion.div>
      ) : (
        <motion.div
          key="majors"
          className="min-h-screen bg-[#042713] text-slate-100 flex flex-col items-center pt-8 px-4 pb-[env(safe-area-inset-bottom)] overflow-hidden"
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
          {/* HEADER */}
          <header className="w-full max-w-sm flex items-center justify-end mb-2">
            <AuthUser />
          </header>

          {/* MAJORS – everything central (wheel + cards) lives in this relative container */}
          <div className="relative flex-1 w-full max-w-sm flex flex-col items-center mt-2">
            {/* Blur + wheel now cover BOTH CIAGA + cards */}
            {renderRadialMenu(majorsMenuItems, handleMajorsSelect)}

            {/* CIAGA + "Majors" – top when closed, centre when open */}
            <div className="relative w-full h-[220px] flex items-center justify-center">
              <motion.div
                layoutId="ciaga-main-group"
                className="flex flex-col items-center z-30"
                initial={false}
                animate={{
                  y: open ? 0 : -majorsClosedOffset,
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
            </div>

            {/* CARDS – higher up, directly under the button; blurred by the same overlay */}
            <div className="relative w-full mt-0 mb-2 space-y-3 z-0">
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
                <h2 className="text-sm font-semibold text-emerald-50 mb-1">
                  Season Majors
                </h2>
                <p className="text-[11px] text-emerald-100/80">
                  Four flagship events with FedEx-style points. Swipe down to
                  return home. Later we’ll wire in live standings and odds.
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-50">
                    Major 1 · Spring
                  </span>
                  <span className="text-emerald-200/80">Coming soon</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-emerald-100/80">
                  <span>Course: TBD</span>
                  <span>Points: —</span>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-50">
                    Major 2 · Summer
                  </span>
                  <span className="text-emerald-200/80">Coming soon</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-emerald-100/80">
                  <span>Course: TBD</span>
                  <span>Points: —</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}