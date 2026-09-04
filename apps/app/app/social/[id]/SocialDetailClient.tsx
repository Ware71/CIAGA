"use client";

import { useRouter } from "next/navigation";
import type { FeedItemVM, FeedItemDetail as FeedItemDetailData } from "@/lib/feed/types";
import { BackButton } from "@/components/ui/BackButton";
import DetailHeader from "@/components/social/detail/DetailHeader";
import FeedItemDetail from "@/components/social/detail/FeedItemDetail";
import CommentBar from "@/components/social/CommentBar";

function roundIdForItem(item: FeedItemVM): string | null {
  const p: any = item.payload ?? {};
  if (item.type === "round_played" || item.type === "hole_event" || item.type === "pb" || item.type === "course_record") {
    return typeof p.round_id === "string" ? p.round_id : null;
  }
  if (item.type === "user_post") {
    return typeof p.tagged_round_id === "string" ? p.tagged_round_id : null;
  }
  return null;
}

export default function SocialDetailClient({
  item,
  detail,
}: {
  item: FeedItemVM;
  detail: FeedItemDetailData | null;
}) {
  const router = useRouter();
  const roundId = roundIdForItem(item);

  return (
    <div className="min-h-screen px-4 pt-4 pb-[26vh] text-[color:var(--sec-text)]">
      <div className="mx-auto w-full max-w-sm space-y-3">
        <div className="flex items-center">
          <BackButton className="font-semibold" onClick={() => router.push("/social")} />
        </div>

        {/* Compact, informative header (avatars, pill, course·tee·date, key figure, reactions) */}
        <DetailHeader item={item} />

        {/* Subtle "view scorecard" */}
        {roundId ? (
          <button
            type="button"
            onClick={() => router.push(`/round/${roundId}?from=social`)}
            className="w-full rounded-[var(--r-ui)] border border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] px-3 py-2.5 text-center text-[length:var(--t-sec)] font-medium text-[color:var(--sec-text-2)] transition hover:bg-[color:var(--sec-surface-2)]"
          >
            View scorecard →
          </button>
        ) : null}

        {/* Type-specific detail (chart + toggles, h2h, hole stats, record context) */}
        <FeedItemDetail detail={detail} />
      </div>

      {/* Persistent comments bar (expands to a drawer) */}
      <CommentBar feedItemId={item.id} />
    </div>
  );
}
