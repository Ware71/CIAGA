// components/social/ReactionBar.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import { reactToFeedItem } from "@/lib/social/api";
import { Sheet } from "@/components/ui/Sheet";

/** The seven that cover most of what gets said about a round. */
export const QUICK_EMOJIS = ["👍", "🔥", "😂", "😮", "👏", "❤️", "⛳"];

/** Everything else, for when one of the seven won't do. */
const MORE_EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😍","😘","😮","😯","😲","😳","🤯",
  "😎","🤩","🥳","🤔","🙌","👏","👍","👎","🔥","💯","❤️","🧡","💛","💚","💙","💜",
  "🖤","🤍","🤎","💥","⚡","✨","🌟","🎯","🏆","⛳","🏌️","🏌️‍♂️","🏌️‍♀️","🎉",
  "😤","😭","😡","😱","🤝","🙏","💪","🫡","😴","🤤","🤢","🤮","🤡","💀",
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

  if (prevMy) {
    nextCounts[prevMy] = clampCount((nextCounts[prevMy] ?? 0) - 1);
    if (nextCounts[prevMy] === 0) delete nextCounts[prevMy];
  }

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
    localMyRef.current = myReaction ?? null;
    localCountsRef.current = countsProp;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myReaction, reactionCounts]);

  async function doReact(emoji: string) {
    if (busy) return;

    const prevMy = localMyRef.current;
    const prevCounts = localCountsRef.current;

    const nextMy = prevMy === emoji ? null : emoji;

    // optimistic apply instantly
    const optimisticCounts = applyOptimisticReaction({ counts: prevCounts, prevMy, nextMy });

    setLocalMy(nextMy);
    setLocalCounts(optimisticCounts);
    onChanged?.({ myReaction: nextMy, reactionCounts: optimisticCounts });

    setBusy(true);
    setOpen(false);

    try {
      const res = await reactToFeedItem(feedItemId, emoji);

      // Server is { status: "set" | "removed", emoji }. Tolerate legacy "cleared".
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
    }
  }

  // A picked emoji that isn't one of the seven still needs a home in the quick
  // row, or the only way to clear it is to choose something else first.
  const quickRow =
    localMy && !QUICK_EMOJIS.includes(localMy) ? [...QUICK_EMOJIS, localMy] : QUICK_EMOJIS;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className={[
          "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--r-ui)] transition",
          "text-[length:var(--t-sec)] font-medium",
          "hover:bg-[color:var(--sec-surface-2)] disabled:opacity-60",
          localMy ? "text-[color:var(--sec-accent)]" : "text-[color:var(--sec-muted)]",
        ].join(" ")}
        aria-label={localMy ? `Your reaction: ${localMy}. Change it` : "React"}
      >
        {localMy ? (
          <span className="text-[15px] leading-none">{localMy}</span>
        ) : (
          <SmilePlus size={18} strokeWidth={1.75} />
        )}
        React
      </button>

      {/* A sheet, not a popover anchored to this button. The old overlay was
          positioned inside the card and clipped at the screen edge — worse on
          the detail page, where the card sits flush to the gutter. */}
      <Sheet open={open} onClose={() => setOpen(false)} title="React" maxHeight="70vh">
        <div className="pb-1">
          <div className="grid grid-cols-4 gap-2">
            {quickRow.map((emoji) => (
              <EmojiButton
                key={emoji}
                emoji={emoji}
                count={localCounts[emoji] ?? 0}
                selected={localMy === emoji}
                disabled={busy}
                onPick={doReact}
                large
              />
            ))}
          </div>

          <div className="mt-4 mb-2 border-b border-[color:var(--sec-rule)] pb-[5px] text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
            More
          </div>

          <div className="grid grid-cols-8 gap-1.5">
            {MORE_EMOJIS.map((emoji, i) => (
              <EmojiButton
                key={`${emoji}-${i}`}
                emoji={emoji}
                count={0}
                selected={localMy === emoji}
                disabled={busy}
                onPick={doReact}
              />
            ))}
          </div>
        </div>
      </Sheet>
    </>
  );
}

function EmojiButton({
  emoji,
  count,
  selected,
  disabled,
  onPick,
  large,
}: {
  emoji: string;
  count: number;
  selected: boolean;
  disabled: boolean;
  onPick: (emoji: string) => void;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(emoji)}
      className={[
        "flex items-center justify-center gap-1 rounded-[var(--r-ui)] border transition",
        large ? "h-12" : "h-10",
        selected
          ? "border-[color:color-mix(in_srgb,var(--sec-accent)_60%,transparent)] bg-[color:color-mix(in_srgb,var(--sec-accent)_18%,transparent)]"
          : "border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] hover:bg-[color:var(--sec-surface-2)]",
        disabled ? "opacity-60" : "",
      ].join(" ")}
      aria-label={`React ${emoji}`}
      aria-pressed={selected}
    >
      <span className={large ? "text-[19px] leading-none" : "text-[17px] leading-none"}>
        {emoji}
      </span>
      {large && count > 0 ? (
        <span className="text-[length:var(--t-sec)] font-medium tabular-nums text-[color:var(--sec-muted)]">
          {count}
        </span>
      ) : null}
    </button>
  );
}
