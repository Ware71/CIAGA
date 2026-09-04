// components/social/CommentSection.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Flag, ThumbsUp } from "lucide-react";
import { commentOnFeedItem, fetchComments, toggleCommentLike } from "@/lib/social/api";
import { Button } from "@/components/ui/button";
import MentionInput, { type Mention } from "@/components/social/MentionInput";
import ReactorsSheet from "@/components/social/ReactorsSheet";
import ReportSheet from "@/components/social/ReportSheet";
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

  /** Comment id whose likers sheet is open. */
  const [likersFor, setLikersFor] = useState<string | null>(null);
  /** Comment id being reported. */
  const [reportFor, setReportFor] = useState<string | null>(null);

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
      <div className={listClassName + " px-4 py-2"}>
        {error ? (
          <div className="py-2 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-bad)]">
            {error}
          </div>
        ) : null}

        {isLoading && comments.length === 0 ? (
          <div className="py-3 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
            Loading comments…
          </div>
        ) : comments.length === 0 ? (
          <div className="py-3 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
            No comments yet.
          </div>
        ) : (
          <div className="flex flex-col">
            {comments.map((c) => (
              <div
                key={c.id}
                className="border-b border-[color:var(--hair)] py-2.5 last:border-b-0"
              >
                <div className="flex items-start gap-2.5">
                  {c.author?.avatar_url ? (
                    <img
                      src={c.author.avatar_url}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-full border border-[color:var(--hair-panel)] object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] text-[length:var(--t-sec)] font-medium text-[color:var(--sec-text)]">
                      {displayAuthorName(c).slice(0, 1).toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[length:var(--t-body)] font-medium text-[color:var(--sec-text)]">
                        {displayAuthorName(c)}
                      </span>
                      <span className="shrink-0 text-[length:var(--t-label)] font-normal text-[color:var(--sec-muted)]">
                        {formatWhen(c.created_at)}
                      </span>
                    </div>

                    <div className="mt-0.5 whitespace-pre-wrap text-[length:var(--t-body)] font-normal leading-[1.45] text-[color:var(--sec-text)]">
                      {renderWithMentions(c.body, c.mentions)}
                    </div>

                    <div className="mt-1.5 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void likeComment(c.id);
                        }}
                        disabled={pendingLikesRef.current.has(c.id)}
                        className={[
                          "flex items-center gap-1 rounded-full px-2 py-1 text-[length:var(--t-sec)] font-medium transition",
                          "hover:bg-[color:var(--sec-surface-2)]",
                          c.i_liked
                            ? "text-[color:var(--sec-accent)]"
                            : "text-[color:var(--sec-muted)]",
                        ].join(" ")}
                        aria-pressed={!!c.i_liked}
                        aria-label={c.i_liked ? "Remove your like" : "Like this comment"}
                      >
                        <ThumbsUp
                          size={14}
                          strokeWidth={1.75}
                          fill={c.i_liked ? "currentColor" : "none"}
                        />
                        Like
                      </button>

                      {(c.like_count ?? 0) > 0 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLikersFor(c.id);
                          }}
                          className="rounded-full px-2 py-1 text-[length:var(--t-sec)] font-normal tabular-nums text-[color:var(--sec-muted)] transition hover:text-[color:var(--sec-text-2)]"
                        >
                          {c.like_count}
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReportFor(c.id);
                        }}
                        className="ml-auto rounded-full px-2 py-1 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)] transition hover:bg-[color:var(--sec-surface-2)] hover:text-[color:var(--sec-text)]"
                        aria-label="Report this comment"
                      >
                        <Flag size={14} strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ReactorsSheet
        open={likersFor !== null}
        onClose={() => setLikersFor(null)}
        target={{ kind: "comment", id: likersFor ?? "" }}
      />

      <ReportSheet
        open={reportFor !== null}
        onClose={() => setReportFor(null)}
        targetType="comment"
        targetId={reportFor ?? ""}
      />

      <div className="space-y-2 border-t border-[color:var(--hair)] p-4">
        <div className="text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
          {commentCountLabel}
        </div>
        <MentionInput
          value={body}
          onChange={setBody}
          mentions={mentions}
          onMentionsChange={setMentions}
          dropdownDirection={mentionDirection}
          placeholder="Write a comment… use @ to mention"
          className="w-full min-h-[72px] rounded-[var(--r-ui)] border border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] px-3 py-2 text-[length:var(--t-body)] font-normal text-[color:var(--sec-text)] placeholder:text-[color:var(--sec-muted)] outline-none focus:ring-2 focus:ring-[color:var(--sec-accent)]"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void send();
            }}
            disabled={!body.trim()}
            pending={isSending}
            className="bg-[color:var(--sec-accent)] font-medium text-[color:var(--ciaga-ground)] hover:bg-[color:color-mix(in_srgb,var(--sec-accent)_90%,transparent)]"
          >
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
