/**
 * Device frame for the CSS product mockups.
 *
 * The contents are decorative artwork built from invented data, so the frame
 * carries a single role="img" + aria-label and everything inside is hidden —
 * a screen reader reciting a fake scorecard row by row is noise, and the
 * adjacent prose already carries the meaning.
 *
 * The w-[260px] sm:w-[300px] step is not cosmetic: at a 320px viewport the
 * section padding (px-5) leaves 280px of content width, so a fixed 300px frame
 * overflows and gives the whole page a horizontal scrollbar.
 */
export function PhoneFrame({
  children,
  className = "",
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`relative mx-auto w-[260px] sm:w-[300px] ${className}`}
    >
      <div
        aria-hidden
        className="absolute -inset-8 rounded-[3.5rem] bg-[#0b3b21]/35 blur-3xl"
      />
      <div
        aria-hidden
        className="relative rounded-[2.5rem] border border-emerald-900/70 bg-[#020f08] p-2 shadow-2xl shadow-black/60"
      >
        <div className="relative overflow-hidden rounded-[2rem] bg-[#042713] ring-1 ring-emerald-900/50">
          <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-[#020f08]" />
          <div className="px-3.5 pb-6 pt-9">{children}</div>
        </div>
      </div>
    </div>
  );
}
