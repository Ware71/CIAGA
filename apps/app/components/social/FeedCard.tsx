// components/social/FeedCard.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedItemVM } from "@/lib/feed/types";
import ReactionBar from "@/components/social/ReactionBar";
import CommentDrawer from "@/components/social/CommentDrawer";
import { Button } from "@/components/ui/button";

// ---- Time formatting --------------------------------------------

function formatDDMMYYYY(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function plural(n: number, one: string, many?: string) {
  const word = n === 1 ? one : many ?? `${one}s`;
  return `${n} ${word}`;
}

function formatAgeOrDate(occurredAtIso: string): string {
  const d = new Date(occurredAtIso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - d);

  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${plural(Math.max(1, mins), "minute")} ago`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${plural(hrs, "hour")} ago`;

  const days = Math.floor(hrs / 24);
  if (days < 7) return `${plural(days, "day")} ago`;

  return formatDDMMYYYY(occurredAtIso);
}

function formatLiveStarted(occurredAtIso: string): string {
  const d = new Date(occurredAtIso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - d);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `LIVE · started ${Math.max(1, mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  return `LIVE · started ${hrs}h ago`;
}

// ---- Helpers ----------------------------------------------------

function getRoundIdForOpen(item: FeedItemVM): string | undefined {
  const p: any = item.payload ?? {};
  if (item.type === "round_played") return typeof p.round_id === "string" ? p.round_id : undefined;

  if (item.type === "hole_event" || item.type === "pb" || item.type === "course_record") {
    return typeof p.round_id === "string" ? p.round_id : undefined;
  }

  if (item.type === "user_post") {
    return typeof p.tagged_round_id === "string" ? p.tagged_round_id : undefined;
  }

  return undefined;
}

function holeEventBadgeText(payload: any): string {
  const ev = String(payload?.kind ?? payload?.event ?? "").toLowerCase();
  if (ev === "hio") return "HOLE IN ONE";
  if (ev === "albatross") return "ALBATROSS";
  if (ev === "eagle") return "EAGLE";
  return "HOLE EVENT";
}

function cardHeaderTitle(item: FeedItemVM): string {
  if (item.type === "round_played") return "Round Complete";
  if (item.type === "course_record") return "Course Record";
  if (item.type === "pb") return "Personal Best";
  if (item.type === "hole_event") return holeEventBadgeText(item.payload);
  if (item.type === "user_post") return "Post";
  return "Activity";
}

function RoundMetaLine({ payload, timeLabel }: { payload: any; timeLabel: string }) {
  const course = payload?.course_name ?? "Course";
  const tee = payload?.tee_name ? ` · ${payload.tee_name}` : "";
  return (
    <span>
      {course}
      {tee}
      {timeLabel ? ` · ${timeLabel}` : ""}
    </span>
  );
}

function ActorCourseMetaLine({
  actorName,
  payload,
  timeLabel,
}: {
  actorName: string | null;
  payload: any;
  timeLabel: string;
}) {
  const course = payload?.course_name ?? payload?.course ?? null;
  const bits = [actorName, course].filter(Boolean);
  return (
    <span>
      {bits.join(" · ")}
      {timeLabel ? ` · ${timeLabel}` : ""}
    </span>
  );
}

function formatToPar(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

function safeNum(n: any): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function avatarInitial(name: string) {
  return String(name ?? "P").slice(0, 1).toUpperCase();
}

function Avatar({ name, url, size = 28 }: { name: string; url: string | null; size?: number }) {
  const s = `${size}px`;
  return url ? (
    <img
      src={url}
      alt=""
      style={{ width: s, height: s }}
      className="rounded-full object-cover border border-emerald-900/60"
      loading="lazy"
    />
  ) : (
    <div
      style={{ width: s, height: s }}
      className="rounded-full border border-emerald-900/60 bg-emerald-950/20 flex items-center justify-center text-[11px] font-extrabold text-emerald-50"
    >
      {avatarInitial(name)}
    </div>
  );
}

function AvatarStack({
  people,
  max = 3,
}: {
  people: Array<{ name: string; avatar_url: string | null }>;
  max?: number;
}) {
  const shown = people.slice(0, max);
  return (
    <div className="flex items-center">
      {shown.map((p, idx) => (
        <div key={`${p.name}-${idx}`} className={idx === 0 ? "" : "-ml-2"}>
          <Avatar name={p.name} url={p.avatar_url} size={28} />
        </div>
      ))}
      {people.length > max ? (
        <div className="-ml-2">
          <div className="h-7 w-7 rounded-full border border-emerald-900/60 bg-emerald-950/20 flex items-center justify-center text-[10px] font-extrabold text-emerald-50">
            +{people.length - max}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReactionSummary({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts ?? {}).filter(([, n]) => typeof n === "number" && n > 0);
  if (!entries.length) return null;

  entries.sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 4);
  const total = entries.reduce((acc, [, n]) => acc + n, 0);

  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-100/65">
      <div className="flex items-center gap-1">
        {top.map(([emoji, n]) => (
          <span key={emoji} className="inline-flex items-center gap-1">
            <span>{emoji}</span>
            <span className="text-emerald-100/55">{n}</span>
          </span>
        ))}
      </div>
      <span className="text-emerald-100/40">·</span>
      <span>{total} reactions</span>
    </div>
  );
}

// ---- Body renderers --------------------------------------------

function UserPostBody({ payload }: { payload: any }) {
  const text = typeof payload?.text === "string" ? payload.text : "";
  const images = Array.isArray(payload?.image_urls) ? payload.image_urls : [];

  return (
    <div className="space-y-3">
      {text ? <div className="text-sm font-semibold text-emerald-50/95 whitespace-pre-wrap">{text}</div> : null}

      {Array.isArray(images) && images.length > 0 ? (
        <div
          className="grid grid-cols-2 gap-2"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {images.slice(0, 4).map((src: string) => (
            <img
              key={src}
              src={src}
              alt=""
              className="h-36 w-full rounded-xl object-cover border border-emerald-900/60"
              loading="lazy"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RoundPlayedBody({ payload }: { payload: any }) {
  const players = Array.isArray(payload?.players) ? payload.players : [];

  return (
    <div className="space-y-2">
      {players.length ? (
        <div className="space-y-2">
          {players.slice(0, 6).map((p: any, idx: number) => {
            const gross = safeNum(p?.gross_total);
            const net = safeNum(p?.net_total);
            const netToPar = safeNum(p?.net_to_par);
            const parTotal = safeNum(p?.par_total);
            const holesCompleted = safeNum(p?.holes_completed);

            return (
              <div
                key={`${p?.profile_id ?? p?.name ?? idx}`}
                className="flex items-center gap-2 rounded-xl border border-emerald-900/40 bg-emerald-950/10 px-2 py-2"
              >
                {p?.avatar_url ? (
                  <img
                    src={p.avatar_url}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover border border-emerald-900/60"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-7 w-7 rounded-full border border-emerald-900/60 bg-emerald-950/20" />
                )}

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-extrabold text-emerald-50 truncate">{p?.name ?? "Player"}</div>
                  {holesCompleted !== null ? (
                    <div className="text-[11px] font-semibold text-emerald-100/55">Thru {holesCompleted}</div>
                  ) : parTotal !== null ? (
                    <div className="text-[11px] font-semibold text-emerald-100/55">Par {parTotal}</div>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <div className="text-[10px] font-extrabold text-emerald-100/50">GROSS</div>
                    <div className="text-sm font-extrabold text-[#f5e6b0]">{gross ?? "—"}</div>
                  </div>

                  <div className="w-px h-8 bg-emerald-900/40" />

                  <div className="text-right">
                    <div className="text-[10px] font-extrabold text-emerald-100/50">NET</div>
                    <div className="text-sm font-extrabold text-emerald-50">
                      {net ?? "—"}
                      {typeof netToPar === "number" ? (
                        <span className="ml-2 text-[11px] font-extrabold text-emerald-100/65">
                          ({formatToPar(netToPar)})
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-sm font-semibold text-emerald-100/70">Round completed.</div>
      )}
    </div>
  );
}

function PbOrRecordBody({ item }: { item: FeedItemVM }) {
  const p: any = item.payload ?? {};
  const gross = safeNum(p?.gross) ?? safeNum(p?.gross_total) ?? safeNum(p?.score);
  const course = p?.course_name ?? "Course";
  const tee = p?.tee_name ? ` · ${p.tee_name}` : "";

  return (
    <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/10 p-3">
      <div className="flex items-end justify-between">
        <div className="text-sm font-extrabold text-emerald-50">
          {course}
          {tee}
        </div>
        <div className="text-right">
          <div className="text-[10px] font-extrabold text-emerald-100/50">GROSS</div>
          <div className="text-2xl font-extrabold text-[#f5e6b0] leading-none">{gross ?? "—"}</div>
        </div>
      </div>
    </div>
  );
}

function HoleEventBody({ item }: { item: FeedItemVM }) {
  const p: any = item.payload ?? {};
  const hole = safeNum(p?.hole_number);
  const par = safeNum(p?.par);
  const yardage = safeNum(p?.yardage) ?? safeNum(p?.hole_yardage);
  const course = p?.course_name ?? "";
  const tee = p?.tee_name ? ` · ${p.tee_name}` : "";

  return (
    <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/10 p-3 space-y-2">
      <div className="text-xs font-semibold text-emerald-100/60">
        {course ? (
          <span>
            {course}
            {tee}
          </span>
        ) : (
          <span />
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-extrabold text-emerald-50">
          {hole !== null ? `Hole ${hole}` : "Hole"}{" "}
          {par !== null ? <span className="text-emerald-100/70">· Par {par}</span> : null}
        </div>

        {yardage !== null ? <div className="text-[11px] font-extrabold text-[#f5e6b0]">{yardage} yd</div> : null}
      </div>

      {typeof p?.strokes === "number" || typeof p?.score === "number" ? (
        <div className="text-xs font-semibold text-emerald-100/70">
          Strokes: {safeNum(p?.strokes) ?? safeNum(p?.score) ?? "—"}
        </div>
      ) : null}
    </div>
  );
}

// ---- Main component --------------------------------------------

type TopCommentVM = { author: string; body: string; like_count: number; created_at?: string };

function isBetterTopComment(a: TopCommentVM | null, b: TopCommentVM | null) {
  // returns true if b should replace a
  if (!b) return false;
  if (!a) return true;

  const aLikes = typeof a.like_count === "number" ? a.like_count : 0;
  const bLikes = typeof b.like_count === "number" ? b.like_count : 0;

  if (bLikes !== aLikes) return bLikes > aLikes;

  const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
  const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
  return bTs > aTs;
}

export default function FeedCard({ item }: { item: FeedItemVM }) {
  const router = useRouter();

  const [myReaction, setMyReaction] = useState<string | null>(item.aggregates.my_reaction ?? null);
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>(item.aggregates.reaction_counts ?? {});
  const [commentCount, setCommentCount] = useState<number>(item.aggregates.comment_count ?? 0);
  const [commentsOpen, setCommentsOpen] = useState(false);

  // Keep local counts in sync with parent re-fetch/pagination updates.
  // (Preserves optimistic UI because ReactionBar owns the immediate updates;
  // we just accept new server truth when the item/aggregates change.)
  useEffect(() => {
    setMyReaction(item.aggregates.my_reaction ?? null);
    setReactionCounts(item.aggregates.reaction_counts ?? {});
    setCommentCount(item.aggregates.comment_count ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    item.id,
    item.aggregates.my_reaction,
    item.aggregates.comment_count,
    item.aggregates.reaction_counts,
  ]);

  const isLive = item.id.startsWith("live:");
  const actionsEnabled = !isLive;
  const headerTitle = cardHeaderTitle(item);

  const players = useMemo(() => {
    const p: any = item.payload ?? {};
    const arr = Array.isArray(p.players) ? p.players : [];
    return arr
      .map((x: any) => ({
        profile_id: x?.profile_id ?? null,
        name: x?.name ?? "Player",
        avatar_url: x?.avatar_url ?? null,
        gross_total: safeNum(x?.gross_total),
        net_total: safeNum(x?.net_total),
        net_to_par: safeNum(x?.net_to_par),
        par_total: safeNum(x?.par_total),
      }))
      .filter((x: any) => !!x?.name);
  }, [item.payload, item.type]);

  const primaryPerson = useMemo(() => {
    if (item.type === "round_played" && players.length > 1) return null;

    if (item.subject) return item.subject;

    if (item.actor) {
      return {
        profile_id: item.actor.profile_id,
        display_name: item.actor.display_name,
        avatar_url: item.actor.avatar_url ?? null,
      };
    }

    if (players.length) {
      const p = players[0];
      return {
        profile_id: p.profile_id ?? "",
        display_name: p.name ?? "Player",
        avatar_url: p.avatar_url ?? null,
      };
    }

    return null;
  }, [item.subject, item.actor, players, item.type]);

  const openRoundId = getRoundIdForOpen(item);
  const canOpenRound = typeof openRoundId === "string" && openRoundId.length > 0;

  const timeLabel = useMemo(() => {
    return isLive ? formatLiveStarted(item.occurred_at) : formatAgeOrDate(item.occurred_at);
  }, [isLive, item.occurred_at]);

  function openRound() {
    if (!canOpenRound) return;
    router.push(`/round/${openRoundId}?from=social`);
  }

  // Server-provided top comment
  const serverTopComment = useMemo((): TopCommentVM | null => {
    const tc: any = (item as any)?.aggregates?.top_comment ?? null;
    if (!tc) return null;

    const authorName = tc?.author?.name ?? "Player";
    const likeCount =
      typeof tc?.like_count === "number"
        ? tc.like_count
        : typeof tc?.vote_count === "number"
          ? tc.vote_count
          : 0;

    const body = typeof tc?.body === "string" ? tc.body : "";
    if (!body) return null;

    const created_at = typeof tc?.created_at === "string" ? tc.created_at : undefined;

    return { author: authorName, body, like_count: likeCount, created_at };
  }, [item]);

  // Local override that can update instantly after posting a comment
  const [topCommentOverride, setTopCommentOverride] = useState<TopCommentVM | null>(null);

  // If the feed re-renders with a new server top comment, clear any stale override
  useEffect(() => {
    setTopCommentOverride(null);
  }, [item.id, serverTopComment?.body, serverTopComment?.like_count, serverTopComment?.created_at]);

  const topComment = topCommentOverride ?? serverTopComment;

  // Collaboration header label for round cards
  const collaborationLabel = useMemo(() => {
    if (item.type !== "round_played") return null;
    if (!players.length) return null;

    const names = players.map((p: any) => p.name).filter(Boolean);
    if (names.length === 1) return names[0];

    const firstTwo = names.slice(0, 2);
    const remaining = names.length - firstTwo.length;
    return remaining > 0 ? `${firstTwo.join(", ")} + ${remaining}` : firstTwo.join(", ");
  }, [item.type, players]);

  const collaborationAvatars = useMemo(() => {
    if (item.type !== "round_played") return null;
    if (!players.length) return null;
    return players.map((p: any) => ({ name: p.name, avatar_url: p.avatar_url }));
  }, [item.type, players]);

  return (
    <div
      className={[
        "rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/60 p-4 shadow-sm",
        canOpenRound ? "cursor-pointer hover:bg-[#0b3b21]/75" : "",
      ].join(" ")}
      onClick={() => openRound()}
      role={canOpenRound ? "button" : undefined}
      tabIndex={canOpenRound ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openRound();
        }
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Subject row */}
          {item.type === "round_played" && collaborationLabel ? (
            <div className="mb-2 flex items-center gap-2">
              {collaborationAvatars ? <AvatarStack people={collaborationAvatars} max={3} /> : null}
              <div className="min-w-0">
                <div className="text-sm font-extrabold truncate text-emerald-50">{collaborationLabel}</div>
                <div className="text-[11px] font-semibold text-emerald-100/60">{timeLabel}</div>
              </div>
            </div>
          ) : primaryPerson ? (
            <div className="mb-2 flex items-center gap-2">
              {primaryPerson.avatar_url ? (
                <img
                  src={primaryPerson.avatar_url}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover border border-emerald-900/60"
                  loading="lazy"
                />
              ) : (
                <div className="h-8 w-8 rounded-full border border-emerald-900/60 bg-emerald-950/20 flex items-center justify-center text-[11px] font-extrabold text-emerald-50">
                  {avatarInitial(primaryPerson.display_name ?? "P")}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-extrabold truncate text-emerald-50">
                  {primaryPerson.display_name ?? "Player"}
                </div>
                <div className="text-[11px] font-semibold text-emerald-100/60">{timeLabel}</div>
              </div>
            </div>
          ) : (
            <div className="mb-2 text-[11px] font-semibold text-emerald-100/60">{timeLabel}</div>
          )}

          {/* Event title row */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-sm font-extrabold truncate text-[#f5e6b0]">{headerTitle}</div>

            {isLive ? (
              <span className="shrink-0 rounded-full border border-emerald-900/50 bg-emerald-950/10 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-[#f5e6b0]">
                LIVE
              </span>
            ) : null}
          </div>

          {item.type === "round_played" ? (
            <div className="mt-0.5 text-xs font-semibold text-emerald-100/60">
              <RoundMetaLine payload={item.payload as any} timeLabel={""} />
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div
          className="flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {actionsEnabled ? (
            <>
              <ReactionBar
                feedItemId={item.id}
                myReaction={myReaction}
                reactionCounts={reactionCounts}
                onChanged={(next) => {
                  setMyReaction(next.myReaction);
                  if (next.reactionCounts) setReactionCounts(next.reactionCounts);
                }}
              />

              <Button
                variant="secondary"
                size="sm"
                className="bg-emerald-900/40 text-emerald-50 hover:bg-emerald-900/55"
                onClick={() => setCommentsOpen(true)}
              >
                💬 {commentCount}
              </Button>

              <CommentDrawer
                open={commentsOpen}
                onOpenChange={setCommentsOpen}
                feedItemId={item.id}
                onCommentCreated={(c) => {
                  setCommentCount((n) => n + 1);

                  // If the new comment should become top under the rule:
                  // - higher likes wins
                  // - tie -> newest wins
                  if (c?.body) {
                    const candidate: TopCommentVM = {
                      author: c.author ?? "Player",
                      body: c.body,
                      like_count: typeof c.like_count === "number" ? c.like_count : 0,
                      created_at: c.created_at,
                    };

                    if (isBetterTopComment(serverTopComment, candidate) || isBetterTopComment(topComment, candidate)) {
                      setTopCommentOverride(candidate);
                    } else if (!topComment) {
                      // If there was no topComment shown, show this.
                      setTopCommentOverride(candidate);
                    }
                  }
                }}
              />
            </>
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="mt-4 space-y-3">
        {item.type === "user_post" ? (
          <UserPostBody payload={item.payload as any} />
        ) : item.type === "round_played" ? (
          <RoundPlayedBody payload={item.payload as any} />
        ) : item.type === "pb" || item.type === "course_record" ? (
          <PbOrRecordBody item={item} />
        ) : item.type === "hole_event" ? (
          <HoleEventBody item={item} />
        ) : (
          <div className="text-sm font-semibold text-emerald-100/80">Activity</div>
        )}

        {/* Footer: subtle reactions + top comment preview */}
        <div className="space-y-2">
          <ReactionSummary counts={reactionCounts} />

          {topComment ? (
            <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/10 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-extrabold text-emerald-50 truncate">
                  Top comment · {topComment.author}
                </div>
                <div className="text-[11px] font-semibold text-emerald-100/60">👍 {topComment.like_count}</div>
              </div>
              <div className="mt-1 text-xs font-semibold text-emerald-100/80 line-clamp-2">{topComment.body}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
