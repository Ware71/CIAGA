"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { TileCard, type Tile } from "@/components/ui/TileCard";
import { Group, PageHeader } from "@/components/ui/chrome";
import {
  Calculator,
  Flag,
  History,
  LineChart,
  Settings,
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

const YOU_TILES: Tile[] = [
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
];

const SETTINGS_TILE: Tile = {
  title: "Settings",
  subtitle: "Theme, notifications, units and language",
  href: "/more/settings",
  icon: <Icon as={Settings} />,
};

const TOOL_TILES: Tile[] = [
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

  const tools = isAdmin ? [...TOOL_TILES, ADMIN_TILE] : TOOL_TILES;

  return (
    <div className="min-h-screen px-4 pb-4">
      <div className="mx-auto w-full max-w-sm">
        <PageHeader title="More" subtitle="Everything else" />

        <Group label="You">
          {YOU_TILES.map((t) => (
            <TileCard key={t.href} {...t} />
          ))}
        </Group>

        <Group label="Tools">
          {tools.map((t) => (
            <TileCard key={t.href} {...t} />
          ))}
        </Group>

        <Group label="App">
          <TileCard {...SETTINGS_TILE} />
        </Group>
      </div>
    </div>
  );
}
