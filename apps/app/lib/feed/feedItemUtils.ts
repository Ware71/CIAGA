// Feed item utility functions — extracted from CiagaStarter.tsx.
// Pure functions for scoring, sorting, and classifying feed items.

import type { FeedItemVM } from "@/lib/feed/types";

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function safeNum(n: any): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim() !== "" && Number.isFinite(Number(n))) return Number(n);
  return null;
}

export function formatSigned(n: number, digits = 1) {
  const v = Number.isFinite(n) ? n : 0;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  const abs = Math.abs(v).toFixed(digits);
  return `${sign}${abs}`;
}

export function sortByOccurredAtDesc(a: FeedItemVM, b: FeedItemVM) {
  const ta = Date.parse(a.occurred_at ?? a.created_at ?? "");
  const tb = Date.parse(b.occurred_at ?? b.created_at ?? "");

  const aTime = Number.isFinite(ta) ? ta : 0;
  const bTime = Number.isFinite(tb) ? tb : 0;

  if (bTime !== aTime) return bTime - aTime;

  if (a.id < b.id) return 1;
  if (a.id > b.id) return -1;
  return 0;
}

export function isLiveItem(it: FeedItemVM) {
  return typeof it?.id === "string" && it.id.startsWith("live:");
}

export function occurredAtMs(it: FeedItemVM): number {
  const p: any = (it as any)?.payload ?? {};

  const candidates = [
    p?.occurred_at,
    p?.occurredAt,
    p?.happened_at,
    p?.happenedAt,
    p?.played_at,
    p?.playedAt,
    p?.recorded_at,
    p?.recordedAt,
    p?.created_at,
    p?.createdAt,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      const t = Date.parse(c);
      if (Number.isFinite(t)) return t;
    }
  }

  const t = Date.parse((it.occurred_at ?? it.created_at ?? "") as string);
  return Number.isFinite(t) ? t : 0;
}

export function interactionCounts(it: FeedItemVM): { reactions: number; comments: number } {
  const anyIt: any = it as any;

  const reactions =
    (typeof anyIt.reaction_count === "number" ? anyIt.reaction_count : null) ??
    (typeof anyIt.reactions_count === "number" ? anyIt.reactions_count : null) ??
    (typeof anyIt.reactions?.count === "number" ? anyIt.reactions.count : null) ??
    0;

  const comments =
    (typeof anyIt.comment_count === "number" ? anyIt.comment_count : null) ??
    (typeof anyIt.comments_count === "number" ? anyIt.comments_count : null) ??
    (typeof anyIt.comments?.count === "number" ? anyIt.comments.count : null) ??
    0;

  return { reactions, comments };
}

export function hasImages(it: FeedItemVM): boolean {
  const p: any = it.payload ?? {};
  const urls =
    p?.image_urls ??
    p?.images ??
    p?.photo_urls ??
    (p?.image_url ? [p.image_url] : null) ??
    (p?.photo_url ? [p.photo_url] : null) ??
    [];
  return Array.isArray(urls) && urls.some((u: any) => typeof u === "string" && u.trim());
}

export function holeEventKind(it: FeedItemVM): string {
  const p: any = it.payload ?? {};
  return String(p?.kind ?? p?.event ?? p?.hole_event_type ?? "").toLowerCase();
}

export function isHoleInOne(it: FeedItemVM): boolean {
  const k = holeEventKind(it);
  return k.includes("hole") && k.includes("one");
}

export function isAlbatross(it: FeedItemVM): boolean {
  const k = holeEventKind(it);
  return k.includes("albatross") || k.includes("double_eagle");
}

export function isEagle(it: FeedItemVM): boolean {
  const k = holeEventKind(it);
  return k.includes("eagle") && !k.includes("double_eagle");
}

export function baseValueOutOf10(it: FeedItemVM, ageDays: number): number {
  if (isLiveItem(it)) return 0;

  if (it.type === "hole_event") {
    if (isHoleInOne(it)) return 10;
    if (isAlbatross(it)) return 10;
    if (isEagle(it)) return 8;
    return 0;
  }

  if (it.type === "course_record") {
    return ageDays > 5 ? 6 : 7;
  }

  if (it.type === "pb") return 6;
  if (it.type === "round_played") return 5;
  if (it.type === "user_post") return hasImages(it) ? 3 : 2;

  return 0;
}

export function isAchievement(it: FeedItemVM): boolean {
  if (isLiveItem(it)) return false;
  if (it.type === "pb") return true;
  if (it.type === "course_record") return true;
  if (it.type === "hole_event") {
    return isHoleInOne(it) || isAlbatross(it) || isEagle(it);
  }
  return false;
}

export function pickCourseName(item: FeedItemVM): string | null {
  const p: any = item.payload ?? {};
  const c = p?.course_name ?? p?.course ?? p?.courseName ?? p?.course_title ?? p?.course_display_name ?? null;
  return typeof c === "string" && c.trim() ? c : null;
}

export function miniFeedCopy(item: FeedItemVM): string {
  const course = pickCourseName(item);
  const at = course ? ` · ${course}` : "";

  if (isLiveItem(item)) return `Live round${at}`;
  if (item.type === "course_record") return `New course record${at}`;
  if (item.type === "pb") return `New personal best${at}`;
  if (item.type === "round_played") return `Played${at}`;
  if (item.type === "hole_event") {
    if (isHoleInOne(item)) return `Hole-in-one${at}`;
    if (isAlbatross(item)) return `Albatross${at}`;
    if (isEagle(item)) return `Eagle${at}`;
    return `New highlight${at}`;
  }
  if (item.type === "user_post") return hasImages(item) ? "New photo" : "New update";
  return `New activity${at}`;
}

// --- Scoring & ranking helpers for feed curation ---

function actorKey(it: FeedItemVM): string {
  const anyIt: any = it as any;
  const a =
    anyIt?.actor?.id ??
    anyIt?.actor_id ??
    anyIt?.profile_id ??
    anyIt?.payload?.actor_id ??
    anyIt?.payload?.profile_id ??
    anyIt?.payload?.player_id ??
    null;

  return typeof a === "string" && a.trim() ? a : `unknown:${String(anyIt?.id ?? "")}`;
}

function typeRecencyHalfLifeHours(it: FeedItemVM): number {
  if (it.type === "round_played") return 36;
  if (it.type === "pb") return 36;
  if (it.type === "user_post") return 30;
  if (it.type === "course_record") return 72;
  if (it.type === "hole_event") {
    if (isHoleInOne(it) || isAlbatross(it)) return 96;
    if (isEagle(it)) return 72;
  }
  return 36;
}

function talkedAboutRaw(it: FeedItemVM): number {
  const { reactions, comments } = interactionCounts(it);
  return Math.max(0, reactions) + Math.max(0, comments) * 3;
}

export type Scored = {
  it: FeedItemVM;
  baseScore: number;
  ageDays: number;
  isAch: boolean;
  actor: string;
};

export function scoreNonLiveItems(items: FeedItemVM[], nowMs: number): Scored[] {
  const talkRaws = items.map(talkedAboutRaw);
  const maxTalk = Math.max(1, ...talkRaws);

  const sortedTalk = [...talkRaws].sort((a, b) => b - a);
  const top1 = sortedTalk[0] ?? 0;
  const top2 = sortedTalk[1] ?? 0;
  const viralRatio = top2 > 0 ? top1 / top2 : top1 > 0 ? 999 : 1;
  const isViralEnvironment = viralRatio >= 2.5;

  const out: Scored[] = [];

  for (const it of items) {
    if (isLiveItem(it)) continue;

    const ageMs = Math.max(0, nowMs - occurredAtMs(it));
    const ageHours = ageMs / (1000 * 60 * 60);
    const ageDays = ageHours / 24;

    const halfLife = typeRecencyHalfLifeHours(it);
    let recency = Math.exp(-ageHours / halfLife);
    recency = Math.pow(recency, 0.7);

    const rawTalk = talkedAboutRaw(it);
    const talkNorm = Math.log1p(rawTalk) / Math.log1p(maxTalk);

    const TALK_BOOST_CUTOFF_DAYS = 5;
    const talkAgePenalty =
      ageDays <= TALK_BOOST_CUTOFF_DAYS ? 1 : Math.exp(-(ageDays - TALK_BOOST_CUTOFF_DAYS) / 1.2);

    const viralNudge = isViralEnvironment && rawTalk === top1 ? 0.08 : 0;

    const v10 = baseValueOutOf10(it, ageDays);
    const value = Math.min(1, Math.max(0, v10 / 10));
    const ach = isAchievement(it);

    const achievementLongTail = ach ? Math.exp(-ageDays / 30) : 0;
    const nonAchLongTail = !ach ? Math.exp(-ageDays / 9) : Math.exp(-ageDays / 14);

    const freshness = recency * 0.72 + talkNorm * talkAgePenalty * 0.28 + viralNudge;
    const moments = value;

    let score = freshness * 0.65 + moments * 0.35;
    score *= Math.max(nonAchLongTail, achievementLongTail * 0.35);

    out.push({
      it,
      baseScore: score,
      ageDays,
      isAch: ach,
      actor: actorKey(it),
    });
  }

  return out;
}

export function selectWithDiversity(scored: Scored[], count: number): FeedItemVM[] {
  const remaining = [...scored];
  const picked: FeedItemVM[] = [];
  const perActorCount = new Map<string, number>();

  while (picked.length < count && remaining.length) {
    let bestIdx = 0;
    let bestEff = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      const seen = perActorCount.get(s.actor) ?? 0;
      const penalty = seen === 0 ? 1 : Math.pow(0.86, seen);
      const eff = s.baseScore * penalty;

      if (eff > bestEff) {
        bestEff = eff;
        bestIdx = i;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    picked.push(chosen.it);
    perActorCount.set(chosen.actor, (perActorCount.get(chosen.actor) ?? 0) + 1);
  }

  return picked;
}

export function enforceAtLeastOneAchievement(
  pickedNonLive: FeedItemVM[],
  candidateNonLive: FeedItemVM[],
  nowMs: number
): FeedItemVM[] {
  const ACH_WINDOW_DAYS = 10;

  const anyRecentAchievement = candidateNonLive.some((it) => {
    if (!isAchievement(it)) return false;
    const ageDays = Math.max(0, nowMs - occurredAtMs(it)) / (1000 * 60 * 60 * 24);
    return ageDays <= ACH_WINDOW_DAYS;
  });

  if (!anyRecentAchievement) return pickedNonLive;

  const alreadyHas = pickedNonLive.some((it) => isAchievement(it));
  if (alreadyHas) return pickedNonLive;

  const candidates = candidateNonLive
    .filter((it) => isAchievement(it))
    .map((it) => {
      const ageDays = Math.max(0, nowMs - occurredAtMs(it)) / (1000 * 60 * 60 * 24);
      return { it, ageDays };
    })
    .filter((x) => x.ageDays <= ACH_WINDOW_DAYS);

  if (!candidates.length) return pickedNonLive;

  const scored = scoreNonLiveItems(candidates.map((c) => c.it), nowMs).sort((a, b) => b.baseScore - a.baseScore);
  const bestAch = scored[0]?.it;
  if (!bestAch) return pickedNonLive;

  if (pickedNonLive.some((x) => x.id === bestAch.id)) return pickedNonLive;

  const out = [...pickedNonLive];
  if (out.length) out[out.length - 1] = bestAch;
  else out.push(bestAch);
  return out;
}
