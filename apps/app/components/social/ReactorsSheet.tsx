"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sheet } from "@/components/ui/Sheet";
import { fetchCommentLikers, fetchReactors, type Reactor } from "@/lib/social/api";

export type ReactorTarget =
  | { kind: "feed_item"; id: string }
  | { kind: "comment"; id: string };

/**
 * Who reacted — to a post, or to a comment.
 *
 * The data was always there: feed_reactions and feed_comment_votes have carried
 * the reactor's profile id since the first schema, and both have a created_at,
 * so this needed no migration. The feed simply never asked.
 */
export default function ReactorsSheet({
  open,
  onClose,
  target,
}: {
  open: boolean;
  onClose: () => void;
  target: ReactorTarget;
}) {
  const [people, setPeople] = useState<Reactor[]>([]);
  const [byEmoji, setByEmoji] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { emoji: string | null; cursor: string | null; append: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const res =
          target.kind === "feed_item"
            ? await fetchReactors(target.id, { emoji: opts.emoji, cursor: opts.cursor })
            : await fetchCommentLikers(target.id, { cursor: opts.cursor });

        setPeople((prev) => (opts.append ? [...prev, ...res.people] : res.people));
        setByEmoji(res.by_emoji ?? {});
        setTotal(res.total ?? res.people.length);
        setCursor(res.next_cursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load reactions.");
      } finally {
        setLoading(false);
      }
    },
    [target.kind, target.id],
  );

  // Load on open; reset when it closes so re-opening doesn't flash stale names.
  useEffect(() => {
    if (!open) {
      setPeople([]);
      setCursor(null);
      setFilter(null);
      return;
    }
    void load({ emoji: null, cursor: null, append: false });
  }, [open, load]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !cursor || !open) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadRef.current({ emoji: filter, cursor, append: true });
        }
      },
      { rootMargin: "200px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [cursor, filter, open]);

  const tabs = Object.entries(byEmoji)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  function pickFilter(emoji: string | null) {
    setFilter(emoji);
    setCursor(null);
    void load({ emoji, cursor: null, append: false });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={target.kind === "comment" ? "Likes" : `Reactions · ${total}`}
    >
      {/* A scrollable strip of plain buttons rather than Radix Tabs: the set of
          emoji varies per post, so there's no fixed tab list to declare. */}
      {tabs.length > 1 ? (
        <div className="-mx-1 mb-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
          <FilterChip label={`All ${total}`} active={filter === null} onClick={() => pickFilter(null)} />
          {tabs.map(([emoji, n]) => (
            <FilterChip
              key={emoji}
              label={`${emoji} ${n}`}
              active={filter === emoji}
              onClick={() => pickFilter(emoji)}
            />
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="py-4 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-bad)]">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col">
        {people.map((p) => (
          <Link
            key={`${p.profile_id}-${p.emoji}`}
            href={`/player/${p.profile_id}`}
            onClick={onClose}
            className="flex min-h-[44px] items-center gap-3 border-b border-[color:var(--hair)] py-[var(--row-pv)] transition last:border-b-0 hover:bg-[color:var(--sec-surface-2)]"
          >
            {p.avatar_url ? (
              <img
                src={p.avatar_url}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full border border-[color:var(--hair-panel)] object-cover"
                loading="lazy"
              />
            ) : (
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] text-[length:var(--t-sec)] font-medium text-[color:var(--sec-text)]">
                {p.display_name.slice(0, 1).toUpperCase()}
              </div>
            )}

            <span className="min-w-0 flex-1 truncate text-[length:var(--t-body)] font-medium text-[color:var(--sec-text)]">
              {p.display_name}
              {p.is_me ? (
                <span className="ml-1.5 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
                  You
                </span>
              ) : null}
            </span>

            <span className="shrink-0 text-[17px] leading-none">{p.emoji}</span>
          </Link>
        ))}

        {!loading && people.length === 0 && !error ? (
          <div className="py-6 text-center text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
            No reactions yet.
          </div>
        ) : null}

        {loading ? (
          <div className="py-4 text-center text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
            Loading…
          </div>
        ) : null}

        <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      </div>
    </Sheet>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "shrink-0 rounded-full border px-3 py-1.5 text-[length:var(--t-sec)] font-medium transition",
        active
          ? "border-[color:color-mix(in_srgb,var(--sec-accent)_60%,transparent)] bg-[color:color-mix(in_srgb,var(--sec-accent)_18%,transparent)] text-[color:var(--sec-text)]"
          : "border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] text-[color:var(--sec-muted)] hover:bg-[color:var(--sec-surface-2)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
