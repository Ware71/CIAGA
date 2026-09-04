import type { ReactNode } from "react";
import { Row } from "@/components/ui/chrome";

/**
 * A linked entry on the /stats and /more landing screens.
 *
 * These were cards — a boxed tile each, with a gold title. A settings list is a
 * list: a two-line row with a leading icon and a chevron is the pattern every
 * phone user already knows, and it lets the title be plain white so the accent
 * keeps meaning "live" rather than "link".
 *
 * The name is kept because both hubs and their tests refer to it.
 */
export type Tile = {
  title: string;
  subtitle: string;
  href: string;
  icon: ReactNode;
  badge?: string;
};

export function TileCard({ title, subtitle, href, icon, badge }: Tile) {
  return (
    <Row
      href={href}
      lead={
        <span className="grid h-[26px] w-[26px] place-items-center rounded-[8px] bg-[color:var(--sec-surface)] text-[color:var(--sec-accent)]">
          {icon}
        </span>
      }
      title={
        badge ? (
          <span className="flex items-center gap-2">
            {title}
            <span className="rounded-full border border-[color:var(--hair)] px-2 py-[1px] text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
              {badge}
            </span>
          </span>
        ) : (
          title
        )
      }
      subtitle={subtitle}
      trailing={
        <span className="text-[length:var(--t-fig)] leading-none text-[color:var(--sec-muted)]">›</span>
      }
    />
  );
}
