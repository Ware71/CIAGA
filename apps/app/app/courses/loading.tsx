import { Skeleton } from "@/components/ui/skeleton";

export default function CoursesLoading() {
  return (
    <div className="px-4">
      <div className="mx-auto w-full max-w-sm">
        {/* Header */}
        <div className="flex min-h-[48px] flex-col gap-[5px] pb-2.5 pt-3">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-48" />
        </div>

        {/* Search + pin */}
        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1 rounded-[var(--r-ui)]" />
          <Skeleton className="h-10 w-10 rounded-[var(--r-ui)]" />
        </div>

        {/* Tabs */}
        <div className="mt-3 flex gap-1.5">
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>

        {/* Rows */}
        <div className="mt-3 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-[var(--r-ui)]" />
          ))}
        </div>
      </div>
    </div>
  );
}
