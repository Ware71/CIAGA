// components/social/FeedList.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchFeed, fetchLiveFeedItems } from "@/lib/social/api";
import type { FeedItemVM } from "@/lib/feed/types";
import FeedCard from "@/components/social/FeedCard";
import { Button } from "@/components/ui/button";

type Props = {
  refreshKey?: number;
};

function sortByOccurredAtDesc(a: FeedItemVM, b: FeedItemVM) {
  const ta = Date.parse(a.occurred_at ?? a.created_at ?? "");
  const tb = Date.parse(b.occurred_at ?? b.created_at ?? "");

  const aTime = Number.isFinite(ta) ? ta : 0;
  const bTime = Number.isFinite(tb) ? tb : 0;

  if (bTime !== aTime) return bTime - aTime;

  if (a.id < b.id) return 1;
  if (a.id > b.id) return -1;
  return 0;
}

export default function FeedList({ refreshKey }: Props) {
  const [items, setItems] = useState<FeedItemVM[]>([]);
  const [liveItems, setLiveItems] = useState<FeedItemVM[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadInitial() {
    setIsLoading(true);
    setError(null);

    try {
      const [liveRes, feedRes] = await Promise.all([fetchLiveFeedItems(), fetchFeed({ limit: 20 })]);

      setLiveItems((liveRes.items as FeedItemVM[]) ?? []);
      setItems((feedRes.items as FeedItemVM[]) ?? []);
      setNextCursor(feedRes.next_cursor);
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
  }, [refreshKey]);

  const combined = useMemo(() => {
    const liveRoundIds = new Set<string>();

    for (const li of liveItems) {
      if (li.type === "round_played") {
        const rid = (li.payload as any)?.round_id as string | undefined;
        if (rid) liveRoundIds.add(rid);
      }
    }

    const filteredFeed = items.filter((it) => {
      if (it.type !== "round_played") return true;
      const rid = (it.payload as any)?.round_id as string | undefined;
      if (!rid) return true;
      return !liveRoundIds.has(rid);
    });

    const sortedLive = [...liveItems].sort(sortByOccurredAtDesc);
    const sortedFeed = [...filteredFeed].sort(sortByOccurredAtDesc);

    return [...sortedLive, ...sortedFeed];
  }, [liveItems, items]);

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

      {combined.length === 0 ? (
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-6 text-sm font-semibold text-emerald-100/70">
          No activity yet. Be the first to post.
        </div>
      ) : null}

      {combined.map((item) => (
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
