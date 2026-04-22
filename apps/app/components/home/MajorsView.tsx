"use client";

import { useRef, useState, useCallback, useLayoutEffect, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AuthUser } from "@/components/ui/auth-user";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { MajorHubSummary, MajorGroup, CompetitionWithGroup } from "@/lib/majors/types";
import { competitionStatusLabel } from "@/lib/majors/labels";

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

function CompetitionCard({ comp }: { comp: CompetitionWithGroup }) {
  const router = useRouter();
  const isLive = comp.majors_status === "live";
  const isCompleted = comp.majors_status === "completed";

  return (
    <button
      type="button"
      onClick={() => router.push(`/majors/competitions/${comp.id}`)}
      className="w-full text-left rounded-2xl border bg-[#0b3b21]/80 p-3.5 space-y-1.5 overflow-hidden relative"
      style={{
        borderColor: isLive ? "rgba(217,119,6,0.35)" : isCompleted ? "rgba(52,211,153,0.25)" : "rgba(6,78,59,0.7)",
      }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
        style={{
          background: isLive
            ? "linear-gradient(to bottom, #d97706, #92400e)"
            : isCompleted
            ? "#065f46"
            : "transparent",
        }}
      />
      <div className="pl-2">
        {comp.group && (
          <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-200/55 mb-0.5">
            {comp.group.name}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-emerald-50 leading-snug truncate">{comp.name}</span>
          <span
            className={`shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full capitalize border ${
              isLive
                ? "bg-amber-900/50 text-amber-300 border-amber-800/50"
                : isCompleted
                ? "bg-emerald-900/60 text-emerald-300 border-emerald-800/50"
                : "bg-emerald-900/40 text-emerald-200/70 border-emerald-900/60"
            }`}
          >
            {competitionStatusLabel(comp)}
          </span>
        </div>
        <div className="text-[10px] text-emerald-100/60 flex items-center gap-2">
          {comp.competition_date && (
            <span>{new Date(comp.competition_date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
          )}
          {comp.course && (
            <>
              <span className="text-emerald-800">·</span>
              <span className="truncate">{comp.course.name}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function GroupCard({ group, onClick }: { group: MajorGroup & { member_count: number }; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-3 space-y-2 hover:border-emerald-700/70 transition-colors"
    >
      <div className="flex items-center gap-2.5">
        {group.image_url ? (
          <img src={group.image_url} alt={group.name} className="h-9 w-9 rounded-full object-cover border border-emerald-700/40 shrink-0" />
        ) : (
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-800 to-emerald-950 flex items-center justify-center text-[11px] font-bold text-emerald-200 shrink-0">
            {group.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-emerald-50 truncate leading-tight">{group.name}</div>
          <div className="text-[10px] text-emerald-100/50 capitalize">{group.type.replace(/_/g, " ")}</div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-emerald-200/55">{group.member_count} member{group.member_count !== 1 ? "s" : ""}</span>
        {group.ciaga_tag !== "none" && (
          <span className="text-amber-300/70 capitalize border border-amber-800/30 rounded-full px-1.5 py-0.5">{group.ciaga_tag}</span>
        )}
      </div>
    </button>
  );
}

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
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65 mb-3">Season</div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: "Points", value: hub.season_points },
              { label: "Rank", value: hub.season_rank ?? "—" },
              { label: "Events", value: hub.events_entered },
              { label: "Wins", value: hub.wins },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="text-xl font-extrabold text-[#f5e6b0] leading-none">{stat.value}</div>
                <div className="text-[10px] text-emerald-200/55 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live competitions */}
      {hub && hub.active_competitions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55 flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            Live Now
          </div>
          {hub.active_competitions.slice(0, 2).map((comp) => (
            <CompetitionCard key={comp.id} comp={comp} />
          ))}
        </div>
      )}

      {/* Upcoming competitions */}
      {hub && hub.active_competitions.length === 0 && hub.upcoming_competitions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55">Upcoming</div>
          {hub.upcoming_competitions.slice(0, 2).map((comp) => (
            <CompetitionCard key={comp.id} comp={comp} />
          ))}
        </div>
      )}

      {/* My Groups */}
      {hub && hub.my_groups.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55">My Groups</div>
            <button
              type="button"
              onClick={() => router.push("/majors/groups/create")}
              className="text-[10px] text-emerald-400 hover:text-emerald-300"
            >
              + New
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {hub.my_groups.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                onClick={() => router.push(`/majors/groups/${g.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Discover Groups */}
      {hub && hub.discover_groups.length > 0 && (
        <div className="space-y-1.5 pb-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55">Discover Groups</div>
          <div className="grid grid-cols-2 gap-2">
            {hub.discover_groups.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                onClick={() => router.push(`/majors/groups/${g.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {(!hub || (hub.my_groups.length === 0 && hub.active_competitions.length === 0 && hub.upcoming_competitions.length === 0)) && (
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
