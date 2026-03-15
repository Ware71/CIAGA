import { Skeleton } from "@/components/ui/skeleton"

export default function RoundDetailLoading() {
  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-1.5 sm:px-2 pt-4 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-none space-y-2">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-16 shrink-0" />
          <div className="flex-1 min-w-0 px-1 flex flex-col items-center gap-1">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-48 rounded-xl mt-1" />
          </div>
        </div>
        {/* Scorecard skeleton */}
        <div className="space-y-1.5 pt-2">
          <Skeleton className="h-8 w-full rounded-lg bg-emerald-900/20" />
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg bg-emerald-900/20" />
          ))}
          <Skeleton className="h-9 w-full rounded-lg bg-emerald-900/30" />
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i + 9} className="h-9 w-full rounded-lg bg-emerald-900/20" />
          ))}
          <Skeleton className="h-10 w-full rounded-lg bg-emerald-900/30" />
        </div>
      </div>
    </div>
  )
}
