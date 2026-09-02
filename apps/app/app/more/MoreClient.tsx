"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { TileCard, type Tile } from "@/components/ui/TileCard";
import {
  Calculator,
  Flag,
  History,
  LineChart,
  Shield,
  User,
  type LucideIcon,
} from "lucide-react";

/**
 * The "More" tab: everything that doesn't earn a tab of its own. Styled as the
 * /stats landing screen so the two hubs read identically.
 *
 * No back button — this is a tab root, so there is nowhere to go back to.
 */

function Icon({ as: As }: { as: LucideIcon }) {
  return <As className="h-[18px] w-[18px] text-[#f5e6b0]" strokeWidth={2} />;
}

const BASE_TILES: Tile[] = [
  {
    title: "Profile",
    subtitle: "Your handicap record, followers, and account settings",
    href: "/profile",
    icon: <Icon as={User} />,
  },
  {
    title: "Stats",
    subtitle: "Projections, course records, scoring and shot tracking",
    href: "/stats",
    icon: <Icon as={LineChart} />,
  },
  {
    title: "Round history",
    subtitle: "Every finished round, and which ones count toward WHS",
    href: "/history",
    icon: <Icon as={History} />,
  },
  {
    title: "Courses",
    subtitle: "Search nearby or worldwide, and manage tee boxes",
    href: "/courses",
    icon: <Icon as={Flag} />,
  },
  {
    title: "Handicap calculator",
    subtitle: "Course and playing handicap for any tee and allowance",
    href: "/more/handicap-calculator",
    icon: <Icon as={Calculator} />,
  },
];

const ADMIN_TILE: Tile = {
  title: "Admin",
  subtitle: "Season import, bulk load, announcements and majors admin",
  href: "/admin",
  icon: <Icon as={Shield} />,
  badge: "Admin",
};

export default function MoreClient() {
  const [isAdmin, setIsAdmin] = useState(false);

  // Same source as the avatar dropdown's Admin item.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("owner_user_id", userId)
        .limit(1);

      if (cancelled || error) return;
      setIsAdmin(Boolean((data as { is_admin?: boolean }[] | null)?.[0]?.is_admin));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const tiles = isAdmin ? [...BASE_TILES, ADMIN_TILE] : BASE_TILES;

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <header className="text-center">
          <div className="text-lg font-extrabold tracking-wide text-[#f5e6b0]">More</div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70 font-semibold">
            Everything else
          </div>
        </header>

        <div className="space-y-3">
          {tiles.map((t) => (
            <TileCard key={t.href} {...t} />
          ))}
        </div>

        <div className="pt-1 text-[10px] text-emerald-100/50 text-center font-semibold">
          CIAGA · More
        </div>
      </div>
    </div>
  );
}
