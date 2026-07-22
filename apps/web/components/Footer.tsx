import Link from "next/link";
import { SITE_NAME, OPERATOR_NAME } from "@/lib/legal";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.ciagagolf.com";

const legalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/cookies", label: "Cookies" },
  { href: "/acceptable-use", label: "Acceptable Use" },
  { href: "/copyright", label: "Copyright" },
  { href: "/legal", label: "Legal" },
];

export function Footer() {
  return (
    <footer className="border-t border-zinc-200 bg-white text-zinc-900">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="text-sm text-zinc-600">
            <p>
              © {new Date().getFullYear()} {SITE_NAME}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Operated by {OPERATOR_NAME}.
            </p>
          </div>

          <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <a className="text-zinc-700 hover:text-zinc-950" href={appUrl}>
              Open app
            </a>
            {legalLinks.map((l) => (
              <Link
                key={l.href}
                className="text-zinc-700 hover:text-zinc-950"
                href={l.href}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
