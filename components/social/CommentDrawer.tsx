// components/social/CommentDrawer.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { commentOnFeedItem, fetchComments, toggleCommentLike } from "@/lib/social/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Comment = {
  id: string;
  profile_id: string;
  body: string;
  created_at: string;

  // tolerate both legacy + new author keys
  author: {
    id?: string;
    name?: string;
    profile_id?: string;
    display_name?: string;
    avatar_url: string | null;
  };

  is_mine: boolean;
  like_count?: number;
  i_liked?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedItemId: string;

  /**
   * Optional callback for parent (FeedCard) to update counts / previews immediately.
   * Backwards compatible: callers can ignore the argument.
   */
  onCommentCreated?: (comment?: { author: string; body: string; like_count: number; created_at: string }) => void;
};

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function displayAuthorName(c: Comment) {
  return c.author?.display_name ?? c.author?.name ?? "Player";
}

export default function CommentDrawer({ open, onOpenChange, feedItemId, onCommentCreated }: Props) {
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);

  // Prevent race conditions from double taps / slow network:
  const pendingLikesRef = useRef<Set<string>>(new Set());
  const likeReqSeqRef = useRef<Record<string, number>>({});

  const commentCountLabel = useMemo(() => {
    const n = comments.length;
    if (n === 0) return "No comments";
    if (n === 1) return "1 comment";
    return `${n} comments`;
  }, [comments.length]);

  async function load(signal?: { cancelled: boolean }) {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetchComments(feedItemId, 100);
      if (signal?.cancelled) return;

      // Ensure defaults so UI never flickers between undefined/0
      const normalized = ((res.comments as any[]) ?? []).map((c) => ({
        ...c,
        like_count: typeof c.like_count === "number" ? c.like_count : 0,
        i_liked: !!c.i_liked,
      }));

      setComments(normalized);
    } catch (e: any) {
      if (signal?.cancelled) return;
      setError(e?.message ?? "Failed to load comments");
    } finally {
      if (!signal?.cancelled) setIsLoading(false);
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };

    if (open) {
      void load(signal);
    }

    return () => {
      signal.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, feedItemId]);

  async function send() {
    const trimmed = body.trim();
    if (!trimmed) return;

    setIsSending(true);
    setError(null);

    // Optimistic local comment (so drawer + preview can update instantly)
    const createdAt = new Date().toISOString();
    const optimistic: Comment = {
      id: `local:${createdAt}`,
      profile_id: "me",
      body: trimmed,
      created_at: createdAt,
      author: { display_name: "You", avatar_url: null },
      is_mine: true,
      like_count: 0,
      i_liked: false,
    };

    try {
      // Optimistically prepend immediately
      setComments((prev) => [optimistic, ...prev]);
      setBody("");

      // Let parent update "top comment preview" immediately
      onCommentCreated?.({
        author: "You",
        body: trimmed,
        like_count: 0,
        created_at: createdAt,
      });

      // Send to server
      await commentOnFeedItem(feedItemId, trimmed);

      // Sync from server (don’t block UI waiting)
      void load();
    } catch (e: any) {
      // Roll back optimistic insert if post fails
      setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      setError(e?.message ?? "Failed to comment");
    } finally {
      setIsSending(false);
    }
  }

  async function likeComment(commentId: string) {
    // Guard: prevent double-click races
    if (pendingLikesRef.current.has(commentId)) return;
    pendingLikesRef.current.add(commentId);

    // Sequence number per comment so old responses can’t overwrite new state
    const nextSeq = (likeReqSeqRef.current[commentId] ?? 0) + 1;
    likeReqSeqRef.current[commentId] = nextSeq;

    // optimistic toggle
    setComments((prev) =>
      prev.map((c) => {
        if (c.id !== commentId) return c;
        const iLiked = !!c.i_liked;
        const likeCount = typeof c.like_count === "number" ? c.like_count : 0;
        return {
          ...c,
          i_liked: !iLiked,
          like_count: Math.max(0, likeCount + (iLiked ? -1 : 1)),
        };
      })
    );

    try {
      const res = await toggleCommentLike(commentId);

      // Only apply if this is the latest request for that comment
      if (likeReqSeqRef.current[commentId] === nextSeq) {
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, i_liked: res.liked, like_count: res.count } : c))
        );
      }
    } catch {
      // safest recovery: reload
      void load();
    } finally {
      pendingLikesRef.current.delete(commentId);
    }
  }

  // Render a stable shell; hide when closed
  if (!open) {
    return <div className="hidden" aria-hidden="true" />;
  }

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(false);
        }}
      />

      <div
        className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-hidden rounded-t-2xl border border-emerald-900/70 bg-[#042713] shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-emerald-900/70 p-4">
          <div>
            <div className="text-sm font-extrabold text-emerald-50">Comments</div>
            <div className="text-[11px] font-semibold text-emerald-100/55">{commentCountLabel}</div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                void load();
              }}
              disabled={isLoading}
              className="bg-emerald-900/40 text-emerald-50 hover:bg-emerald-900/55"
            >
              {isLoading ? "Loading…" : "Refresh"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onOpenChange(false);
              }}
              className="text-emerald-100 hover:bg-emerald-900/30"
            >
              Close
            </Button>
          </div>
        </div>

        <div className="max-h-[45vh] overflow-y-auto p-4 space-y-3">
          {error ? <div className="text-xs font-semibold text-red-200">{error}</div> : null}

          {isLoading ? (
            <div className="text-sm font-semibold text-emerald-100/70">Loading comments…</div>
          ) : comments.length === 0 ? (
            <div className="text-sm font-semibold text-emerald-100/70">No comments yet.</div>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/60 p-3">
                <div className="flex items-center gap-2">
                  {c.author?.avatar_url ? (
                    <img
                      src={c.author.avatar_url}
                      alt=""
                      className="h-7 w-7 rounded-full object-cover border border-emerald-900/60"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-7 w-7 rounded-full border border-emerald-900/60 bg-emerald-950/20" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-emerald-50 truncate">{displayAuthorName(c)}</div>
                    <div className="text-[10px] font-semibold text-emerald-100/55">{formatWhen(c.created_at)}</div>
                  </div>

                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-emerald-100 hover:bg-emerald-900/30"
                      onClick={(e) => {
                        e.stopPropagation();
                        void likeComment(c.id);
                      }}
                      disabled={pendingLikesRef.current.has(c.id)}
                    >
                      👍 {typeof c.like_count === "number" ? c.like_count : 0}
                      {c.i_liked ? " (You)" : ""}
                    </Button>
                  </div>
                </div>

                <div className="mt-2 text-sm font-semibold text-emerald-100/90 whitespace-pre-wrap">{c.body}</div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-emerald-900/70 p-4 space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a comment…"
            className="min-h-[90px] bg-emerald-950/10 text-emerald-50 border-emerald-900/60"
          />
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                void send();
              }}
              disabled={isSending || !body.trim()}
              className="bg-emerald-900/40 text-emerald-50 hover:bg-emerald-900/55"
            >
              {isSending ? "Sending…" : "Comment"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
