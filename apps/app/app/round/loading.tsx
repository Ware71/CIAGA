import { Skeleton } from "@/components/ui/skeleton"

export default function RoundListLoading() {
  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-16" />
          <div className="flex flex-col items-center gap-1">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="w-16" />
        </div>
        {/* New round button */}
        <Skeleton className="h-10 w-full rounded-2xl" />
        {/* Round card skeletons */}
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl bg-emerald-900/20" />
          ))}
        </div>
      </div>
    </div>
  )
}
