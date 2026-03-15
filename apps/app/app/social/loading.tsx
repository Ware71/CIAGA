import { Skeleton } from "@/components/ui/skeleton"

export default function SocialLoading() {
  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="flex flex-col items-center gap-1">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-3 w-44" />
        </div>
        {/* Feed card skeletons */}
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl bg-emerald-900/20" />
          ))}
        </div>
      </div>
    </div>
  )
}
