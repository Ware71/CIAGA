// components/social/FeedList.tsx
"use client";

import { useEffect, useState } from "react";
import { fetchFeed } from "@/lib/social/api";
import type { FeedItemVM } from "@/lib/feed/types";
import FeedCard from "@/components/social/FeedCard";
import { Button } from "@/components/ui/button";

export default function FeedList() {
  const [items, setItems] = useState<FeedItemVM[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadInitial() {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetchFeed({ limit: 20 });
      setItems(res.items as FeedItemVM[]);
      setNextCursor(res.next_cursor);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load feed");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || isLoadingMore) return;

    setIsLoadingMore(true);
    setError(null);

    try {
      const res = await fetchFeed({ cursor: nextCursor, limit: 20 });
      const nextItems = (res.items as FeedItemVM[]) ?? [];
      setItems((prev) => [...prev, ...nextItems]);
      setNextCursor(res.next_cursor);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load more");
    } finally {
      setIsLoadingMore(false);
    }
  }

  useEffect(() => {
    void loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return <div className="text-sm font-semibold text-emerald-100/70">Loading feed…</div>;
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm font-semibold text-red-200">
          {error}
          <div className="mt-3">
            <Button
              variant="secondary"
              className="bg-emerald-900/40 text-emerald-50 hover:bg-emerald-900/55"
              onClick={loadInitial}
            >
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-6 text-sm font-semibold text-emerald-100/70">
          No activity yet. Be the first to post.
        </div>
      ) : null}

      {items.map((item) => (
        <FeedCard key={item.id} item={item} />
      ))}

      <div className="flex justify-center">
        {nextCursor ? (
          <Button
            variant="secondary"
            className="bg-emerald-900/40 text-emerald-50 hover:bg-emerald-900/55"
            onClick={loadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? "Loading…" : "Load more"}
          </Button>
        ) : (
          <div className="text-xs font-semibold text-emerald-100/60">You’re all caught up.</div>
        )}
      </div>
    </div>
  );
}
