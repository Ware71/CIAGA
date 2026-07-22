import Link from "next/link";
import Image from "next/image";
import { LAST_UPDATED } from "@/lib/legal";

/**
 * Shared shell for long-form legal documents. Renders a light-theme page with a
 * simple header, a title + "last updated" line, and a `.legal-prose` content
 * region (styled in globals.css) so each document can be authored as plain
 * semantic JSX.
 */
export function LegalPage({
  title,
  intro,
  updated = LAST_UPDATED,
  children,
}: {
  title: string;
  intro?: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/ciaga-logo.png"
              alt="CIAGA"
              width={30}
              height={30}
              className="rounded"
            />
            <span className="text-sm font-semibold tracking-wide">CIAGA</span>
          </Link>
          <Link
            href="/legal"
            className="text-sm text-zinc-700 hover:text-zinc-950"
          >
            All legal
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: {updated}</p>
        {intro ? (
          <p className="mt-4 text-pretty text-lg text-zinc-700">{intro}</p>
        ) : null}

        <div className="legal-prose mt-8">{children}</div>
      </div>
    </main>
  );
}
