import { Skeleton } from "@/components/ui/skeleton";
import { CARD } from "@/components/ui/chrome";

/**
 * Placeholder cards for the feed.
 *
 * Shared by the route-level loading.tsx and the Suspense boundary in
 * SocialClient so the two can't drift — a skeleton that doesn't match the real
 * layout reads as a jump rather than a load, which is what the old centred
 * loading header did on every navigation to /social.
 */
export default function FeedSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-[var(--sp-grp)]" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${CARD} p-3`}>
          {/* Identity row */}
          <div className="flex items-center gap-2.5">
            <Skeleton className="bg-[color:var(--sec-surface-2)] h-9 w-9 shrink-0 rounded-full" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="bg-[color:var(--sec-surface-2)] h-3 w-28" />
              <Skeleton className="bg-[color:var(--sec-surface-2)] h-2.5 w-40" />
            </div>
          </div>

          {/* Body */}
          <div className="mt-3 space-y-2">
            <Skeleton className="bg-[color:var(--sec-surface-2)] h-3 w-full" />
            <Skeleton className="bg-[color:var(--sec-surface-2)] h-3 w-4/5" />
          </div>

          {/* Action bar */}
          <div className="mt-3 flex gap-2 border-t border-[color:var(--hair)] pt-3">
            <Skeleton className="bg-[color:var(--sec-surface-2)] h-6 flex-1" />
            <Skeleton className="bg-[color:var(--sec-surface-2)] h-6 flex-1" />
            <Skeleton className="bg-[color:var(--sec-surface-2)] h-6 flex-1" />
          </div>
        </div>
      ))}
    </div>
  );
}
