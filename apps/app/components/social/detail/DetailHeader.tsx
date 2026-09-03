"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedItemVM } from "@/lib/feed/types";
import ReactionBar from "@/components/social/ReactionBar";
import OverflowMenu from "@/components/social/OverflowMenu";
import PostMedia, { mediaFromPayload } from "@/components/social/PostMedia";
import ReactorsSheet from "@/components/social/ReactorsSheet";
import StatLine from "@/components/social/StatLine";
import { CARD, Tag } from "@/components/ui/chrome";
import { renderWithMentions } from "@/lib/social/mentions";

function safeNum(n: any): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function initials(name: string) {
  const s = String(name ?? "P").trim();
  const parts = s.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "P") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function Avatar({ name, url, size = 32 }: { name: string; url: string | null; size?: number }) {
  const s = `${size}px`;
  return url ? (
    <img
      src={url}
      alt=""
      style={{ width: s, height: s }}
      className="rounded-full border border-[color:var(--hair-panel)] object-cover"
      loading="lazy"
    />
  ) : (
    <div
      style={{ width: s, height: s }}
      className="grid place-items-center rounded-full border border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] text-[length:var(--t-sec)] font-medium text-[color:var(--sec-text)]"
    >
      {initials(name)}
    </div>
  );
}

type Person = { profile_id?: string | null; name: string; avatar_url: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Formatted by hand rather than with toLocaleDateString.
 *
 * This is server-rendered and then hydrated, and the two runtimes don't agree
 * on a locale: Node produced "Sep 3, 2026" while the browser produced
 * "3 Sept 2026", which threw a hydration mismatch on every load of this page
 * and made React discard and re-render the tree.
 */
function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function pillFor(item: FeedItemVM): string {
  const p: any = item.payload ?? {};
  switch (item.type) {
    case "pb":
      return "Personal best";
    case "course_record":
      return "Course record";
    case "hole_event":
      return p.kind === "hio" ? "Hole in one" : p.kind === "albatross" ? "Albatross" : p.kind === "eagle" ? "Eagle" : "Hole event";
    case "user_post":
      return "";
    case "competition_round":
      return "Competition";
    case "round_played":
      return typeof p.format_type === "string" && p.format_type.startsWith("matchplay") ? "Matchplay" : "Round";
    default:
      return "Activity";
  }
}

function peopleFor(item: FeedItemVM): Person[] {
  const p: any = item.payload ?? {};
  if (item.type === "round_played" && Array.isArray(p.players) && p.players.length) {
    return p.players.map((pl: any) => ({ profile_id: pl.profile_id ?? null, name: pl.name ?? "Player", avatar_url: pl.avatar_url ?? null }));
  }
  if (item.subject) {
    return [{ profile_id: item.subject.profile_id, name: item.subject.display_name, avatar_url: item.subject.avatar_url ?? null }];
  }
  if (item.actor) {
    return [{ profile_id: item.actor.profile_id, name: item.actor.display_name, avatar_url: item.actor.avatar_url ?? null }];
  }
  return [];
}

/** Big key figure (value + label) for the right side of the header. */
function keyFigureFor(item: FeedItemVM): { value: string; label: string } | null {
  const p: any = item.payload ?? {};
  const gross = safeNum(p.gross_total);
  if ((item.type === "pb" || item.type === "course_record") && gross != null) {
    return { value: String(gross), label: "GROSS" };
  }
  if (item.type === "hole_event") {
    const strokes = safeNum(p.strokes);
    if (strokes != null) return { value: String(strokes), label: p.hole_number ? `HOLE ${p.hole_number}` : "SCORE" };
  }
  return null;
}

export default function DetailHeader({ item }: { item: FeedItemVM }) {
  const router = useRouter();
  const [myReaction, setMyReaction] = useState<string | null>(item.aggregates.my_reaction ?? null);
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>(
    item.aggregates.reaction_counts ?? {},
  );
  const [reactorsOpen, setReactorsOpen] = useState(false);

  const p: any = item.payload ?? {};
  const people = peopleFor(item);
  const pill = pillFor(item);
  const keyFig = keyFigureFor(item);
  const media = useMemo(
    () => (item.type === "user_post" ? mediaFromPayload(p) : []),
    [item.type, p],
  );

  const namesLabel =
    people.length === 0
      ? "CIAGA"
      : people.length <= 2
        ? people.map((x) => x.name).join(" & ")
        : `${people[0].name} +${people.length - 1}`;

  const course = p.course_name ?? null;
  const tee = p.tee_name ?? null;
  const date = shortDate(p.date ?? item.occurred_at);
  const subLine = [course, tee, date].filter(Boolean).join(" · ");

  const isMatchplay =
    item.type === "round_played" &&
    typeof p.format_type === "string" &&
    p.format_type.startsWith("matchplay");
  const matchLine = isMatchplay && typeof p.format_winner === "string" ? p.format_winner : null;
  const friendBest = item.type === "pb" && item.aggregates.friend_best;

  const firstPid = people[0]?.profile_id ?? null;

  return (
    <div className={`${CARD} overflow-hidden p-3`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => firstPid && router.push(`/player/${firstPid}`)}
          className="flex shrink-0 -space-x-2"
          aria-label={firstPid ? `View ${people[0]?.name ?? "player"}` : undefined}
        >
          {people.slice(0, 3).map((x, i) => (
            <Avatar key={`${x.name}-${i}`} name={x.name} url={x.avatar_url} size={36} />
          ))}
          {people.length === 0 ? <Avatar name="C" url={null} size={36} /> : null}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate text-[length:var(--t-body)] font-medium text-[color:var(--sec-text)]">
              {namesLabel}
            </span>
            {pill ? <Tag>{pill}</Tag> : null}
            {friendBest ? <Tag>Circle best</Tag> : null}
          </div>
          {subLine ? (
            <div className="mt-0.5 truncate text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
              {subLine}
            </div>
          ) : null}
          {matchLine ? (
            <div className="mt-0.5 truncate text-[length:var(--t-sec)] font-medium text-[color:var(--sec-accent)]">
              {matchLine}
            </div>
          ) : null}
        </div>

        {keyFig ? (
          <div className="shrink-0 text-right">
            <div className="text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
              {keyFig.label}
            </div>
            <div className="text-[length:var(--t-fig)] font-semibold tabular-nums leading-none text-[color:var(--sec-accent)]">
              {keyFig.value}
            </div>
          </div>
        ) : null}

        {!item.id.startsWith("live:") ? <OverflowMenu item={item} /> : null}
      </div>

      {/* Post text — in full. This is the detail page; the feed card is where
          it gets truncated. */}
      {item.type === "user_post" && typeof p.text === "string" && p.text.trim() ? (
        <div className="mt-2.5 whitespace-pre-wrap text-[length:var(--t-body)] font-normal leading-[1.45] text-[color:var(--sec-text)]">
          {renderWithMentions(p.text, Array.isArray(p.tagged_profiles) ? p.tagged_profiles : [])}
        </div>
      ) : null}

      {/* Photos. These were missing entirely: opening a photo post from the
          feed used to lose the photos. */}
      {media.length > 0 ? <PostMedia media={media} /> : null}

      <StatLine
        counts={reactionCounts}
        myReaction={myReaction}
        commentCount={item.aggregates.comment_count ?? 0}
        onOpenReactors={() => setReactorsOpen(true)}
      />

      <div className="mt-1.5 flex items-center gap-1 border-t border-[color:var(--hair)] pt-1.5">
        <ReactionBar
          feedItemId={item.id}
          myReaction={myReaction}
          reactionCounts={reactionCounts}
          onChanged={(next) => {
            setMyReaction(next.myReaction);
            if (next.reactionCounts) setReactionCounts(next.reactionCounts);
          }}
        />
      </div>

      <ReactorsSheet
        open={reactorsOpen}
        onClose={() => setReactorsOpen(false)}
        target={{ kind: "feed_item", id: item.id }}
      />
    </div>
  );
}
