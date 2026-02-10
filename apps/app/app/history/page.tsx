// /app/history/page.tsx
import { Suspense } from "react";
import HistoryClient from "./HistoryClient";

export default function HistoryPage() {
  return (
    <Suspense fallback={<HistoryLoading />}>
      <HistoryClient />
    </Suspense>
  );
}

function HistoryLoading() {
  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        <div className="h-7 w-44 rounded bg-emerald-900/30" />
        <div className="h-24 w-full rounded-2xl bg-emerald-900/20" />
        <div className="h-24 w-full rounded-2xl bg-emerald-900/20" />
        <div className="h-24 w-full rounded-2xl bg-emerald-900/20" />
      </div>
    </div>
  );
}
