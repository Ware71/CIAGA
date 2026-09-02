import Link from "next/link";
import type { ReactNode } from "react";
import { CARD_INTERACTIVE } from "@/components/ui/chrome";

/**
 * The linked tile used by the /stats and /more landing screens. Extracted from
 * app/stats/page.tsx so both hubs stay identical rather than drifting.
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
    <Link
      href={href}
      className={`${CARD_INTERACTIVE} block p-5`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border border-[color:var(--sec-line)] bg-[color:var(--ciaga-ground)]/55">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-sm font-extrabold tracking-wide text-[color:var(--sec-accent)]">{title}</div>
              {badge ? (
                <span className="rounded-full border border-[color:var(--sec-line)] bg-[color:var(--ciaga-ground)]/55 px-2 py-0.5 text-[10px] font-extrabold text-emerald-100/80">
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
