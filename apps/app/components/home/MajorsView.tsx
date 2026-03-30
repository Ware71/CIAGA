"use client";

import { useRef, useState, useCallback, useLayoutEffect, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AuthUser } from "@/components/ui/auth-user";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { MajorHubSummary } from "@/lib/majors/types";

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

function MajorsHubPreview({ open }: { open: boolean }) {
  const router = useRouter();
  const [hub, setHub] = useState<MajorHubSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        const res = await fetch("/api/majors/hub", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setHub(data);
        }
      } catch {
        // silently ignore — this is a preview
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
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
      {/* Season snapshot */}
      {hub && (
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65 mb-2">Season</div>
          <div className="flex items-center justify-between">
            <div className="text-center">
              <div className="text-base font-extrabold text-[#f5e6b0]">{hub.season_points}</div>
              <div className="text-[10px] text-emerald-200/60">pts</div>
            </div>
            <div className="text-center">
              <div className="text-base font-extrabold text-[#f5e6b0]">{hub.season_rank ?? "—"}</div>
              <div className="text-[10px] text-emerald-200/60">rank</div>
            </div>
            <div className="text-center">
              <div className="text-base font-extrabold text-[#f5e6b0]">{hub.events_entered}</div>
              <div className="text-[10px] text-emerald-200/60">events</div>
            </div>
            <div className="text-center">
              <div className="text-base font-extrabold text-[#f5e6b0]">{hub.wins}</div>
              <div className="text-[10px] text-emerald-200/60">wins</div>
            </div>
          </div>
        </div>
      )}

      {/* Active competitions */}
      {hub && hub.active_competitions.length > 0 && (
        hub.active_competitions.slice(0, 2).map((comp) => (
          <button
            key={comp.id}
            type="button"
            onClick={() => router.push(`/majors/competitions/${comp.id}`)}
            className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-emerald-50 truncate">{comp.name}</span>
              <span className="shrink-0 text-emerald-200/70 capitalize ml-2">{comp.majors_status}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-emerald-100/70">
              <span>{comp.course?.name ?? "Course TBD"}</span>
              {comp.competition_date && (
                <span>{new Date(comp.competition_date).toLocaleDateString()}</span>
              )}
            </div>
          </button>
        ))
      )}

      {/* Upcoming competitions */}
      {hub && hub.active_competitions.length === 0 && hub.upcoming_competitions.length > 0 && (
        hub.upcoming_competitions.slice(0, 2).map((comp) => (
          <button
            key={comp.id}
            type="button"
            onClick={() => router.push(`/majors/competitions/${comp.id}`)}
            className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-emerald-50 truncate">{comp.name}</span>
              <span className="shrink-0 text-emerald-200/70 ml-2">Upcoming</span>
            </div>
            {comp.competition_date && (
              <div className="text-[11px] text-emerald-100/70">
                {new Date(comp.competition_date).toLocaleDateString()}
              </div>
            )}
          </button>
        ))
      )}

      {/* Empty state */}
      {(!hub || (hub.active_competitions.length === 0 && hub.upcoming_competitions.length === 0)) && (
        <>
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
            <h2 className="text-sm font-semibold text-emerald-50 mb-1">CIAGA Majors</h2>
            <p className="text-[11px] text-emerald-100/75">
              Create groups, run competitions, and track season standings. Tap Hub to get started.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/majors/groups/create")}
            className="w-full rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 text-sm font-semibold text-emerald-200 text-left hover:border-emerald-700/70"
          >
            + Create your first group →
          </button>
        </>
      )}
    </motion.div>
  );
}

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

        <MajorsHubPreview open={open} />
      </div>
    </motion.div>
  );
}
