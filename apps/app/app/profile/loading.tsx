import { Skeleton } from "@/components/ui/skeleton"

export default function ProfileLoading() {
  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-16" />
          <div className="flex flex-col items-center gap-1">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="w-16" />
        </div>
        {/* Avatar + name */}
        <div className="flex flex-col items-center gap-3 py-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        {/* Info cards */}
        <Skeleton className="h-24 w-full rounded-2xl bg-emerald-900/20" />
        <Skeleton className="h-16 w-full rounded-2xl bg-emerald-900/20" />
      </div>
    </div>
  )
}
