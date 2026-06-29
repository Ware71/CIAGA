// components/social/CommentSection.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { commentOnFeedItem, fetchComments, toggleCommentLike } from "@/lib/social/api";
import { Button } from "@/components/ui/button";
import MentionInput, { type Mention } from "@/components/social/MentionInput";
import { renderWithMentions } from "@/lib/social/mentions";

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

  // Optional mentions (returned by the comments API) so we can colorize handles.
  mentions?: Array<{ profile_id?: string; name?: string | null }> | null;
};

type Props = {
  feedItemId: string;

  /** Notify parent (card / detail) to update counts / previews immediately. */
  onCommentCreated?: (comment?: { author: string; body: string; like_count: number; created_at: string }) => void;

  /** Open the @-mention suggestion panel above or below the composer. */
  mentionDirection?: "up" | "down";

  /** Tailwind classes for the scrollable list area (controls height). */
  listClassName?: string;

  className?: string;
};

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function displayAuthorName(c: Comment) {
  return c.author?.display_name ?? c.author?.name ?? "Player";
}

export default function CommentSection({
  feedItemId,
  onCommentCreated,
  mentionDirection = "up",
  listClassName = "max-h-[45vh] overflow-y-auto",
  className,
}: Props) {
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
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
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedItemId]);

  async function send() {
    const trimmed = body.trim();
    if (!trimmed) return;

    setIsSending(true);
    setError(null);

    const createdAt = new Date().toISOString();
    const finalMentions = mentions.filter((m) => trimmed.includes(`@${m.name}`));

    const optimistic: Comment = {
      id: `local:${createdAt}`,
      profile_id: "me",
      body: trimmed,
      created_at: createdAt,
      author: { display_name: "You", avatar_url: null },
      is_mine: true,
      like_count: 0,
      i_liked: false,
      mentions: finalMentions.map((m) => ({ profile_id: m.profile_id, name: m.name })),
    };

    try {
      setComments((prev) => [optimistic, ...prev]);
      setBody("");
      setMentions([]);

      onCommentCreated?.({
        author: "You",
        body: trimmed,
        like_count: 0,
        created_at: createdAt,
      });

      await commentOnFeedItem(
        feedItemId,
        trimmed,
        finalMentions.map((m) => m.profile_id),
      );

      void load();
    } catch (e: any) {
      setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      setError(e?.message ?? "Failed to comment");
    } finally {
      setIsSending(false);
    }
  }

  async function likeComment(commentId: string) {
    if (pendingLikesRef.current.has(commentId)) return;
    pendingLikesRef.current.add(commentId);

    const nextSeq = (likeReqSeqRef.current[commentId] ?? 0) + 1;
    likeReqSeqRef.current[commentId] = nextSeq;

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
      }),
    );

    try {
      const res = await toggleCommentLike(commentId);
      if (likeReqSeqRef.current[commentId] === nextSeq) {
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, i_liked: res.liked, like_count: res.count } : c)),
        );
      }
    } catch {
      void load();
    } finally {
      pendingLikesRef.current.delete(commentId);
    }
  }

  return (
    <div className={className}>
      <div className={listClassName + " p-4 space-y-3"}>
        {error ? <div className="text-xs font-semibold text-red-200">{error}</div> : null}

        {isLoading && comments.length === 0 ? (
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

              <div className="mt-2 text-sm font-semibold text-emerald-100/90 whitespace-pre-wrap">
                {renderWithMentions(c.body, c.mentions)}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-emerald-900/70 p-4 space-y-2">
        <div className="text-[11px] font-semibold text-emerald-100/55">{commentCountLabel}</div>
        <MentionInput
          value={body}
          onChange={setBody}
          mentions={mentions}
          onMentionsChange={setMentions}
          dropdownDirection={mentionDirection}
          placeholder="Write a comment… use @ to mention"
          className="w-full min-h-[72px] rounded-md border border-emerald-900/60 bg-emerald-950/10 px-3 py-2 text-base text-emerald-50 outline-none focus:ring-2 focus:ring-emerald-600/40"
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
  );
}
