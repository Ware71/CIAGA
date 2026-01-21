// components/social/CommentDrawer.tsx
"use client";

import { useEffect, useState } from "react";
import { commentOnFeedItem, fetchComments } from "@/lib/social/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Comment = {
  id: string;
  profile_id: string;
  body: string;
  created_at: string;
  author: { id: string; name: string; avatar_url: string | null };
  is_mine: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedItemId: string;
  onCommentCreated?: () => void;
};

export default function CommentDrawer({ open, onOpenChange, feedItemId, onCommentCreated }: Props) {
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchComments(feedItemId, 100);
      setComments(res.comments as Comment[]);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load comments");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, feedItemId]);

  if (!open) return null;

  async function send() {
    const trimmed = body.trim();
    if (!trimmed) return;

    setIsSending(true);
    setError(null);

    try {
      await commentOnFeedItem(feedItemId, trimmed);
      setBody("");
      onCommentCreated?.();
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Failed to comment");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />

      <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-hidden rounded-t-2xl border border-emerald-900/70 bg-[#042713] shadow-lg">
        <div className="flex items-center justify-between border-b border-emerald-900/70 p-4">
          <div>
            <div className="text-sm font-extrabold text-emerald-50">Comments</div>
            <div className="text-[11px] font-semibold text-emerald-100/55">On this post</div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={load}
              disabled={isLoading}
              className="bg-emerald-900/40 text-emerald-50 hover:bg-emerald-900/55"
            >
              {isLoading ? "Loading…" : "Refresh"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
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
              <div key={c.id} className="rounded-xl border border-emerald-900/70 bg-[#0b3b21]/70 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-extrabold text-emerald-50">{c.author?.name ?? "Player"}</div>
                  {c.is_mine ? <div className="text-xs font-semibold text-emerald-100/60">You</div> : null}
                </div>
                <div className="mt-1 text-sm font-semibold text-emerald-50/90 whitespace-pre-wrap">{c.body}</div>
                <div className="mt-1 text-xs font-semibold text-emerald-100/55">
                  {new Date(c.created_at).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-emerald-900/70 p-4 space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a comment…"
            className="min-h-[90px] bg-[#0b3b21]/70 border-emerald-900/70 text-emerald-50 placeholder:text-emerald-100/40"
          />

          <div className="flex justify-end">
            <Button
              onClick={send}
              disabled={isSending || body.trim().length === 0}
              className="bg-[#f5e6b0] text-[#042713] hover:bg-[#f5e6b0]/90 font-extrabold"
            >
              {isSending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
