"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { FeedMedia } from "@/lib/feed/types";

/**
 * Full-screen photo viewer.
 *
 * Renders the `full` variant in a plain <img> — this is the one place the extra
 * bytes are the point, and the browser's own decoder is better at a
 * pinch-to-zoom surface than anything we'd wrap it in.
 */
export default function MediaLightbox({
  media,
  index,
  onClose,
}: {
  media: FeedMedia[];
  /** Null closes the lightbox. */
  index: number | null;
  onClose: () => void;
}) {
  const open = index !== null;
  const [current, setCurrent] = useState(index ?? 0);

  useEffect(() => {
    if (index !== null) setCurrent(index);
  }, [index]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setCurrent((i) => Math.min(media.length - 1, i + 1));
      if (e.key === "ArrowLeft") setCurrent((i) => Math.max(0, i - 1));
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, media.length, onClose]);

  if (typeof document === "undefined") return null;

  const item = media[current];

  return createPortal(
    <AnimatePresence>
      {open && item ? (
        <motion.div
          className="fixed inset-0 z-[70] flex flex-col bg-black/95"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="flex shrink-0 items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+12px)] text-white">
            <span className="text-[length:var(--t-sec)] font-medium tabular-nums">
              {media.length > 1 ? `${current + 1} / ${media.length}` : ""}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          {/* Drag down to dismiss — the gesture people already expect here. */}
          <motion.div
            className="flex min-h-0 flex-1 items-center justify-center px-2"
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.6}
            onDragEnd={(_, info) => {
              if (Math.abs(info.offset.y) > 120) onClose();
            }}
          >
            <img
              key={item.url}
              src={item.url}
              alt=""
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          </motion.div>

          {media.length > 1 ? (
            <div className="flex shrink-0 items-center justify-center gap-6 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-3 text-white">
              <button
                type="button"
                onClick={() => setCurrent((i) => Math.max(0, i - 1))}
                disabled={current === 0}
                className="grid h-11 w-11 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 disabled:opacity-30"
                aria-label="Previous photo"
              >
                <ChevronLeft size={22} />
              </button>
              <button
                type="button"
                onClick={() => setCurrent((i) => Math.min(media.length - 1, i + 1))}
                disabled={current === media.length - 1}
                className="grid h-11 w-11 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 disabled:opacity-30"
                aria-label="Next photo"
              >
                <ChevronRight size={22} />
              </button>
            </div>
          ) : (
            <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" />
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
