'use client';

import Image from "next/image";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const menuItems = [
  { id: "round", label: "New Round" },
  { id: "league", label: "League" },
  { id: "stats", label: "Stats" },
  { id: "courses", label: "Courses" },
  { id: "profile", label: "Profile" },
];

export default function CIAGAStarter() {
  const [open, setOpen] = useState(false);

  // You can later plug real navigation here (e.g. router.push("/round"))
  const handleSelect = (id: string) => {
    console.log("Selected:", id);
    // TODO: add navigation when those pages exist
  };

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 flex flex-col items-center justify-between pb-8 pt-10 px-4">
      {/* Top area: brand + small subtitle */}
      <header className="w-full max-w-sm flex flex-col items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full border border-[#d4af37]/70 bg-[#0a341c] grid place-items-center">
            <Image
              src="/ciaga-logo.png"
              alt="CIAGA logo"
              width={28}
              height={28}
              className="rounded-full"
            />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-semibold tracking-wide text-[#f5e6b0]">
              CIAGA
            </span>
            <span className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
              Golf League Companion
            </span>
          </div>
        </div>

        <p className="mt-4 text-sm text-emerald-100/80 text-center max-w-xs">
          Tap the CIAGA button to start a round, view your league, or check your
          progress. Designed for one-handed use on course.
        </p>
      </header>

      {/* Center area: radial menu when open */}
      <div className="relative flex-1 w-full max-w-sm flex items-center justify-center">
        <AnimatePresence>
          {open && (
            <>
              {/* Dim background when menu open */}
              <motion.div
                className="absolute inset-0 rounded-[32px] bg-black/40 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />

              {menuItems.map((item, index) => {
                // Manually define radial positions (tuned for mobile)
                const positions = [
                  { x: 0, y: -110 },     // top
                  { x: 95, y: -50 },     // top-right
                  { x: 75, y: 60 },      // bottom-right
                  { x: -75, y: 60 },     // bottom-left
                  { x: -95, y: -50 },    // top-left
                ];
                const pos = positions[index];

                return (
                  <motion.button
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    className="absolute flex items-center justify-center rounded-full border border-emerald-200/70 bg-[#0b3b21] px-4 py-2 shadow-lg text-xs font-medium tracking-wide"
                    initial={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
                    animate={{ opacity: 1, scale: 1, x: pos.x, y: pos.y }}
                    exit={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.05 * index }}
                  >
                    {item.label}
                  </motion.button>
                );
              })}
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom: main CIAGA home button */}
      <div className="w-full max-w-sm flex items-center justify-center">
        <motion.button
          className="relative h-20 w-20 rounded-full border-2 border-[#d4af37] bg-[#0a341c] shadow-[0_0_0_1px_rgba(0,0,0,0.7)] grid place-items-center"
          onClick={() => setOpen((prev) => !prev)}
          whileTap={{ scale: 0.9 }}
          animate={{
            y: open ? -200 : 0,
            rotate: open ? 360 : 0,
            boxShadow: open
              ? "0 0 0 6px rgba(212,175,55,0.28), 0 18px 40px rgba(0,0,0,0.75)"
              : "0 8px 22px rgba(0,0,0,0.75)",
          }}
          transition={{ type: "spring", stiffness: 180, damping: 18 }}
        >
          <motion.div
            className="h-[72px] w-[72px] rounded-full overflow-hidden flex items-center justify-center"
            animate={{ scale: open ? 1.08 : 1 }}
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

          {/* subtle glowing ring */}
          <motion.div
            className="absolute inset-0 rounded-full border border-[#f5e6b0]/40"
            animate={{
              opacity: open ? [0.4, 0.2, 0.4] : 0.3,
              scale: open ? [1, 1.05, 1] : 1,
            }}
            transition={{ repeat: open ? Infinity : 0, duration: 2 }}
          />
        </motion.button>
      </div>

      {/* Small footer */}
      <footer className="mt-4 text-[10px] text-emerald-100/60 text-center">
        Tap the CIAGA button to explore. Swipe up later for scorecards, league and stats.
      </footer>
    </div>
  );
}
