// app/social/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import LiveMatchStrip from "@/components/social/LiveMatchStrip";
import PostComposer from "@/components/social/PostComposer";
import FeedList from "@/components/social/FeedList";

export default function SocialPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        {/* Header (match Stats pages) */}
        <header className="relative flex items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="absolute left-0 px-2 text-emerald-100 hover:bg-emerald-900/30 font-semibold"
            onClick={() => router.back()}
          >
            ← Back
          </Button>

          <div className="text-center">
            <div className="text-lg font-extrabold tracking-wide text-[#f5e6b0]">Social</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70 font-semibold">
              Feed · Live matches · Posts
            </div>
          </div>
        </header>

        {/* Pinned live matches */}
        <LiveMatchStrip />

        {/* Post composer */}
        <PostComposer />

        {/* Feed */}
        <FeedList />
      </div>
    </div>
  );
}
