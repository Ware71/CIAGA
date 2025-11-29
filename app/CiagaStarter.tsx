'use client';

import Image from "next/image";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AuthUser } from "@/components/ui/auth-user";

const menuItems = [
  { id: "round", label: "New Round" },
  { id: "league", label: "League" },
  { id: "stats", label: "Stats" },
  { id: "courses", label: "Courses" },
  { id: "profile", label: "Profile" },
];

export default function CIAGAStarter() {
  const [open, setOpen] = useState(false);

  // Dynamic offset for bottom button based on viewport height
  const [closedOffset, setClosedOffset] = useState(210);

  useEffect(() => {
    const computeOffset = () => {
      if (typeof window === "undefined") return;

      const h = window.innerHeight;

      // Lower third of the screen, clamped for consistency
      const offset = Math.min(260, Math.max(170, h * 0.28));
      setClosedOffset(offset);
    };

    computeOffset();
    window.addEventListener("resize", computeOffset);
    return () => window.removeEventListener("resize", computeOffset);
  }, []);

  const handleSelect = (id: string) => {
    console.log("Selected:", id);
    // Later: router.push(`/page/${id}`)
  };

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 flex flex-col items-center justify-between pb-[env(safe-area-inset-bottom)] pt-8 px-4">

      {/* HEADER */}
      <header className="w-full max-w-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Logo Bubble */}
          <div className="h-10 w-10 rounded-full bg-[#0a341c] shadow-[0_4px_12px_rgba(0,0,0,0.5)] grid place-items-center">
            <Image
              src="/ciaga-logo.png"
              alt="CIAGA logo"
              width={40}
              height={40}
              className="rounded-full"
            />
          </div>

          {/* CIAGA text */}
          <div className="flex flex-col leading-tight">
            <span className="text-lg font-semibold tracking-wide text-[#f5e6b0]">
              CIAGA
            </span>
            <span className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
              Est. 2025
            </span>
          </div>
        </div>

        {/* User Profile / Sign Out */}
        <AuthUser />
      </header>

      {/* Subheading */}
      <p className="mt-4 text-sm text-emerald-100/80 text-center max-w-xs">
        Tap the CIAGA button to start a round, view the league, or check your stats.
      </p>

      {/* ⭕ RADIAL MENU AREA */}
      <div className="relative flex-1 w-full max-w-sm flex items-center justify-center">

        <AnimatePresence>
          {open && (
            <>
              {/* Background Blur */}
              <motion.div
                className="absolute inset-0 rounded-[32px] backdrop-blur-md bg-transparent"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />

              {/* Menu Items */}
              {menuItems.map((item, index) => {
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
                    onClick={() => handleSelect(item.id)}
                    className="absolute flex items-center justify-center rounded-full border border-emerald-200/70 bg-[#0b3b21]/95 px-4 py-2 shadow-lg text-xs font-medium tracking-wide"
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

        {/* ⛳ MAIN CIAGA BUTTON (GREEN ONLY — NO GOLD RING) */}
        <motion.button
          className="relative h-20 w-20 rounded-full bg-[#0a341c] shadow-[0_8px_22px_rgba(0,0,0,0.75)] grid place-items-center"
          onClick={() => setOpen((prev) => !prev)}
          whileTap={{ scale: 0.92 }}
          initial={false}
          animate={{
            y: open ? 0 : closedOffset,
            rotate: open ? 360 : 0,
            boxShadow: open
              ? "0 18px 40px rgba(0,0,0,0.75)"
              : "0 8px 22px rgba(0,0,0,0.75)",
          }}
          transition={{ type: "spring", stiffness: 180, damping: 18 }}
        >
          {/* Logo inside the button */}
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
      </div>

      {/* FOOTER */}
      <footer className="mt-4 text-[10px] text-emerald-100/60 text-center">
        Tap the CIAGA button to explore.
      </footer>
    </div>
  );
}
