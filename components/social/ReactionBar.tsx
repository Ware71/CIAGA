// components/social/ReactionBar.tsx
"use client";

import { useMemo, useState } from "react";
import { reactToFeedItem } from "@/lib/social/api";
import { Button } from "@/components/ui/button";

const DEFAULT_EMOJIS = ["👍", "🔥", "😂", "😮", "👏", "❤️", "⛳"];

type Props = {
  feedItemId: string;
  myReaction: string | null;
  reactionCounts: Record<string, number> | undefined;
  onChanged?: (next: { myReaction: string | null; reactionCounts?: Record<string, number> }) => void;
};

export default function ReactionBar({ feedItemId, myReaction, reactionCounts, onChanged }: Props) {
  const [isLoading, setIsLoading] = useState(false);

  const counts = reactionCounts ?? {};
  const hasAny = useMemo(() => Object.values(counts).some((n) => (n ?? 0) > 0), [counts]);

  async function handleReact(emoji: string) {
    if (isLoading) return;
    setIsLoading(true);

    try {
      const res = await reactToFeedItem(feedItemId, emoji);

      const nextCounts = { ...counts };

      if (myReaction) {
        nextCounts[myReaction] = Math.max(0, (nextCounts[myReaction] ?? 0) - 1);
        if (nextCounts[myReaction] === 0) delete nextCounts[myReaction];
      }

      if (res.status === "set" && res.emoji) {
        nextCounts[res.emoji] = (nextCounts[res.emoji] ?? 0) + 1;
      }

      onChanged?.({
        myReaction: res.emoji,
        reactionCounts: nextCounts,
      });
    } catch {
      // swallow
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {DEFAULT_EMOJIS.map((emoji) => {
          const selected = myReaction === emoji;

          return (
            <Button
              key={emoji}
              type="button"
              variant="secondary"
              size="sm"
              disabled={isLoading}
              onClick={() => handleReact(emoji)}
              className={[
                "rounded-full px-3 font-extrabold",
                selected
                  ? "bg-[#f5e6b0] text-[#042713] hover:bg-[#f5e6b0]/90"
                  : "bg-emerald-900/40 text-emerald-50 hover:bg-emerald-900/55",
              ].join(" ")}
            >
              <span className="mr-1">{emoji}</span>
              <span className="text-xs tabular-nums">{counts[emoji] ?? 0}</span>
            </Button>
          );
        })}
      </div>

      {hasAny ? (
        <div className="text-xs font-semibold text-emerald-100/60">
          {Object.entries(counts)
            .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
            .slice(0, 3)
            .map(([e, n]) => `${e} ${n}`)
            .join(" · ")}
        </div>
      ) : (
        <div className="text-xs font-semibold text-emerald-100/60">React</div>
      )}
    </div>
  );
}
