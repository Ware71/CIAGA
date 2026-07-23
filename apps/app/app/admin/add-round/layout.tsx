import type { Metadata } from "next";

// The page here is a client component, which can't export metadata — so the
// tab title lives on this layout instead.
export const metadata: Metadata = { title: "Add Round" };

export default function AddRoundLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
