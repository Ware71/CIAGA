"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Masthead } from "@/components/ui/chrome";
import PostComposer from "@/components/social/PostComposer";
import FeedList from "@/components/social/FeedList";
import type { FeedItemVM } from "@/lib/feed/types";

type Props = {
  focusId?: string | null;
  initialFeedData?: {
    items: FeedItemVM[];
    liveItems: FeedItemVM[];
    nextCursor: string | null;
  };
};

export default function SocialClient({ initialFeedData, focusId }: Props) {

  const [composerOpen, setComposerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="min-h-screen px-4 pb-[env(safe-area-inset-bottom)] text-slate-100">
      <div className="mx-auto w-full max-w-sm">
        {/* A tab root, so it takes a masthead rather than a back button. The feed
            itself keeps its own ordering — live rounds already sort to the top. */}
        <Masthead title="Social" subtitle="Feed · Live rounds · Posts" />

        {/* Feed (includes live rounds at top) */}
        <FeedList refreshKey={refreshKey} initialData={initialFeedData} focusId={focusId ?? null} />
      </div>

      {/* Floating Action Button (Composer hidden by default) */}
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+var(--ciaga-nav-h)+12px)] right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-900/60 bg-[#0b3b21] text-[#f5e6b0] shadow-lg hover:bg-[#0b3b21]/85 active:scale-95"
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
