// src/app/stats/page.tsx
"use client";

import { TileCard, type Tile } from "@/components/ui/TileCard";
import { Group, PageHeader } from "@/components/ui/chrome";

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

function IconPin() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v13"
        stroke="rgba(226,252,231,0.80)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 3l6 2.5L12 8"
        stroke="rgba(245,230,176,0.95)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M5 19c1.8-1.6 4.2-2.4 7-2.4s5.2.8 7 2.4"
        stroke="rgba(226,252,231,0.80)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function StatsHomePage() {

  // If you moved the projections page to /stats/projections
  // this tile points there.
  const trajectory: Tile[] = [
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
  ];

  const scoring: Tile[] = [
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
    {
      title: "Shot tracking",
      subtitle: "Putting, GIR, fairways, scrambling and sand saves",
      href: "/stats/shot-tracking",
      icon: <IconPin />,
      badge: "Opt-in",
    },
  ];

  return (
    <div className="min-h-screen px-4 pb-4 text-slate-100">
      <div className="mx-auto w-full max-w-sm">
        <PageHeader title="Stats" subtitle="Insights" parent="More" parentHref="/more" />

        <Group label="Trajectory">
          {trajectory.map((t) => (
            <TileCard key={t.href} {...t} />
          ))}
        </Group>

        <Group label="Scoring">
          {scoring.map((t) => (
            <TileCard key={t.href} {...t} />
          ))}
        </Group>
      </div>
    </div>
  );
}
