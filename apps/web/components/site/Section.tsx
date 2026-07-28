export function Eyebrow({ children }: { children: React.ReactNode }) {
  // NOTE: apps/app uses text-emerald-200/65 for this label. On a public page
  // that's ~4.6:1 against #042713 and fails WCAG AA at 10px, so apps/web runs
  // one opacity step lighter. Visually near-identical — please don't "fix"
  // this back to match the app.
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200/80">
      {children}
    </div>
  );
}

export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`mx-auto max-w-6xl px-5 py-16 sm:py-24 ${className}`}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="mt-3 text-2xl font-bold tracking-tight text-[#f5e6b0] sm:text-3xl">
        {title}
      </h2>
      {lead ? (
        <p className="mt-4 max-w-2xl text-pretty text-base text-emerald-100/80">
          {lead}
        </p>
      ) : null}
      {children}
    </section>
  );
}
