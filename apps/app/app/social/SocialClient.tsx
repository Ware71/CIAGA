"use client";

import { Suspense, use, useState } from "react";
import { Plus, X } from "lucide-react";
import { PageHeader } from "@/components/ui/chrome";
import PostComposer from "@/components/social/PostComposer";
import FeedList from "@/components/social/FeedList";
import FeedSkeleton from "@/components/social/FeedSkeleton";
import type { FeedItemVM } from "@/lib/feed/types";

export type InitialFeedData = {
  items: FeedItemVM[];
  liveItems: FeedItemVM[];
  nextCursor: string | null;
};

type Props = {
  focusId?: string | null;
  initialFeedPromise: Promise<InitialFeedData>;
};

/**
 * Unwraps the streamed first page. Kept separate so the Suspense boundary sits
 * *below* the header — suspending in SocialClient itself would hold the whole
 * screen back, which is the thing we're trying to stop doing.
 */
function StreamedFeed({
  promise,
  refreshKey,
  focusId,
}: {
  promise: Promise<InitialFeedData>;
  refreshKey: number;
  focusId: string | null;
}) {
  const initialData = use(promise);
  return <FeedList refreshKey={refreshKey} initialData={initialData} focusId={focusId} />;
}

export default function SocialClient({ initialFeedPromise, focusId }: Props) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="min-h-screen px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm">
        {/* A tab root, so it takes a masthead rather than a back button. The feed
            itself keeps its own ordering — live rounds already sort to the top. */}
        <PageHeader title="Social" subtitle="Feed · Live rounds · Posts" />

        <Suspense fallback={<FeedSkeleton />}>
          <StreamedFeed
            promise={initialFeedPromise}
            refreshKey={refreshKey}
            focusId={focusId ?? null}
          />
        </Suspense>
      </div>

      {/* Floating Action Button (Composer hidden by default) */}
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+var(--ciaga-nav-h)+12px)] right-6 z-40 grid h-14 w-14 place-items-center rounded-full border border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] text-[color:var(--sec-accent)] shadow-lg transition hover:bg-[color:color-mix(in_srgb,var(--sec-surface)_85%,transparent)] active:scale-95"
        aria-label="Create post"
        title="Create post"
      >
        <Plus size={24} strokeWidth={2.25} />
      </button>

      {composerOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setComposerOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-[var(--r-ui)] border border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[length:var(--t-body)] font-semibold text-[color:var(--sec-text)]">
                New post
              </div>

              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full text-[color:var(--sec-muted)] transition hover:bg-[color:var(--sec-surface-2)]"
                onClick={() => setComposerOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
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
