// src/app/stats/page.tsx
"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Tile = {
  title: string;
  subtitle: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
};

function TileCard({ title, subtitle, href, icon, badge }: Tile) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 hover:bg-[#0b3b21]/80 transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-900/70 bg-[#042713]/55">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-sm font-extrabold tracking-wide text-[#f5e6b0]">{title}</div>
              {badge ? (
                <span className="rounded-full border border-emerald-900/70 bg-[#042713]/55 px-2 py-0.5 text-[10px] font-extrabold text-emerald-100/80">
                  {badge}
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-[11px] font-semibold text-emerald-100/60">{subtitle}</div>
          </div>
        </div>

        <div className="text-emerald-100/70 text-sm font-extrabold">→</div>
      </div>
    </Link>
  );
}

// Simple inline icons (no new deps)
function IconChart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 19V5M4 19H20"
        stroke="rgba(226,252,231,0.80)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M7 15l4-4 3 3 5-6"
        stroke="rgba(245,230,176,0.95)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTrophy() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 4h8v3a4 4 0 0 1-8 0V4Z"
        stroke="rgba(245,230,176,0.95)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M6 5H4a2 2 0 0 0 2 5"
        stroke="rgba(226,252,231,0.80)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M18 5h2a2 2 0 0 1-2 5"
        stroke="rgba(226,252,231,0.80)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 11v4"
        stroke="rgba(226,252,231,0.80)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8 21h8"
        stroke="rgba(226,252,231,0.80)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M9 21c0-3 6-3 6 0"
        stroke="rgba(226,252,231,0.80)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"
        stroke="rgba(226,252,231,0.80)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTarget() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10Z"
        stroke="rgba(226,252,231,0.80)"
        strokeWidth="2"
      />
      <path
        d="M12 18a6 6 0 1 0-6-6 6 6 0 0 0 6 6Z"
        stroke="rgba(245,230,176,0.95)"
        strokeWidth="2"
      />
      <path
        d="M12 14a2 2 0 1 0-2-2 2 2 0 0 0 2 2Z"
        fill="rgba(245,230,176,0.95)"
      />
    </svg>
  );
}

function IconSpark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2l1.2 4.2L17 7.4l-3.8 1.2L12 13l-1.2-4.4L7 7.4l3.8-1.2L12 2Z"
        fill="rgba(245,230,176,0.95)"
      />
      <path
        d="M5 13l.8 2.8L8 16.4l-2.2.7L5 20l-.8-2.9L2 16.4l2.2-.6L5 13Z"
        fill="rgba(226,252,231,0.75)"
      />
      <path
        d="M19 12l.9 3L22 15.6l-2.1.7L19 19l-.9-2.7-2.1-.7 2.1-.6.9-3Z"
        fill="rgba(226,252,231,0.75)"
      />
    </svg>
  );
}

export default function StatsHomePage() {
  const router = useRouter();

  // If you moved the projections page to /stats/projections
  // this tile points there.
  const tiles: Tile[] = [
    {
      title: "Projections",
      subtitle: "Trajectory, goal ETA, intercepts, and projected HI by date",
      href: "/stats/projections",
      icon: <IconChart />,
      badge: "Time model",
    },
    {
      title: "Course records",
      subtitle: "Best scores per course/tee + personal best trends",
      href: "/stats/course-records",
      icon: <IconTrophy />,
      badge: "PBs",
    },
    {
      title: "Hole scoring",
      subtitle: "Average score by hole, hardest holes, blow-up patterns",
      href: "/stats/hole-scoring",
      icon: <IconGrid />,
    },
    {
      title: "Scoring breakdown",
      subtitle: "Birdies/par/par+ rates, net vs gross distribution",
      href: "/stats/scoring-breakdown",
      icon: <IconTarget />,
    },
    {
      title: "Streaks & milestones",
      subtitle: "Best stretch of rounds, consistency, firsts and goals hit",
      href: "/stats/milestones",
      icon: <IconSpark />,
    },
  ];

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        {/* Header (matches projections styling) */}
        <header className="relative flex items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="absolute left-0 px-2 text-emerald-100 hover:bg-emerald-900/30 font-semibold"
            onClick={() => router.back()}
          >
            ← Back
          </Button>

          <div className="text-center">
            <div className="text-lg font-extrabold tracking-wide text-[#f5e6b0]">Stats</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70 font-semibold">
              Insights
            </div>
          </div>
        </header>

        {/* Tiles */}
        <div className="space-y-3">
          {tiles.map((t) => (
            <TileCard key={t.href} {...t} />
          ))}
        </div>

        {/* Small footer note */}
        <div className="pt-1 text-[10px] text-emerald-100/50 text-center font-semibold">
          CIAGA · Stats
        </div>
      </div>
    </div>
  );
}
