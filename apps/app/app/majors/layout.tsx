import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s | Majors",
    default: "Majors",
  },
};

export default function MajorsLayout({ children }: { children: React.ReactNode }) {
  return (
    /* Ground and text come from the tokens, not literals. Hard-coding them here
       pinned the whole section to one palette — on a light theme it painted a
       dark ground under white cards and left the card text unreadable. */
    <div className="min-h-[100dvh] bg-[color:var(--ciaga-ground)] text-[color:var(--sec-text)]">
      {children}
    </div>
  );
}
