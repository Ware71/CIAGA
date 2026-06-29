// components/social/FeedList.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchFeed, fetchFeedItem } from "@/lib/social/api";
import type { FeedItemVM } from "@/lib/feed/types";
import FeedCard from "@/components/social/FeedCard";
import { Button } from "@/components/ui/button";
import { sortByOccurredAtDesc, scoreNonLiveItems, isLiveItem } from "@/lib/feed/feedItemUtils";
import { getSeen, markSeen } from "@/lib/social/seen";

type Props = {
  refreshKey?: number;
  /** When set, this feed-item id is pinned/highlighted at the very top. */
  focusId?: string | null;
  initialData?: {
    items: FeedItemVM[];
    liveItems: FeedItemVM[];
    nextCursor: string | null;
  };
};

/** Marks the wrapped card as "seen" once it scrolls ~halfway into view. */
function SeenCard({ item, highlight }: { item: FeedItemVM; highlight?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || isLiveItem(item)) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            markSeen([item.id]);
            obs.disconnect();
            break;
          }
        }
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [item.id]);

  return (
    <div ref={ref} className={highlight ? "rounded-2xl ring-2 ring-[#f5e6b0]/70" : undefined}>
      <FeedCard item={item} />
    </div>
  );
}

function CaughtUpDivider() {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-emerald-900/60" />
      <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-100/45">
        You&rsquo;re all caught up
      </div>
      <div className="h-px flex-1 bg-emerald-900/60" />
    </div>
  );
}

export default function FeedList({ refreshKey, focusId, initialData }: Props) {
  const [items, setItems] = useState<FeedItemVM[]>(initialData?.items ?? []);
  const [liveItems, setLiveItems] = useState<FeedItemVM[]>(initialData?.liveItems ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initialData?.nextCursor ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seen snapshot + the set of ids in the initial load — captured once on mount
  // so the unseen/seen partition is stable for the session (cards don't jump).
  const [seenSnapshot, setSeenSnapshot] = useState<Set<string> | null>(null);
  const [initialIds, setInitialIds] = useState<Set<string> | null>(null);

  // The deep-linked card, pinned to the top — fetched separately if it isn't
  // already in the loaded page.
  const [focusFetched, setFocusFetched] = useState<FeedItemVM | null>(null);
  useEffect(() => {
    if (!focusId || items.some((it) => it.id === focusId)) {
      setFocusFetched(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchFeedItem(focusId);
        if (!cancelled) setFocusFetched((res.item as FeedItemVM) ?? null);
      } catch {
        if (!cancelled) setFocusFetched(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusId, items]);

  const focusItem = useMemo(
    () => items.find((it) => it.id === focusId) ?? focusFetched,
    [items, focusId, focusFetched],
  );

  async function loadInitial() {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetchFeed({ limit: 20, include_live: true });
      setItems((res.items as FeedItemVM[]) ?? []);
      setLiveItems((res.live_items as FeedItemVM[]) ?? []);
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
    // Skip initial fetch when server-provided data exists (refreshKey=0 means first mount)
    if (initialData && refreshKey === 0) return;
    void loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Capture the seen snapshot + initial id set once, after mount (client-only).
  useEffect(() => {
    if (seenSnapshot) return;
    if (!items.length && !liveItems.length) return;
    setSeenSnapshot(getSeen());
    setInitialIds(new Set(items.map((it) => it.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, liveItems]);

  const { live, unseen, seen } = useMemo(() => {
    const now = Date.now();

    const liveRoundIds = new Set<string>();
    for (const li of liveItems) {
      if (li.type === "round_played") {
        const rid = (li.payload as any)?.round_id as string | undefined;
        if (rid) liveRoundIds.add(rid);
      }
    }

    const filteredFeed = items.filter((it) => {
      if (it.id === focusId) return false; // pinned separately
      if (it.type !== "round_played") return true;
      const rid = (it.payload as any)?.round_id as string | undefined;
      if (!rid) return true;
      return !liveRoundIds.has(rid);
    });

    const sortedLive = [...liveItems].sort(sortByOccurredAtDesc);

    // Before the client snapshot exists, render plain chronological.
    if (!seenSnapshot || !initialIds) {
      return { live: sortedLive, unseen: [] as FeedItemVM[], seen: [...filteredFeed].sort(sortByOccurredAtDesc) };
    }

    // Unseen = part of the initial window AND not previously seen.
    // Everything else (initial-but-seen + all paginated) goes below the divider.
    const unseenItems = filteredFeed.filter((it) => initialIds.has(it.id) && !seenSnapshot.has(it.id));
    const belowItems = filteredFeed.filter((it) => !(initialIds.has(it.id) && !seenSnapshot.has(it.id)));

    const scored = scoreNonLiveItems(unseenItems, now);
    const scoreById = new Map(scored.map((s) => [s.it.id, s.baseScore]));
    const unseenOrdered = [...unseenItems].sort((a, b) => {
      const sa = scoreById.get(a.id) ?? 0;
      const sb = scoreById.get(b.id) ?? 0;
      if (sb !== sa) return sb - sa;
      return sortByOccurredAtDesc(a, b);
    });

    return { live: sortedLive, unseen: unseenOrdered, seen: [...belowItems].sort(sortByOccurredAtDesc) };
  }, [liveItems, items, seenSnapshot, initialIds, focusId]);

  const showDivider = unseen.length > 0 && seen.length > 0;
  const isEmpty = live.length + unseen.length + seen.length === 0 && !focusItem;

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

      {isEmpty ? (
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-6 text-sm font-semibold text-emerald-100/70">
          No activity yet. Be the first to post.
        </div>
      ) : null}

      {/* Pinned / deep-linked card */}
      {focusItem ? <SeenCard key={`focus-${focusItem.id}`} item={focusItem} highlight /> : null}

      {/* Live rounds */}
      {live.map((item) => (
        <FeedCard key={item.id} item={item} />
      ))}

      {/* Unseen first (prioritised) */}
      {unseen.map((item) => (
        <SeenCard key={item.id} item={item} />
      ))}

      {showDivider ? <CaughtUpDivider /> : null}

      {/* Already-seen, chronological */}
      {seen.map((item) => (
        <SeenCard key={item.id} item={item} />
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
          <div className="text-xs font-semibold text-emerald-100/60">That&rsquo;s everything for now.</div>
        )}
      </div>
    </div>
  );
}
