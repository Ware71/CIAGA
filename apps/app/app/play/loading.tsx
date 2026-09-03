import { Skeleton } from "@/components/ui/skeleton";

export default function PlayLoading() {
  return (
    <div className="min-h-screen px-4 pb-4">
      <div className="mx-auto w-full max-w-sm">
        {/* Header */}
        <div className="flex min-h-[48px] items-center justify-between pb-2.5 pt-3">
          <div className="flex flex-col gap-[5px]">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>

        {/* History row, primary action, find-a-round row */}
        <Skeleton className="mb-[var(--sp-grp)] h-12 w-full rounded-[var(--r-ui)]" />
        <Skeleton className="mb-[var(--sp-grp)] h-14 w-full rounded-[var(--r-ui)]" />
        <Skeleton className="mb-[var(--sp-grp)] h-12 w-full rounded-[var(--r-ui)]" />

        {/* Rounds list */}
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-[var(--r-ui)]" />
          ))}
        </div>
      </div>
    </div>
  );
}
