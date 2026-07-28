import Link from "next/link";
import { BrandLockup } from "./BrandLockup";
import { APP_URL } from "@/lib/legal";

const marketingLinks = [
  { href: "#rounds", label: "Features" },
  { href: "#fantasy", label: "Fantasy" },
  { href: "#install", label: "Install" },
];

/**
 * Shared site header. Two variants so the marketing page and the legal
 * documents use one implementation — the legal index used to re-implement this
 * inline, which is how it drifted from the LegalPage shell.
 */
export function SiteHeader({ variant }: { variant: "marketing" | "legal" }) {
  const width = variant === "marketing" ? "max-w-6xl" : "max-w-3xl";

  return (
    <header className="sticky top-0 z-30 border-b border-emerald-900/60 bg-[#061f12]/85 backdrop-blur">
      <div
        className={`mx-auto flex ${width} items-center justify-between gap-4 px-5 py-3`}
      >
        <BrandLockup
          size="sm"
          href="/"
          subtitle={variant === "marketing"}
          priority
        />

        {variant === "marketing" ? (
          <div className="flex items-center gap-5">
            <nav className="hidden items-center gap-5 sm:flex">
              {marketingLinks.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="text-sm text-emerald-100/80 transition-colors hover:text-emerald-50"
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <a href={APP_URL} className="ciaga-cta px-4 py-2">
              Open CIAGA
            </a>
          </div>
        ) : (
          <Link
            href="/legal"
            className="text-sm text-emerald-100/80 transition-colors hover:text-emerald-50"
          >
            All legal
          </Link>
        )}
      </div>
    </header>
  );
}
