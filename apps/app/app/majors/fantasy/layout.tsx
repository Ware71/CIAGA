"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Wallet, Ticket, Trophy } from "lucide-react";
import { NavBarShell, NavTab } from "@/components/nav/NavBarShell";
import type { TabDef } from "@/components/nav/navConfig";

/**
 * Persistent Fantasy Picks chrome: a bottom bar (New Picks · My Picks ·
 * Leaderboards) shown across the whole section. The floating bet slip sits just
 * above it; the sandbox inspector opts out.
 *
 * The main app nav hides across /majors/fantasy/** (see navConfig.hidesMainNav)
 * so these two bars never stack — this is the section's only bar. It shares the
 * main nav's pill shell, and keeps its labels: Wallet/Ticket/Trophy don't read
 * as icons alone the way Social/Calendar do.
 *
 * Because the main nav is hidden here, each section root carries its own
 * "← Majors" back link — otherwise there is no way out in the installed PWA,
 * which is portrait-locked with no browser chrome.
 */

const TABS: TabDef[] = [
  {
    href: "/majors/fantasy",
    label: "New Picks",
    Icon: Wallet,
    match: (p: string) =>
      p === "/majors/fantasy" ||
      p.startsWith("/majors/fantasy/groups") ||
      p.startsWith("/majors/fantasy/events") ||
      p.startsWith("/majors/fantasy/seasons"),
  },
  {
    href: "/majors/fantasy/picks",
    label: "My Picks",
    Icon: Ticket,
    match: (p: string) => p.startsWith("/majors/fantasy/picks"),
  },
  {
    href: "/majors/fantasy/leaderboard",
    label: "Leaderboards",
    Icon: Trophy,
    match: (p: string) => p.startsWith("/majors/fantasy/leaderboard"),
  },
];

export default function FantasyLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const hideBar = pathname.includes("/inspector");

  return (
    <>
      <div
        className={
          hideBar
            ? undefined
            : "pb-[calc(env(safe-area-inset-bottom)+var(--ciaga-nav-h))]"
        }
      >
        {children}
      </div>
      {!hideBar && (
        <NavBarShell label="Fantasy Picks">
          {TABS.map((tab) => (
            <NavTab
              key={tab.href}
              tab={tab}
              active={tab.match(pathname)}
              showLabel
              indicatorId="ciaga-fantasy-nav-pill"
            />
          ))}
        </NavBarShell>
      )}
    </>
  );
}
