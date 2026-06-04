import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s | Majors",
    default: "Majors",
  },
};

export default function MajorsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#042713] text-slate-100">
      {children}
    </div>
  );
}
