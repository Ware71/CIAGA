"use client";

import React, { useCallback, useEffect, useState } from "react";
import { fetchProfileFeed } from "@/lib/social/api";
import type { FeedItemVM } from "@/lib/feed/types";
import FeedCard from "@/components/social/FeedCard";
import { Button } from "@/components/ui/button";

type SortOption = "newest" | "oldest" | "most_interacted";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "most_interacted", label: "Most Interacted" },
];

type Props = {
  profileId: string;
};

export default function ProfileFeedTab({ profileId }: Props) {
  const [items, setItems] = useState<FeedItemVM[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("newest");

  const loadInitial = useCallback(async (sortValue: SortOption) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchProfileFeed({
        profileId,
        limit: 20,
        sort: sortValue,
      });
      setItems((res.items as FeedItemVM[]) ?? []);
      setNextCursor(res.next_cursor);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load feed");
    } finally {
      setIsLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    loadInitial(sort);
  }, [sort, loadInitial]);

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await fetchProfileFeed({
        profileId,
        limit: 20,
        cursor: nextCursor,
        sort,
      });
      setItems((prev) => [...prev, ...((res.items as FeedItemVM[]) ?? [])]);
      setNextCursor(res.next_cursor);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load more");
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleSortChange = (newSort: SortOption) => {
    if (newSort === sort) return;
    setSort(newSort);
    setItems([]);
    setNextCursor(null);
  };

  return (
    <div className="space-y-3">
      {/* Sort selector */}
      <div className="flex gap-1.5 px-1">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg shrink-0 whitespace-nowrap transition-colors ${
              sort === opt.value
                ? "bg-[#f5e6b0] text-[#042713]"
                : "text-emerald-100/80 hover:bg-emerald-900/20"
            }`}
            onClick={() => handleSortChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
          Loading feed...
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-100">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && items.length === 0 && (
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/70">
          No feed activity yet.
        </div>
      )}

      {/* Feed items */}
      {!isLoading && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}

          {nextCursor && (
            <div className="flex justify-center py-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-emerald-100 hover:bg-emerald-900/20"
                onClick={loadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
