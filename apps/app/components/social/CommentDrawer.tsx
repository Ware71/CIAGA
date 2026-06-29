// components/social/CommentDrawer.tsx
"use client";

import CommentSection from "@/components/social/CommentSection";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedItemId: string;

  /** Optional callback for parent (FeedCard) to update counts / previews immediately. */
  onCommentCreated?: (comment?: { author: string; body: string; like_count: number; created_at: string }) => void;
};

/**
 * Modal bottom-sheet wrapper around the shared CommentSection.
 * (FeedCard uses this until Phase C routes comments to the detail page instead.)
 */
export default function CommentDrawer({ open, onOpenChange, feedItemId, onCommentCreated }: Props) {
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
          <div className="text-sm font-extrabold text-emerald-50">Comments</div>
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

        <CommentSection
          feedItemId={feedItemId}
          onCommentCreated={onCommentCreated}
          mentionDirection="up"
          listClassName="max-h-[45vh] overflow-y-auto"
        />
      </div>
    </div>
  );
}
