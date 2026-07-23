import type { Metadata } from "next";

// The page here is a client component, which can't export metadata — so the
// tab title lives on this layout instead.
export const metadata: Metadata = { title: "Course Records" };

export default function CourseRecordsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
