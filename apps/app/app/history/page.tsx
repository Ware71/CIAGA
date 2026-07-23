import type { Metadata } from "next";
// /app/history/page.tsx
import { Suspense } from "react";
import HistoryClient from "./HistoryClient";
import HistoryLoading from "./loading";

export const metadata: Metadata = { title: "Round History" };

export default function HistoryPage() {
  return (
    <Suspense fallback={<HistoryLoading />}>
      <HistoryClient />
    </Suspense>
  );
}
