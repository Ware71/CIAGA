"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet, Ticket, Trophy } from "lucide-react";

/**
 * Persistent Fantasy Picks chrome: a bottom hot bar (New Picks · My Picks ·
 * Leaderboards) shown across the whole section. The floating bet slip sits just
 * above it; the sandbox inspector opts out.
 */

const TABS = [
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
  const pathname = usePathname();
  const hideBar = pathname.includes("/inspector");

  return (
    <>
      <div className={hideBar ? undefined : "pb-[calc(env(safe-area-inset-bottom)+66px)]"}>
        {children}
      </div>
      {!hideBar && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-emerald-900/70 bg-[#052a17]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto flex max-w-sm">
            {TABS.map(({ href, label, Icon, match }) => {
              const active = match(pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors ${
                    active ? "text-[#f5e6b0]" : "text-emerald-200/50 hover:text-emerald-100/80"
                  }`}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}
