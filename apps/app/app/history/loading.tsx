import { Skeleton } from "@/components/ui/skeleton"

export default function HistoryLoading() {
  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-24 w-full rounded-2xl bg-emerald-900/20" />
        <Skeleton className="h-24 w-full rounded-2xl bg-emerald-900/20" />
        <Skeleton className="h-24 w-full rounded-2xl bg-emerald-900/20" />
      </div>
    </div>
  )
}
