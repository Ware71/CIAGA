import Link from "next/link";
import { SITE_NAME, OPERATOR_NAME, APP_URL } from "@/lib/legal";
import { CookiePreferencesButton } from "@/components/site/CookiePreferencesButton";

const legalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/cookies", label: "Cookies" },
  { href: "/acceptable-use", label: "Acceptable Use" },
  { href: "/copyright", label: "Copyright" },
  { href: "/legal", label: "Legal" },
];

const linkClass =
  "text-emerald-100/75 transition-colors hover:text-emerald-50";

export function Footer() {
  return (
    <footer className="border-t border-emerald-900/60 bg-[#061f12] text-emerald-50">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="text-sm text-emerald-100/75">
            <p>
              © {new Date().getFullYear()} {SITE_NAME}
            </p>
            <p className="mt-1 text-xs text-emerald-200/80">
              Operated by {OPERATOR_NAME}.
            </p>
          </div>

          <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <a className={linkClass} href={APP_URL}>
              Open app
            </a>
            {legalLinks.map((l) => (
              <Link key={l.href} className={linkClass} href={l.href}>
                {l.label}
              </Link>
            ))}
            {/* Global so cookie preferences are reachable from every page, which
                is what the Cookie Policy promises. */}
            <CookiePreferencesButton className={linkClass} />
          </nav>
        </div>
      </div>
    </footer>
  );
}
