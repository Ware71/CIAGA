import { Skeleton } from "@/components/ui/skeleton";
import FeedSkeleton from "@/components/social/FeedSkeleton";

/**
 * Mirrors the real /social layout exactly — same gutter, same max width, same
 * 48px left-aligned header box. The previous version centred its header and
 * used pt-8, so every navigation to the feed showed the title jump left and up
 * as the real page took over.
 */
export default function SocialLoading() {
  return (
    <div className="min-h-screen px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm">
        <div className="flex min-h-[48px] flex-col justify-center gap-[3px] pb-2.5 pt-3">
          <Skeleton className="h-[17px] w-20" />
          <Skeleton className="h-[11px] w-44" />
        </div>

        <FeedSkeleton />
      </div>
    </div>
  );
}
