// components/social/FeedCard.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, Share2, Snowflake, ThumbsUp } from "lucide-react";
import type { FeedItemVM } from "@/lib/feed/types";
import ReactionBar from "@/components/social/ReactionBar";
import OverflowMenu from "@/components/social/OverflowMenu";
import PostMedia, { mediaFromPayload } from "@/components/social/PostMedia";
import ReactorsSheet from "@/components/social/ReactorsSheet";
import StatLine from "@/components/social/StatLine";
import { CARD, Tag } from "@/components/ui/chrome";
import { renderWithMentions } from "@/lib/social/mentions";

// ---- Time formatting --------------------------------------------

function formatDDMMYYYY(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function plural(n: number, one: string, many?: string) {
  const word = n === 1 ? one : (many ?? `${one}s`);
  return `${n} ${word}`;
}

function formatAgeOrDate(occurredAtIso: string): string {
  const d = new Date(occurredAtIso).getTime();
  const diffMs = Math.max(0, Date.now() - d);

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
  const mins = Math.floor(Math.max(0, Date.now() - d) / 60000);
  if (mins < 60) return `started ${Math.max(1, mins)}m ago`;
  return `started ${Math.floor(mins / 60)}h ago`;
}

// ---- Helpers ----------------------------------------------------

function getRoundIdForOpen(item: FeedItemVM): string | undefined {
  if (item.type === "competition_round") return undefined;

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
  if (ev === "hio") return "Hole in one";
  if (ev === "albatross") return "Albatross";
  if (ev === "eagle") return "Eagle";
  return "Hole event";
}

/**
 * The chip above the body. `user_post` deliberately has none — a post is the
 * default thing in a feed, and labelling it "Post" is noise.
 */
function cardChip(item: FeedItemVM, isLive: boolean): string | null {
  if (item.type === "round_played") return isLive ? "Round live" : "Round complete";
  if (item.type === "course_record") return "Course record";
  if (item.type === "pb") return "Personal best";
  if (item.type === "hole_event") return holeEventBadgeText(item.payload);
  if (item.type === "user_post") return null;
  if (item.type === "competition_round") {
    const p: any = item.payload ?? {};
    const rn = typeof p.round_number === "number" ? p.round_number : 1;
    const total = typeof p.total_rounds === "number" ? p.total_rounds : 1;
    return total > 1 ? `Round ${rn} of ${total}` : "Round";
  }
  return null;
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
      className="shrink-0 rounded-full border border-[color:var(--hair-panel)] object-cover"
      loading="lazy"
      decoding="async"
    />
  ) : (
    <div
      style={{ width: s, height: s }}
      className="grid shrink-0 place-items-center rounded-full border border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] text-[length:var(--t-label)] font-medium text-[color:var(--sec-text)]"
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
          <div className="grid h-7 w-7 place-items-center rounded-full border border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] text-[length:var(--t-label)] font-medium text-[color:var(--sec-text)]">
            +{people.length - max}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---- Body renderers --------------------------------------------

function UserPostBody({ payload }: { payload: any }) {
  const text = typeof payload?.text === "string" ? payload.text : "";
  const tagged = Array.isArray(payload?.tagged_profiles) ? payload.tagged_profiles : [];
  const media = useMemo(() => mediaFromPayload(payload), [payload]);

  return (
    <>
      {text ? (
        <div className="whitespace-pre-wrap text-[length:var(--t-body)] font-normal leading-[1.45] text-[color:var(--sec-text)]">
          {renderWithMentions(text, tagged)}
        </div>
      ) : null}

      {media.length > 0 ? <PostMedia media={media} /> : null}
    </>
  );
}

function RoundPlayedBody({ payload, isLive }: { payload: any; isLive: boolean }) {
  const players = Array.isArray(payload?.players) ? payload.players : [];
  const formatLabel = typeof payload?.format_label === "string" ? payload.format_label : null;
  const rawFormatWinner = typeof payload?.format_winner === "string" ? payload.format_winner : null;
  const formatWinner =
    isLive && rawFormatWinner ? rawFormatWinner.replace(" won ", " winning ") : rawFormatWinner;
  const sideGameResults = Array.isArray(payload?.side_game_results) ? payload.side_game_results : [];
  const formatType = typeof payload?.format_type === "string" ? payload.format_type : null;

  // Null format_type is strokeplay too.
  const isStrokeplay =
    !formatType || formatType === "strokeplay" || formatType === "team_strokeplay";

  if (!players.length) {
    return (
      <div className="text-[length:var(--t-body)] font-normal text-[color:var(--sec-muted)]">
        Round completed.
      </div>
    );
  }

  return (
    <div>
      {/* A list of players is a list, not six nested cards. */}
      <div className="flex flex-col">
        {players.slice(0, 6).map((p: any, idx: number) => {
          const gross = safeNum(p?.gross_total);
          const net = safeNum(p?.net_total);
          const grossToPar = safeNum(p?.gross_to_par);
          const netToPar = safeNum(p?.net_to_par);
          const parTotal = safeNum(p?.par_total);
          const holesCompleted = safeNum(p?.holes_completed);
          const formatScore = p?.format_score;
          const hasFormatScore = formatScore !== null && formatScore !== undefined;
          const compHolesShown = safeNum(p?.competition_holes_shown);
          const isFrozen =
            compHolesShown != null && holesCompleted != null && holesCompleted > compHolesShown;

          const subtitle = isFrozen
            ? `Thru ${compHolesShown} (${holesCompleted})`
            : holesCompleted !== null
              ? `Thru ${holesCompleted}`
              : parTotal !== null
                ? `Par ${parTotal}`
                : null;

          const grossValue =
            isStrokeplay && grossToPar !== null ? formatToPar(grossToPar) : (gross ?? "—");
          const netValue = isStrokeplay && netToPar !== null ? formatToPar(netToPar) : (net ?? "—");

          return (
            <div
              key={`${p?.profile_id ?? p?.name ?? idx}`}
              className="flex min-h-[44px] items-center gap-2.5 border-b border-[color:var(--hair)] py-[var(--row-pv)] last:border-b-0"
            >
              <Avatar name={p?.name ?? "Player"} url={p?.avatar_url ?? null} size={28} />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="truncate text-[length:var(--t-body)] font-medium text-[color:var(--sec-text)]">
                    {p?.name ?? "Player"}
                  </span>
                  {isFrozen ? (
                    <Snowflake
                      size={12}
                      className="shrink-0 text-[color:var(--sec-accent)]"
                      aria-label="Frozen leaderboard"
                    />
                  ) : null}
                </div>
                {subtitle ? (
                  <div className="truncate text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
                    {subtitle}
                    {hasFormatScore && formatLabel ? ` · ${formatLabel} ${formatScore}` : ""}
                  </div>
                ) : null}
              </div>

              <div className="shrink-0 text-right">
                <div className="text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
                  Gross
                </div>
                <div className="text-[length:var(--t-fig)] font-medium tabular-nums text-[color:var(--sec-accent)]">
                  {grossValue}
                </div>
              </div>

              <div className="w-12 shrink-0 text-right">
                <div className="text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
                  Net
                </div>
                <div className="text-[length:var(--t-fig)] font-medium tabular-nums text-[color:var(--sec-text)]">
                  {netValue}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {formatWinner ? (
        <div className="pt-2 text-[length:var(--t-sec)] font-medium text-[color:var(--sec-accent)]">
          {formatWinner}
        </div>
      ) : null}

      {sideGameResults.length > 0 ? (
        <div className="pt-1">
          {sideGameResults.map((sg: any, i: number) => (
            <div
              key={i}
              className="text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]"
            >
              {sg?.label}: {sg?.winner ?? "No winner"}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PbOrRecordBody({ item }: { item: FeedItemVM }) {
  const p: any = item.payload ?? {};
  const gross = safeNum(p?.gross) ?? safeNum(p?.gross_total) ?? safeNum(p?.score);
  const course = p?.course_name ?? "Course";
  const tee = p?.tee_name ? ` · ${p.tee_name}` : "";

  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0 text-[length:var(--t-body)] font-medium text-[color:var(--sec-text)]">
        {course}
        <span className="text-[color:var(--sec-muted)]">{tee}</span>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
          Gross
        </div>
        <div className="text-[length:var(--t-fig)] font-semibold tabular-nums text-[color:var(--sec-accent)]">
          {gross ?? "—"}
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
  const strokes = safeNum(p?.strokes) ?? safeNum(p?.score);

  const items = [
    { label: "Hole", value: hole ?? "—" },
    { label: "Par", value: par ?? "—" },
    ...(yardage !== null ? [{ label: "Yards", value: yardage }] : []),
    ...(strokes !== null ? [{ label: "Strokes", value: strokes }] : []),
  ];

  return (
    <div className="flex">
      {items.map((it, i) => (
        <div
          key={it.label}
          className={[
            "min-w-0 flex-1 py-[var(--row-pv)]",
            i > 0 ? "border-l border-[color:var(--hair)] pl-2.5" : "",
          ].join(" ")}
        >
          <div className="truncate text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
            {it.label}
          </div>
          <div className="mt-[3px] text-[length:var(--t-fig)] font-medium tabular-nums text-[color:var(--sec-text)]">
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function CompetitionRoundBody({ payload }: { payload: any }) {
  const roundStatus: string = payload?.round_status ?? "live";
  const isComplete = roundStatus === "completed";
  const winner = payload?.winner as {
    profile_id: string;
    name: string;
    avatar_url?: string | null;
  } | null;
  const livePlayers = (Array.isArray(payload?.live_players) ? payload.live_players : []) as Array<{
    profile_id: string;
    name: string;
    avatar_url?: string | null;
  }>;
  const courseName: string | null = payload?.course_name ?? null;
  const scheduledDate: string | null = payload?.scheduled_date ?? null;
  const groupName: string | null = payload?.group_name ?? null;

  const dateLine = [
    scheduledDate
      ? new Date(scheduledDate).toLocaleDateString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : null,
    courseName,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-1.5">
      {groupName ? (
        <div className="text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
          {groupName}
        </div>
      ) : null}

      {dateLine ? (
        <div className="text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
          {dateLine}
        </div>
      ) : null}

      {isComplete && winner ? (
        <div className="flex items-center gap-2 pt-0.5">
          <Avatar name={winner.name} url={winner.avatar_url ?? null} size={24} />
          <span className="text-[length:var(--t-sec)] font-medium text-[color:var(--sec-accent)]">
            Winner: {winner.name}
          </span>
        </div>
      ) : !isComplete && livePlayers.length > 0 ? (
        <div className="flex items-center gap-2 pt-0.5">
          <AvatarStack
            people={livePlayers.map((p) => ({ name: p.name, avatar_url: p.avatar_url ?? null }))}
            max={4}
          />
          <span className="text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
            {livePlayers.length === 1 ? livePlayers[0].name : `${livePlayers.length} playing`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ---- Action bar --------------------------------------------------

function ActionButton({
  icon,
  label,
  onClick,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const className =
    "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--r-ui)] text-[length:var(--t-sec)] font-medium text-[color:var(--sec-muted)] transition hover:bg-[color:var(--sec-surface-2)]";

  if (href) {
    return (
      <Link href={href} className={className}>
        {icon}
        {label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {icon}
      {label}
    </button>
  );
}

// ---- Main component --------------------------------------------

export default function FeedCard({
  item,
  variant = "feed",
  onHidden,
}: {
  item: FeedItemVM;
  /** "detail" reuses the card as the summary on the detail page: not clickable,
   * no comment action (comments live in a section below), reactions kept. */
  variant?: "feed" | "detail";
  /** Called when the viewer hides or deletes this item, so the list can drop it. */
  onHidden?: (feedItemId: string) => void;
}) {
  const router = useRouter();
  const isDetail = variant === "detail";

  const [myReaction, setMyReaction] = useState<string | null>(item.aggregates.my_reaction ?? null);
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>(
    item.aggregates.reaction_counts ?? {},
  );
  const [commentCount] = useState<number>(item.aggregates.comment_count ?? 0);
  const [reactorsOpen, setReactorsOpen] = useState(false);

  // Accept new server truth when the item changes; ReactionBar owns the
  // optimistic path in between.
  useEffect(() => {
    setMyReaction(item.aggregates.my_reaction ?? null);
    setReactionCounts(item.aggregates.reaction_counts ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.aggregates.my_reaction, item.aggregates.reaction_counts]);

  const isLive = item.id.startsWith("live:");
  const actionsEnabled = !isLive;
  const chip = cardChip(item, isLive);

  const players = useMemo(() => {
    const p: any = item.payload ?? {};
    const arr = Array.isArray(p.players) ? p.players : [];
    return arr
      .map((x: any) => ({
        profile_id: x?.profile_id ?? null,
        name: x?.name ?? "Player",
        avatar_url: x?.avatar_url ?? null,
      }))
      .filter((x: any) => !!x?.name);
  }, [item.payload]);

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

  const competitionEventId = useMemo(() => {
    if (item.type !== "competition_round") return null;
    const p: any = item.payload ?? {};
    return typeof p.event_id === "string" ? p.event_id : null;
  }, [item.type, item.payload]);

  /**
   * Where the card goes when tapped. Live items have no stored feed item and so
   * no detail page — they open the round. Competition rounds jump to the event
   * leaderboard.
   */
  const cardHref = useMemo(() => {
    if (isDetail) return null;
    if (isLive) return canOpenRound ? `/round/${openRoundId}?from=social` : null;
    if (competitionEventId) return `/majors/events/${competitionEventId}?tab=leaderboard`;
    return `/social/${item.id}`;
  }, [isDetail, isLive, canOpenRound, openRoundId, competitionEventId, item.id]);

  const timeLabel = useMemo(
    () => (isLive ? formatLiveStarted(item.occurred_at) : formatAgeOrDate(item.occurred_at)),
    [isLive, item.occurred_at],
  );

  const collaboration = useMemo(() => {
    if (item.type !== "round_played" || !players.length) return null;
    const names = players.map((p: any) => p.name).filter(Boolean);
    if (names.length === 1) return { label: names[0], people: players };
    const firstTwo = names.slice(0, 2);
    const remaining = names.length - firstTwo.length;
    return {
      label: remaining > 0 ? `${firstTwo.join(", ")} + ${remaining}` : firstTwo.join(", "),
      people: players,
    };
  }, [item.type, players]);

  const metaLine = useMemo(() => {
    const p: any = item.payload ?? {};
    const course = p?.course_name ?? p?.course ?? null;
    return [timeLabel, item.type !== "user_post" ? course : null].filter(Boolean).join(" · ");
  }, [item.payload, item.type, timeLabel]);

  async function share() {
    const url = `${window.location.origin}/social/${item.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
      await navigator.clipboard.writeText(url);
    } catch {
      // The user dismissed the share sheet, or the clipboard is unavailable.
    }
  }

  return (
    <div className={`relative ${CARD} overflow-hidden p-3`}>
      {/* The whole card is a link, but as an overlay rather than a wrapper: a
          <div role="button"> around real buttons and images was invalid nesting
          and broke middle-click and prefetch. Everything interactive sits above
          this on z-10. */}
      {cardHref ? (
        <Link
          href={cardHref}
          className="absolute inset-0 z-0"
          aria-label="Open"
          tabIndex={-1}
          aria-hidden
        />
      ) : null}

      {/* Identity row */}
      <div className="relative z-10 flex items-start gap-2.5">
        {collaboration ? (
          <>
            <AvatarStack people={collaboration.people} max={3} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[length:var(--t-body)] font-medium text-[color:var(--sec-text)]">
                {collaboration.label}
              </div>
              <div className="truncate text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
                {metaLine}
              </div>
            </div>
          </>
        ) : primaryPerson ? (
          <>
            <button
              type="button"
              onClick={() => router.push(`/player/${primaryPerson.profile_id}`)}
              className="shrink-0"
              aria-label={`View ${primaryPerson.display_name ?? "player"}`}
            >
              <Avatar
                name={primaryPerson.display_name ?? "Player"}
                url={primaryPerson.avatar_url ?? null}
                size={36}
              />
            </button>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => router.push(`/player/${primaryPerson.profile_id}`)}
                className="block max-w-full truncate text-left text-[length:var(--t-body)] font-medium text-[color:var(--sec-text)]"
              >
                {primaryPerson.display_name ?? "Player"}
              </button>
              <div className="truncate text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
                {metaLine}
              </div>
            </div>
          </>
        ) : (
          <div className="min-w-0 flex-1 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
            {metaLine}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1">
          {isLive ? <Tag on>Live</Tag> : null}
          {item.type === "competition_round" ? (
            (item.payload as any)?.round_status === "completed" ? (
              <Tag>Final</Tag>
            ) : (
              <Tag on>Live</Tag>
            )
          ) : null}
          {actionsEnabled ? <OverflowMenu item={item} onHidden={onHidden} /> : null}
        </div>
      </div>

      {/* Chip + body */}
      <div className="relative z-10 mt-2.5">
        {chip ? (
          <div className="mb-2">
            <Tag>{chip}</Tag>
            {item.type === "pb" && item.aggregates.friend_best ? (
              <span className="ml-1.5">
                <Tag>Circle best</Tag>
              </span>
            ) : null}
          </div>
        ) : null}

        {item.type === "user_post" ? (
          <UserPostBody payload={item.payload as any} />
        ) : item.type === "round_played" ? (
          <RoundPlayedBody payload={item.payload as any} isLive={isLive} />
        ) : item.type === "pb" || item.type === "course_record" ? (
          <PbOrRecordBody item={item} />
        ) : item.type === "hole_event" ? (
          <HoleEventBody item={item} />
        ) : item.type === "competition_round" ? (
          <CompetitionRoundBody payload={item.payload as any} />
        ) : (
          <div className="text-[length:var(--t-body)] font-normal text-[color:var(--sec-muted)]">
            Activity
          </div>
        )}
      </div>

      {actionsEnabled ? (
        <div className="relative z-10">
          <StatLine
            counts={reactionCounts}
            myReaction={myReaction}
            commentCount={commentCount}
            onOpenReactors={() => setReactorsOpen(true)}
            onOpenComments={() => router.push(`/social/${item.id}`)}
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

            {!isDetail ? (
              <ActionButton
                icon={<MessageCircle size={18} strokeWidth={1.75} />}
                label="Comment"
                href={`/social/${item.id}`}
              />
            ) : null}

            <ActionButton
              icon={<Share2 size={18} strokeWidth={1.75} />}
              label="Share"
              onClick={share}
            />
          </div>

          <ReactorsSheet
            open={reactorsOpen}
            onClose={() => setReactorsOpen(false)}
            target={{ kind: "feed_item", id: item.id }}
          />
        </div>
      ) : null}

      {/* Top comment preview */}
      {item.aggregates.top_comment && !isDetail ? (
        <TopCommentPreview comment={item.aggregates.top_comment} />
      ) : null}
    </div>
  );
}

function TopCommentPreview({ comment }: { comment: any }) {
  const body = typeof comment?.body === "string" ? comment.body : "";
  if (!body) return null;

  const author = comment?.author?.name ?? "Player";
  const likes =
    typeof comment?.like_count === "number"
      ? comment.like_count
      : typeof comment?.vote_count === "number"
        ? comment.vote_count
        : 0;

  return (
    <div className="relative z-10 mt-1.5 border-t border-[color:var(--hair)] pt-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[length:var(--t-sec)] font-medium text-[color:var(--sec-text)]">
          {author}
        </span>
        {likes > 0 ? (
          <span className="flex shrink-0 items-center gap-1 text-[length:var(--t-label)] font-normal tabular-nums text-[color:var(--sec-muted)]">
            <ThumbsUp size={12} strokeWidth={1.75} />
            {likes}
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 line-clamp-2 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
        {body}
      </div>
    </div>
  );
}
