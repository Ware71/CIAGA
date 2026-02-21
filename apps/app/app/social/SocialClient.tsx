"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import PostComposer from "@/components/social/PostComposer";
import FeedList from "@/components/social/FeedList";
import type { FeedItemVM } from "@/lib/feed/types";

type Props = {
  initialFeedData?: {
    items: FeedItemVM[];
    liveItems: FeedItemVM[];
    nextCursor: string | null;
  };
};

export default function SocialClient({ initialFeedData }: Props) {
  const router = useRouter();

  const [composerOpen, setComposerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        {/* Header (match Stats pages) */}
        <header className="relative flex items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="absolute left-0 px-2 text-emerald-100 hover:bg-emerald-900/30 font-semibold"
            onClick={() => router.push("/")}
          >
            ← Back
          </Button>

          <div className="text-center">
            <div className="text-lg font-extrabold tracking-wide text-[#f5e6b0]">
              Social
            </div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70 font-semibold">
              Feed · Live rounds · Posts
            </div>
          </div>
        </header>

        {/* Feed (includes live rounds at top) */}
        <FeedList refreshKey={refreshKey} initialData={initialFeedData} />
      </div>

      {/* Floating Action Button (Composer hidden by default) */}
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-900/60 bg-[#0b3b21] text-[#f5e6b0] shadow-lg hover:bg-[#0b3b21]/85 active:scale-95"
        aria-label="Create post"
        title="Create post"
      >
        <span className="text-2xl font-extrabold leading-none">＋</span>
      </button>

      {/* Composer Modal (no external Dialog dependency) */}
      {composerOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setComposerOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-emerald-900/60 bg-[#062a18] p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-extrabold tracking-wide text-[#f5e6b0]">
                New Post
              </div>

              <button
                type="button"
                className="rounded-full px-2 py-1 text-emerald-100/80 hover:bg-emerald-900/30"
                onClick={() => setComposerOpen(false)}
                aria-label="Close"
                title="Close"
              >
                ✕
              </button>
            </div>

            <PostComposer
              onPosted={() => {
                setComposerOpen(false);
                setRefreshKey((k) => k + 1);
              }}
              onCancel={() => setComposerOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
