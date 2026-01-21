// components/social/FeedCard.tsx
"use client";

import { useMemo, useState } from "react";
import type { FeedItemVM } from "@/lib/feed/types";
import ReactionBar from "@/components/social/ReactionBar";
import CommentDrawer from "@/components/social/CommentDrawer";
import { Button } from "@/components/ui/button";

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - d);

  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

export default function FeedCard({ item }: { item: FeedItemVM }) {
  const [myReaction, setMyReaction] = useState<string | null>(item.aggregates.my_reaction ?? null);
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>(
    item.aggregates.reaction_counts ?? {}
  );

  const [commentCount, setCommentCount] = useState<number>(item.aggregates.comment_count ?? 0);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const headerName = item.actor?.display_name ?? "System";
  const ago = useMemo(() => timeAgo(item.occurred_at), [item.occurred_at]);

  return (
    <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-emerald-50 truncate">{headerName}</div>
          <div className="text-xs font-semibold text-emerald-100/60">{ago} ago</div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full px-3 text-emerald-100 hover:bg-emerald-900/30"
            onClick={() => setCommentsOpen(true)}
          >
            💬 <span className="ml-1 text-xs tabular-nums font-extrabold">{commentCount}</span>
          </Button>
        </div>
      </div>

      <div className="mt-3">
        {item.type === "user_post" ? (
          <UserPostBody payload={item.payload as any} />
        ) : (
          <div className="text-sm font-semibold text-emerald-100/70">
            Unsupported card type: <span className="font-mono text-emerald-50">{item.type}</span>
          </div>
        )}
      </div>

      <div className="mt-4">
        <ReactionBar
          feedItemId={item.id}
          myReaction={myReaction}
          reactionCounts={reactionCounts}
          onChanged={(next) => {
            setMyReaction(next.myReaction);
            if (next.reactionCounts) setReactionCounts(next.reactionCounts);
          }}
        />
      </div>

      <CommentDrawer
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
        feedItemId={item.id}
        onCommentCreated={() => setCommentCount((c) => c + 1)}
      />
    </div>
  );
}

function UserPostBody(props: { payload: { text?: string | null; image_urls?: string[] | null } }) {
  const text = props.payload.text ?? "";
  const images = props.payload.image_urls ?? [];

  return (
    <div className="space-y-3">
      {text ? <div className="whitespace-pre-wrap text-sm font-semibold text-emerald-50/90">{text}</div> : null}

      {Array.isArray(images) && images.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {images.slice(0, 4).map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              className="h-36 w-full rounded-xl object-cover border border-emerald-900/60"
              loading="lazy"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
