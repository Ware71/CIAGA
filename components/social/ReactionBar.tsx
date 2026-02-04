// components/social/ReactionBar.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { reactToFeedItem } from "@/lib/social/api";
import { Button } from "@/components/ui/button";

const QUICK_EMOJIS = ["👍", "🔥", "😂", "😮", "👏", "❤️", "⛳"];

// A bigger list for "More…"
const MORE_EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😍","😘","😮","😯","😲","😳","🤯",
  "😎","🤩","🥳","🤔","🙌","👏","👍","👎","🔥","💯","❤️","🧡","💛","💚","💙","💜",
  "🖤","🤍","🤎","💥","⚡","✨","🌟","🎯","🏆","⛳","🏌️","🏌️‍♂️","🏌️‍♀️","🎉",
  "😤","😭","😡","😱","🤝","🙏","💪","🫡","😴","🤤","🤢","🤮","🤡","💀"
];

type Props = {
  feedItemId: string;
  myReaction: string | null;
  reactionCounts: Record<string, number> | undefined;
  onChanged?: (next: { myReaction: string | null; reactionCounts?: Record<string, number> }) => void;
};

function clampCount(n: number) {
  return Math.max(0, n);
}

function applyOptimisticReaction(params: {
  counts: Record<string, number>;
  prevMy: string | null;
  nextMy: string | null;
}) {
  const { counts, prevMy, nextMy } = params;
  const nextCounts = { ...counts };

  // remove previous
  if (prevMy) {
    nextCounts[prevMy] = clampCount((nextCounts[prevMy] ?? 0) - 1);
    if (nextCounts[prevMy] === 0) delete nextCounts[prevMy];
  }

  // add new
  if (nextMy) {
    nextCounts[nextMy] = (nextCounts[nextMy] ?? 0) + 1;
  }

  return nextCounts;
}

export default function ReactionBar({ feedItemId, myReaction, reactionCounts, onChanged }: Props) {
  const countsProp = reactionCounts ?? {};

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // local optimistic state mirrors props, but can be ahead of server response
  const [localMy, setLocalMy] = useState<string | null>(myReaction ?? null);
  const [localCounts, setLocalCounts] = useState<Record<string, number>>(countsProp);

  // refs to avoid stale closure bugs
  const localMyRef = useRef<string | null>(localMy);
  const localCountsRef = useRef<Record<string, number>>(localCounts);

  useEffect(() => {
    localMyRef.current = localMy;
  }, [localMy]);

  useEffect(() => {
    localCountsRef.current = localCounts;
  }, [localCounts]);

  // keep local in sync if parent updates (eg. pagination reload)
  useEffect(() => {
    setLocalMy(myReaction ?? null);
    setLocalCounts(countsProp);
    // update refs immediately too
    localMyRef.current = myReaction ?? null;
    localCountsRef.current = countsProp;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myReaction, reactionCounts]);

  const total = useMemo(() => {
    return Object.values(localCounts).reduce((acc, n) => acc + (n ?? 0), 0);
  }, [localCounts]);

  const topLine = useMemo(() => {
    const entries = Object.entries(localCounts).filter(([, n]) => (n ?? 0) > 0);
    if (entries.length === 0) return "React";
    return entries
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .slice(0, 3)
      .map(([e, n]) => `${e} ${n}`)
      .join(" · ");
  }, [localCounts]);

  // Close overlay on outside click (within the page)
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;

    const onDocDown = (e: MouseEvent | PointerEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", onDocDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onDocDown, { capture: true } as any);
  }, [open]);

  async function doReact(emoji: string) {
    if (busy) return;

    const prevMy = localMyRef.current;
    const prevCounts = localCountsRef.current;

    const nextMy = prevMy === emoji ? null : emoji;

    // optimistic apply instantly
    const optimisticCounts = applyOptimisticReaction({
      counts: prevCounts,
      prevMy,
      nextMy,
    });

    setLocalMy(nextMy);
    setLocalCounts(optimisticCounts);
    onChanged?.({ myReaction: nextMy, reactionCounts: optimisticCounts });

    setBusy(true);

    try {
      const res = await reactToFeedItem(feedItemId, emoji);

      // server may return:
      //  - { status: "set", emoji }
      //  - { status: "removed", emoji: null }
      // tolerate legacy "cleared"
      const serverMy = res.status === "set" && res.emoji ? res.emoji : null;

      // reconcile against the SAME base (prevCounts), not against current state
      if (serverMy !== nextMy) {
        const reconciledCounts = applyOptimisticReaction({
          counts: prevCounts,
          prevMy,
          nextMy: serverMy,
        });

        setLocalMy(serverMy);
        setLocalCounts(reconciledCounts);
        onChanged?.({ myReaction: serverMy, reactionCounts: reconciledCounts });
      }
    } catch {
      // revert on failure (again: revert against same base)
      const revertedCounts = applyOptimisticReaction({
        counts: prevCounts,
        prevMy,
        nextMy: prevMy,
      });

      setLocalMy(prevMy);
      setLocalCounts(revertedCounts);
      onChanged?.({ myReaction: prevMy, reactionCounts: revertedCounts });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  const triggerEmoji = localMy ?? "😊";

  return (
    <div className="relative" ref={rootRef}>
      {/* Trigger button (compact) */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={[
          "rounded-full px-2",
          localMy ? "text-[#f5e6b0] hover:bg-emerald-900/25" : "text-emerald-100/80 hover:bg-emerald-900/25",
        ].join(" ")}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="React"
        title="React"
      >
        {triggerEmoji} <span className="ml-1 text-xs tabular-nums font-extrabold">{total}</span>
      </Button>

      {/* Overlay */}
      {open ? (
        <div
          className="absolute right-0 mt-2 w-[280px] rounded-2xl border border-emerald-900/70 bg-[#062a18] p-3 shadow-xl z-50"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 text-[11px] font-semibold text-emerald-100/70">{topLine}</div>

          {/* Quick row */}
          <div className="flex flex-wrap gap-2">
            {QUICK_EMOJIS.map((emoji) => {
              const selected = localMy === emoji;

              return (
                <button
                  key={emoji}
                  type="button"
                  disabled={busy}
                  onClick={() => doReact(emoji)}
                  className={[
                    "h-9 min-w-[42px] rounded-full border px-3 text-sm font-extrabold transition",
                    selected
                      ? "border-[#f5e6b0]/60 bg-[#f5e6b0] text-[#042713]"
                      : "border-emerald-900/60 bg-emerald-900/25 text-emerald-50 hover:bg-emerald-900/40",
                    busy ? "opacity-60" : "",
                  ].join(" ")}
                  aria-label={`React ${emoji}`}
                  title={emoji}
                >
                  <span className="mr-1">{emoji}</span>
                  <span className="text-[11px] tabular-nums font-extrabold">{localCounts[emoji] ?? 0}</span>
                </button>
              );
            })}

            {/* More */}
            <MoreEmojiButton
              disabled={busy}
              onPick={(emoji) => doReact(emoji)}
              selected={localMy}
              counts={localCounts}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MoreEmojiButton(props: {
  disabled: boolean;
  onPick: (emoji: string) => void;
  selected: string | null;
  counts: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => setOpen((v) => !v)}
        className={[
          "h-9 rounded-full border px-3 text-sm font-extrabold transition",
          "border-emerald-900/60 bg-emerald-900/25 text-emerald-50 hover:bg-emerald-900/40",
          props.disabled ? "opacity-60" : "",
        ].join(" ")}
        aria-label="More reactions"
        title="More reactions"
      >
        More…
      </button>

      {open ? (
        <div
          className="absolute right-0 mt-2 w-[280px] rounded-2xl border border-emerald-900/70 bg-[#062a18] p-3 shadow-xl z-50"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold text-emerald-100/70">Pick a reaction</div>
            <button
              type="button"
              className="rounded-full px-2 py-1 text-emerald-100/80 hover:bg-emerald-900/30 text-xs font-extrabold"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          <div className="max-h-[180px] overflow-auto pr-1">
            <div className="grid grid-cols-8 gap-2">
              {MORE_EMOJIS.map((emoji) => {
                const selected = props.selected === emoji;

                return (
                  <button
                    key={emoji}
                    type="button"
                    disabled={props.disabled}
                    onClick={() => {
                      props.onPick(emoji);
                      setOpen(false);
                    }}
                    className={[
                      "h-9 w-9 rounded-lg border text-lg leading-none flex items-center justify-center",
                      selected
                        ? "border-[#f5e6b0]/60 bg-[#f5e6b0] text-[#042713]"
                        : "border-emerald-900/60 bg-emerald-900/20 hover:bg-emerald-900/35 text-emerald-50",
                      props.disabled ? "opacity-60" : "",
                    ].join(" ")}
                    aria-label={`React ${emoji}`}
                    title={emoji}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
