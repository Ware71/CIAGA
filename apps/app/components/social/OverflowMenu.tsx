"use client";

import { useEffect, useState } from "react";
import { EyeOff, Flag, Link2, MoreHorizontal, Trash2 } from "lucide-react";
import { Sheet, SheetAction } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/button";
import ReportSheet from "@/components/social/ReportSheet";
import { hideFeedItem } from "@/lib/social/hidden";
import { deleteMyPost } from "@/lib/social/api";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { FeedItemVM } from "@/lib/feed/types";

/**
 * The ··· on a card.
 *
 * An action sheet rather than a dropdown: there is no Radix popover in this
 * project, a hand-positioned menu inside a feed card gets clipped at the screen
 * edge (the same bug the reaction picker had), and a sheet is what a phone user
 * expects from this control anyway.
 */
export default function OverflowMenu({
  item,
  onHidden,
}: {
  item: FeedItemVM;
  onHidden?: (feedItemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMine, setIsMine] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authorProfileId = item.actor?.profile_id ?? null;

  // Resolved on mount, not on open: gated on `open`, "Delete post" popped into
  // an already-visible menu a moment later, which both looks broken and means a
  // quick tap lands before the option exists. getViewerSession() memoises a
  // single in-flight promise, so every card on screen shares one round trip.
  useEffect(() => {
    if (!authorProfileId) return;
    let cancelled = false;
    void getViewerSession().then((session) => {
      if (!cancelled) setIsMine(session?.profileId === authorProfileId);
    });
    return () => {
      cancelled = true;
    };
  }, [authorProfileId]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/social/${item.id}`);
      setCopied(true);
      setTimeout(() => setOpen(false), 600);
    } catch {
      setOpen(false);
    }
  }

  function hide() {
    hideFeedItem(item.id);
    setOpen(false);
    onHidden?.(item.id);
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await deleteMyPost(item.id);
      setOpen(false);
      setConfirmingDelete(false);
      onHidden?.(item.id);
    } catch (e) {
      // Say so. Swallowing this left the menu looking like it had worked while
      // the post was still there.
      setError(e instanceof Error ? e.message : "Couldn't delete that post.");
    } finally {
      setDeleting(false);
    }
  }

  function close() {
    setOpen(false);
    setConfirmingDelete(false);
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[color:var(--sec-muted)] transition hover:bg-[color:var(--sec-surface-2)] hover:text-[color:var(--sec-text)]"
        aria-label="More options"
      >
        <MoreHorizontal size={18} strokeWidth={1.75} />
      </button>

      <Sheet
        open={open}
        onClose={close}
        title={confirmingDelete ? "Delete this post?" : "Options"}
        onBack={confirmingDelete ? () => setConfirmingDelete(false) : undefined}
        maxHeight="60vh"
      >
        {confirmingDelete ? (
          <div className="pb-1">
            <p className="text-[length:var(--t-body)] font-normal leading-[1.45] text-[color:var(--sec-text)]">
              This removes it from everyone&rsquo;s feed, along with its photos. It can&rsquo;t be
              undone.
            </p>

            {error ? (
              <p className="mt-2 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-bad)]">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1 bg-[color:var(--sec-surface)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                Keep it
              </Button>
              <Button
                className="flex-1 bg-[color:var(--sec-bad)] font-medium text-[color:var(--ciaga-ground)] hover:opacity-90"
                onClick={remove}
                pending={deleting}
              >
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col pb-1">
            <SheetAction
              icon={<Link2 size={18} strokeWidth={1.75} />}
              label={copied ? "Link copied" : "Copy link"}
              onClick={copyLink}
            />

            <SheetAction
              icon={<EyeOff size={18} strokeWidth={1.75} />}
              label="Hide this post"
              description="Only on this device"
              onClick={hide}
            />

            <SheetAction
              icon={<Flag size={18} strokeWidth={1.75} />}
              label="Report"
              description="Send it to an admin to review"
              onClick={() => {
                setOpen(false);
                setReportOpen(true);
              }}
            />

            {isMine && item.type === "user_post" ? (
              <SheetAction
                icon={<Trash2 size={18} strokeWidth={1.75} />}
                label="Delete post"
                tone="bad"
                onClick={() => setConfirmingDelete(true)}
              />
            ) : null}
          </div>
        )}
      </Sheet>

      <ReportSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="feed_item"
        targetId={item.id}
      />
    </>
  );
}
