"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedItemVM } from "@/lib/feed/types";
import ReactionBar from "@/components/social/ReactionBar";

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
      className="rounded-full object-cover border border-[color:var(--sec-hair)]"
      loading="lazy"
    />
  ) : (
    <div
      style={{ width: s, height: s }}
      className="rounded-full border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] grid place-items-center text-[11px] font-extrabold text-[color:var(--sec-text)]"
    >
      {initials(name)}
    </div>
  );
}

type Person = { profile_id?: string | null; name: string; avatar_url: string | null };

function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function pillFor(item: FeedItemVM): string {
  const p: any = item.payload ?? {};
  switch (item.type) {
    case "pb":
      return "PERSONAL BEST";
    case "course_record":
      return "COURSE RECORD";
    case "hole_event":
      return p.kind === "hio" ? "HOLE IN ONE" : p.kind === "albatross" ? "ALBATROSS" : p.kind === "eagle" ? "EAGLE" : "HOLE EVENT";
    case "user_post":
      return "POST";
    case "competition_round":
      return "COMPETITION";
    case "round_played":
      return typeof p.format_type === "string" && p.format_type.startsWith("matchplay") ? "MATCHPLAY" : "ROUND";
    default:
      return "ACTIVITY";
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
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>(item.aggregates.reaction_counts ?? {});

  const p: any = item.payload ?? {};
  const people = peopleFor(item);
  const pill = pillFor(item);
  const keyFig = keyFigureFor(item);

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

  const isMatchplay = item.type === "round_played" && typeof p.format_type === "string" && p.format_type.startsWith("matchplay");
  const matchLine = isMatchplay && typeof p.format_winner === "string" ? p.format_winner : null;
  const friendBest = item.type === "pb" && item.aggregates.friend_best;

  const firstPid = people[0]?.profile_id ?? null;

  return (
    <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_60%,transparent)] p-3">
      <div className="flex items-start gap-3">
        {/* Avatars */}
        <button
          type="button"
          onClick={() => firstPid && router.push(`/player/${firstPid}`)}
          className="flex shrink-0 -space-x-2"
        >
          {people.slice(0, 3).map((x, i) => (
            <Avatar key={`${x.name}-${i}`} name={x.name} url={x.avatar_url} size={32} />
          ))}
          {people.length === 0 ? <Avatar name="C" url={null} size={32} /> : null}
        </button>

        {/* Name + pill + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="min-w-0 truncate text-sm font-extrabold text-[color:var(--sec-text)]">{namesLabel}</div>
            <span className="shrink-0 rounded-full border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-[color:var(--sec-accent)]">
              {pill}
            </span>
            {friendBest ? (
              <span className="shrink-0 rounded-full border border-sky-700/50 bg-sky-900/30 px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-sky-300">
                CIRCLE BEST
              </span>
            ) : null}
          </div>
          {subLine ? <div className="mt-0.5 truncate text-[11px] font-semibold text-[color:var(--sec-muted)]">{subLine}</div> : null}
          {matchLine ? <div className="mt-0.5 truncate text-[11px] font-extrabold text-[color:var(--sec-accent)]">{matchLine}</div> : null}
        </div>

        {/* Key figure */}
        {keyFig ? (
          <div className="shrink-0 text-right">
            <div className="text-[9px] font-extrabold tracking-wide text-[color:var(--sec-muted)]">{keyFig.label}</div>
            <div className="text-xl font-extrabold leading-none text-[color:var(--sec-accent)]">{keyFig.value}</div>
          </div>
        ) : null}
      </div>

      {/* Post text (compact) */}
      {item.type === "user_post" && typeof p.text === "string" && p.text.trim() ? (
        <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm font-semibold text-[color:var(--sec-text)]">{p.text}</div>
      ) : null}

      {/* Reactions */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <ReactionBar
          feedItemId={item.id}
          myReaction={myReaction}
          reactionCounts={reactionCounts}
          onChanged={(next) => {
            setMyReaction(next.myReaction);
            if (next.reactionCounts) setReactionCounts(next.reactionCounts);
          }}
        />
        <ReactionSummary counts={reactionCounts} />
      </div>
    </div>
  );
}

function ReactionSummary({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts ?? {}).filter(([, n]) => typeof n === "number" && n > 0);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((acc, [, n]) => acc + n, 0);
  return (
    <div className="flex items-center gap-1 text-[11px] font-semibold text-[color:var(--sec-muted)]">
      {entries.slice(0, 4).map(([emoji, n]) => (
        <span key={emoji}>
          {emoji}
          {n}
        </span>
      ))}
      <span className="text-[color:var(--sec-muted)]">·</span>
      <span>{total}</span>
    </div>
  );
}
