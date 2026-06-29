// components/social/CommentBar.tsx
"use client";

import { useEffect, useState } from "react";
import { fetchComments } from "@/lib/social/api";
import CommentDrawer from "@/components/social/CommentDrawer";
import { renderWithMentions } from "@/lib/social/mentions";

type PreviewComment = {
  id: string;
  body: string;
  author?: { display_name?: string; name?: string };
  mentions?: Array<{ name?: string | null }> | null;
};

/**
 * Always-visible comments area docked to the bottom ~1/5 of the detail page.
 * Shows the latest comment(s) + an "Add a comment…" row; tapping opens the
 * full drawer (reuses CommentDrawer → CommentSection).
 */
export default function CommentBar({ feedItemId }: { feedItemId: string }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<PreviewComment[]>([]);
  const [count, setCount] = useState(0);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchComments(feedItemId, 50);
        if (cancelled) return;
        const list = ((res.comments as any[]) ?? []) as PreviewComment[];
        setCount(list.length);
        setComments(list.slice(0, 2)); // API returns newest first
      } catch {
        // ignore — bar still lets you open the drawer
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feedItemId, refresh]);

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-emerald-900/70 bg-[#04220f]/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
        <button type="button" onClick={() => setOpen(true)} className="mx-auto block w-full max-w-sm text-left">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-100/55">
              Comments{count ? ` · ${count}` : ""}
            </div>
            <span className="text-[11px] font-semibold text-emerald-100/40">Tap to open ›</span>
          </div>

          <div className="mt-1 max-h-[11vh] space-y-1 overflow-hidden">
            {comments.length ? (
              comments.map((c) => (
                <div key={c.id} className="truncate text-[12px] text-emerald-50/90">
                  <span className="font-extrabold">{c.author?.display_name ?? c.author?.name ?? "Player"}</span>{" "}
                  <span className="text-emerald-100/80">{renderWithMentions(c.body, c.mentions)}</span>
                </div>
              ))
            ) : (
              <div className="text-[12px] font-semibold text-emerald-100/50">No comments yet — say something.</div>
            )}
          </div>

          <div className="mt-1.5 rounded-full border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-[12px] font-semibold text-emerald-100/45">
            Add a comment…
          </div>
        </button>
      </div>

      <CommentDrawer
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setRefresh((x) => x + 1);
        }}
        feedItemId={feedItemId}
        onCommentCreated={() => setRefresh((x) => x + 1)}
      />
    </>
  );
}
