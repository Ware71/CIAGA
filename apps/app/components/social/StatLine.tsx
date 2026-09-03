"use client";

/**
 * The line between a post's body and its action bar: who reacted on the left,
 * how many comments on the right, both tappable.
 *
 * The old version printed every emoji with its own count — "👍 3 · 🔥 1 · ❤️ 1 ·
 * 5 reactions" — which is a legend, not a summary. This is the shape every feed
 * settled on: overlapping glyphs, one number, and a phrase that tells you
 * whether you're in it.
 *
 * Shared by the feed card and the detail header so the two can't drift.
 */
export default function StatLine({
  counts,
  myReaction,
  commentCount,
  onOpenReactors,
  onOpenComments,
}: {
  counts: Record<string, number>;
  myReaction: string | null;
  commentCount: number;
  onOpenReactors: () => void;
  /** Omit on the detail page, where the comments are already on screen. */
  onOpenComments?: () => void;
}) {
  const entries = Object.entries(counts ?? {}).filter(([, n]) => typeof n === "number" && n > 0);
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const total = entries.reduce((acc, [, n]) => acc + n, 0);
  const top = entries.slice(0, 3);

  if (total === 0 && commentCount === 0) return null;

  const phrase =
    total === 0
      ? null
      : myReaction
        ? total === 1
          ? "You"
          : `You and ${total - 1} other${total - 1 === 1 ? "" : "s"}`
        : `${total}`;

  return (
    <div className="flex items-center justify-between gap-2 pt-2.5 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
      {total > 0 ? (
        <button
          type="button"
          onClick={onOpenReactors}
          className="flex min-w-0 items-center gap-1.5 rounded-full transition hover:text-[color:var(--sec-text-2)]"
          aria-label="See who reacted"
        >
          <span className="flex items-center">
            {top.map(([emoji], i) => (
              <span
                key={emoji}
                className={[
                  "grid h-[18px] w-[18px] place-items-center rounded-full bg-[color:var(--sec-surface)] text-[10px] leading-none",
                  i > 0 ? "-ml-1.5" : "",
                ].join(" ")}
              >
                {emoji}
              </span>
            ))}
          </span>
          <span className="truncate tabular-nums">{phrase}</span>
        </button>
      ) : (
        <span />
      )}

      {commentCount > 0 && onOpenComments ? (
        <button
          type="button"
          onClick={onOpenComments}
          className="shrink-0 tabular-nums transition hover:text-[color:var(--sec-text-2)]"
        >
          {commentCount} comment{commentCount === 1 ? "" : "s"}
        </button>
      ) : commentCount > 0 ? (
        <span className="shrink-0 tabular-nums">
          {commentCount} comment{commentCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}
