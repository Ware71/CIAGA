/**
 * Inline SVG icons, in the same idiom as the ones in apps/app
 * (see apps/app/app/stats/page.tsx and app/home/HomeClient.tsx):
 * 24x24, stroked, rounded caps/joins, currentColor.
 *
 * Kept hand-rolled rather than pulling in lucide-react — apps/web has no icon
 * library and the repo rule is no new dependencies.
 */

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconChart({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 16v-4" />
      <path d="M12.5 16V8" />
      <path d="M17 16v-6" />
    </svg>
  );
}

export function IconTrophy({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 5H5.5A1.5 1.5 0 0 0 4 6.5C4 8.5 5.5 10 8 10" />
      <path d="M16 5h2.5A1.5 1.5 0 0 1 20 6.5c0 2-1.5 3.5-4 3.5" />
      <path d="M12 13v3" />
      <path d="M9 20h6" />
      <path d="M10 20a2 2 0 0 1 4 0" />
    </svg>
  );
}

export function IconGrid({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </svg>
  );
}

export function IconBell({ className }: IconProps) {
  return (
    <svg {...base} strokeWidth={1.8} className={className}>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 4-1.5 5.2-2 6h16c-.5-.8-2-2-2-6Z" />
      <path d="M10.5 18.5a1.8 1.8 0 0 0 3 0" />
    </svg>
  );
}

export function IconCalendar({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.4" />
      <path d="M3.5 10h17" />
      <path d="M8 3.5v3" />
      <path d="M16 3.5v3" />
      <path d="M8 14h3" />
    </svg>
  );
}

export function IconPin({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M19 10.5c0 5-7 10.5-7 10.5S5 15.5 5 10.5a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10.3" r="2.5" />
    </svg>
  );
}

export function IconChat({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5a9.7 9.7 0 0 1-2.6-.35L4.5 20.5l1.1-3.2A6.2 6.2 0 0 1 4 12.5C4 8.9 7.6 6 12 6s8 2.9 8 6.5Z" />
    </svg>
  );
}

export function IconFlag({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6.5 21V3.5" />
      <path d="M6.5 4.5h10.2a.6.6 0 0 1 .45 1L14.5 8.6l2.65 3.1a.6.6 0 0 1-.45 1H6.5" />
    </svg>
  );
}

export function IconTarget({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
