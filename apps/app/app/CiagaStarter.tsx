"use client";

import Image from "next/image";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AuthUser } from "@/components/ui/auth-user";

import type { FeedItemVM } from "@/lib/feed/types";
import type { HomeSummary } from "@/lib/home/getHomeSummary";

import {
  clamp,
  formatSigned,
} from "@/lib/feed/feedItemUtils";
import { MiniFeedTeaserCard } from "@/components/social/MiniFeedTeaser";
import { MajorsView } from "@/components/home/MajorsView";
import { getViewerSession } from "@/lib/auth/viewerSession";

type MenuItem = { id: string; label: string };

const homeMenuItemsBase: MenuItem[] = [
  { id: "round", label: "New Round" }, // label will be overridden dynamically
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

function EnvelopeIcon(props: { size?: number; className?: string }) {
  const s = props.size ?? 28;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={props.className} aria-hidden="true">
      <path
        d="M4.5 7.5h15v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-9Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M5.2 8.2 12 13.2l6.8-5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

type Props = {
  initialData?: HomeSummary;
};

export default function CIAGAStarter({ initialData }: Props) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("home");

  // viewport-driven layout values
  const [vw, setVw] = useState(390);
  const [vh, setVh] = useState(844);

  // ✅ Live round detection (for "Resume Round")
  const [liveRoundId, setLiveRoundId] = useState<string | null>(initialData?.live_round_id ?? null);

  // ✅ Profile id (used for handicap + last round)
  const [myProfileId, setMyProfileId] = useState<string | null>(null);

  // ✅ Subtle home summary
  const [handicapIndex, setHandicapIndex] = useState<number | null>(initialData?.handicap?.current ?? null);
  const [handicapDelta30, setHandicapDelta30] = useState<number>(initialData?.handicap?.delta_30d ?? 0);
  const [roundsPlayed, setRoundsPlayed] = useState<number | null>(initialData?.rounds_played ?? null);

  const [lastRound, setLastRound] = useState<{
    course: string | null;
    tee: string | null;
    gross: number | null;
    net: number | null;
    diff: number | null;
    played_at: string | null;
  } | null>(initialData?.last_round ?? null);

  const [miniFeed, setMiniFeed] = useState<FeedItemVM[]>(initialData?.mini_feed ?? []);
  const [miniFeedLoading, setMiniFeedLoading] = useState(false);
  const [miniFeedError, setMiniFeedError] = useState<string | null>(null);

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

  // ✅ Consolidated home data fetch (skipped when server-provided initialData exists)
  useEffect(() => {
    if (initialData) return; // Already hydrated from server component

    let cancelled = false;

    (async () => {
      setMiniFeedLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) {
          if (!cancelled) setMyProfileId(null);
          return;
        }
        if (!cancelled) setMyProfileId(session.profileId);

        const res = await fetch("/api/home/summary", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();

        if (!cancelled) {
          setLiveRoundId(data.live_round_id ?? null);
          setHandicapIndex(data.handicap?.current ?? null);
          setHandicapDelta30(data.handicap?.delta_30d ?? 0);
          setRoundsPlayed(data.rounds_played ?? null);
          setLastRound(data.last_round ?? null);
          setMiniFeed((data.mini_feed as FeedItemVM[]) ?? []);
        }
      } catch (e: any) {
        if (!cancelled) {
          setMiniFeedError(e?.message ?? "Failed to load");
        }
      } finally {
        if (!cancelled) setMiniFeedLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [initialData]);

  const homeMenuItems: MenuItem[] = useMemo(() => {
    return homeMenuItemsBase.map((it) =>
      it.id === "round" ? { ...it, label: liveRoundId ? "Resume Round" : "New Round" } : it
    );
  }, [liveRoundId]);

  const closedOffset = clamp(vh * 0.28, 170, 260);

  const goToMajors = () => {
    setOpen(false);
    setView("majors");
  };

  const goToHome = () => {
    setOpen(false);
    setView("home");
  };

  const handleHomeSelect = (id: string) => {
    setOpen(false);

    if (id === "courses") {
      router.push("/courses");
      return;
    }

    if (id === "round") {
      if (liveRoundId) router.push(`/round/${liveRoundId}`);
      else router.push("/round");
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
  };

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
          <motion.div
            className="fixed inset-0 backdrop-blur-md z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />

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

  // Exactly 5 teaser cards; no scrolling needed.
  const MINI_CARD_H = 44; // teaser height approx
  const MINI_GAP = 8; // space-y-2
  const miniFeedMaxH = MINI_CARD_H * 5 + MINI_GAP * 4;

  return (
    <AnimatePresence initial={false} mode="wait">
      {view === "home" ? (
        <motion.div
          key="home"
          className="h-[100dvh] bg-[#042713] text-slate-100 flex flex-col items-center justify-between pb-[env(safe-area-inset-bottom)] pt-8 px-4 overflow-hidden"
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
                <span className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Est. 2025</span>
              </div>
            </div>

            {/* Envelope + avatar */}
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="h-14 w-14 rounded-full grid place-items-center text-emerald-100/75 hover:text-emerald-50 hover:bg-emerald-900/25"
                onClick={() => {
                  // TODO: wire mailbox/notifications
                }}
                aria-label="Notifications"
                title="Notifications"
              >
                <EnvelopeIcon size={38} className="opacity-90" />
              </button>

              <div className="scale-[1.4] origin-top-right -translate-y-[4px]">
                <AuthUser />
              </div>
            </div>
          </header>

          {/* Subtle summary */}
          <motion.div
            className="w-full max-w-sm mt-4"
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
            {/* Handicap line */}
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">Handicap</div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="text-2xl font-extrabold text-[#f5e6b0] leading-none">
                    {typeof handicapIndex === "number" ? handicapIndex.toFixed(1) : "—"}
                  </span>
                  <span className="text-[11px] font-extrabold text-emerald-50/90">
                    {formatSigned(handicapDelta30, 1)}{" "}
                    <span className="text-emerald-100/60 font-semibold">/ 30d</span>
                  </span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">Rounds</div>
                <div className="mt-1 text-[12px] font-extrabold text-emerald-50/90">
                  {typeof roundsPlayed === "number" ? roundsPlayed : "—"}
                </div>
              </div>
            </div>

            <div className="mt-3 h-px bg-emerald-900/35" />

            {/* Last round line */}
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">Last Round</div>
                <div className="mt-1 text-sm font-extrabold text-emerald-50 truncate">
                  {lastRound?.course ?? "—"}
                  {lastRound?.tee ? <span className="text-emerald-100/70"> · {lastRound.tee}</span> : null}
                </div>
                {lastRound?.played_at ? (
                  <div className="mt-0.5 text-[11px] font-semibold text-emerald-100/60">
                    {new Date(lastRound.played_at).toLocaleDateString()}
                  </div>
                ) : null}
              </div>

              <div className="shrink-0 flex items-center gap-3">
                <div className="text-right">
                  <div className="text-[10px] font-extrabold text-emerald-100/45">G</div>
                  <div className="text-sm font-extrabold text-[#f5e6b0]">{lastRound?.gross ?? "—"}</div>
                </div>

                <div className="w-px h-8 bg-emerald-900/35" />

                <div className="text-right">
                  <div className="text-[10px] font-extrabold text-emerald-100/45">N</div>
                  <div className="text-sm font-extrabold text-emerald-50">{lastRound?.net ?? "—"}</div>
                </div>

                <div className="w-px h-8 bg-emerald-900/35" />

                <div className="text-right">
                  <div className="text-[10px] font-extrabold text-emerald-100/45">DIFF</div>
                  <div className="text-sm font-extrabold text-emerald-50">
                    {typeof lastRound?.diff === "number" ? lastRound.diff.toFixed(1) : "—"}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 h-px bg-emerald-900/35" />

            {/* Social Highlight */}
            <div className="mt-3 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">Social Highlights</div>
              <button
                type="button"
                className="text-[11px] font-extrabold text-emerald-100/80 hover:text-emerald-50"
                onClick={() => router.push("/social")}
              >
                Open →
              </button>
            </div>

            <div className="mt-3 space-y-2 pr-1 overflow-hidden" style={{ maxHeight: miniFeedMaxH }}>
              {miniFeedLoading ? (
                <div className="text-sm font-semibold text-emerald-100/70">Loading…</div>
              ) : miniFeed.length ? (
                miniFeed.map((it) => <MiniFeedTeaserCard key={it.id} item={it} onOpen={() => router.push("/social")} />)
              ) : miniFeedError ? (
                <div className="text-sm font-semibold text-red-200/90">{miniFeedError}</div>
              ) : (
                <div className="text-sm font-semibold text-emerald-100/70">Nothing new yet.</div>
              )}
            </div>
          </motion.div>

          <div className="relative flex-1 w-full max-w-sm">
            {renderRadialMenu(homeMenuItems, handleHomeSelect)}

            <motion.div
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
                  <Image src="/ciaga-logo.png" alt="CIAGA logo" width={72} height={72} className="object-contain" />
                </motion.div>
              </motion.button>
            </motion.div>
          </div>

          <footer className="mt-4 text-[10px] text-emerald-100/60 text-center">Tap to explore. Swipe up for Majors.</footer>
        </motion.div>
      ) : (
        <MajorsView
          open={open}
          setOpen={setOpen}
          goToHome={goToHome}
          majorsMenuItems={majorsMenuItems}
          handleMajorsSelect={handleMajorsSelect}
          renderRadialMenu={renderRadialMenu}
          vh={vh}
        />
      )}
    </AnimatePresence>
  );
}
