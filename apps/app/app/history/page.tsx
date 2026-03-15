// /app/history/page.tsx
import { Suspense } from "react";
import HistoryClient from "./HistoryClient";
import HistoryLoading from "./loading";

export default function HistoryPage() {
  return (
    <Suspense fallback={<HistoryLoading />}>
      <HistoryClient />
    </Suspense>
  );
}
