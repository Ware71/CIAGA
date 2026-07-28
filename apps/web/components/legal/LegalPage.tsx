import { LAST_UPDATED } from "@/lib/legal";
import { SiteHeader } from "@/components/site/SiteHeader";

/**
 * Shared shell for long-form legal documents. Renders the app's dark brand with
 * a title + "last updated" line and a `.legal-prose` content region (styled in
 * globals.css) so each document can be authored as plain semantic JSX.
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
    <main id="main" className="min-h-screen bg-[#042713] text-emerald-50">
      <SiteHeader variant="legal" />

      <div className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-[#f5e6b0] sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-emerald-200/80">
          Last updated: {updated}
        </p>
        {intro ? (
          <p className="mt-4 text-pretty text-lg text-emerald-100/80">{intro}</p>
        ) : null}

        <div className="legal-prose mt-8">{children}</div>
      </div>
    </main>
  );
}
