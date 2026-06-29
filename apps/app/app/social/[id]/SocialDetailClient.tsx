"use client";

import { useRouter } from "next/navigation";
import type { FeedItemVM, FeedItemDetail as FeedItemDetailData } from "@/lib/feed/types";
import { BackButton } from "@/components/ui/BackButton";
import FeedCard from "@/components/social/FeedCard";
import CommentSection from "@/components/social/CommentSection";
import FeedItemDetail from "@/components/social/detail/FeedItemDetail";

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
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        {/* Header */}
        <header className="relative flex items-center justify-center">
          <BackButton className="absolute left-0 font-semibold" onClick={() => router.push("/social")} />
          <div className="text-center">
            <div className="text-lg font-extrabold tracking-wide text-[#f5e6b0]">Detail</div>
          </div>
        </header>

        {/* Summary card (reused, non-interactive) */}
        <FeedCard item={item} variant="detail" />

        {/* Subtle "view scorecard" */}
        {roundId ? (
          <button
            type="button"
            onClick={() => router.push(`/round/${roundId}?from=social`)}
            className="w-full rounded-xl border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-center text-xs font-semibold text-emerald-100/70 hover:bg-emerald-900/30"
          >
            View scorecard →
          </button>
        ) : null}

        {/* Type-specific detail (charts, h2h, hole stats, record context) */}
        <FeedItemDetail detail={detail} />

        {/* Comments live at the bottom of this screen */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#062a18]/60 overflow-hidden">
          <div className="border-b border-emerald-900/70 px-4 py-3 text-sm font-extrabold text-emerald-50">
            Comments
          </div>
          <CommentSection feedItemId={item.id} mentionDirection="up" listClassName="max-h-[50vh] overflow-y-auto" />
        </div>
      </div>
    </div>
  );
}
