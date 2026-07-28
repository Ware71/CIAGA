export function FeatureCard({
  title,
  body,
  icon,
  tag,
}: {
  title: string;
  body: React.ReactNode;
  icon?: React.ReactNode;
  tag?: string;
}) {
  return (
    <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5">
      <div className="flex items-start justify-between gap-3">
        {icon ? (
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-emerald-900/70 bg-[#042713]/55 text-[#f5e6b0]">
            {icon}
          </div>
        ) : null}
        {tag ? (
          <span className="shrink-0 rounded-full bg-[#f5e6b0]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#f5e6b0]">
            {tag}
          </span>
        ) : null}
      </div>
      <p className="mt-4 text-sm font-extrabold text-[#f5e6b0]">{title}</p>
      <p className="mt-2 text-sm text-emerald-100/75">{body}</p>
    </div>
  );
}

/** Bordered callout for the legally load-bearing small print. */
export function NoteCard({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-r-2xl border-y border-r border-emerald-900/60 border-l-[3px] border-l-[#f5e6b0] bg-[#0b3b21]/55 px-5 py-4">
      {title ? (
        <p className="text-sm font-extrabold text-[#f5e6b0]">{title}</p>
      ) : null}
      <p className={`${title ? "mt-2 " : ""}text-sm text-emerald-100/80`}>
        {children}
      </p>
    </div>
  );
}
