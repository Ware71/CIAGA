"use client";

import Image from "next/image";
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AuthUser } from "@/components/ui/auth-user";

import type { FeedItemVM } from "@/lib/feed/types";
import { fetchFeed, fetchLiveFeedItems } from "@/lib/social/api";

import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";

type MenuItem = { id: string; label: string };

const homeMenuItemsBase: MenuItem[] = [
  { id: "round", label: "New Round" }, // label will be overridden dynamically
  { id: "history", label: "Round History" },
  { id: "stats", label: "Stats" },
  { id: "social", label: "Social" },
  { id: "courses", label: "Courses" },
];

const majorsMenuItems: MenuItem[] = [
  { id: "majors-hub", label: "Majors Hub" },
  { id: "schedule", label: "Schedule" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "history", label: "History" },
  { id: "profile", label: "Majors Profile" },
];

type ViewMode = "home" | "majors";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function safeNum(n: any): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  // Supabase numeric often arrives as string
  if (typeof n === "string" && n.trim() !== "" && Number.isFinite(Number(n))) return Number(n);
  return null;
}

function formatSigned(n: number, digits = 1) {
  const v = Number.isFinite(n) ? n : 0;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  const abs = Math.abs(v).toFixed(digits);
  return `${sign}${abs}`;
}

function EnvelopeIcon(props: { size?: number; className?: string }) {
  const s = props.size ?? 28;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={props.className} aria-hidden="true">
      <path
        d="M4.5 7.5h15v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-9Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M5.2 8.2 12 13.2l6.8-5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function sortByOccurredAtDesc(a: FeedItemVM, b: FeedItemVM) {
  const ta = Date.parse(a.occurred_at ?? a.created_at ?? "");
  const tb = Date.parse(b.occurred_at ?? b.created_at ?? "");

  const aTime = Number.isFinite(ta) ? ta : 0;
  const bTime = Number.isFinite(tb) ? tb : 0;

  if (bTime !== aTime) return bTime - aTime;

  if (a.id < b.id) return 1;
  if (a.id > b.id) return -1;
  return 0;
}

function isLiveItem(it: FeedItemVM) {
  return typeof it?.id === "string" && it.id.startsWith("live:");
}

function occurredAtMs(it: FeedItemVM): number {
  const p: any = (it as any)?.payload ?? {};

  // Prefer "happened" timestamps if available so late-entered rounds don't look new
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

function interactionCounts(it: FeedItemVM): { reactions: number; comments: number } {
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

function hasImages(it: FeedItemVM): boolean {
  const p: any = it.payload ?? {};
  const urls =
    p?.image_urls ??
    p?.images ??
    p?.photo_urls ??
    (p?.image_url ? [p.image_url] : null) ??
    (p?.photo_url ? [p.photo_url] : null) ??
    [];
  return Array.isArray(urls) && urls.some((u) => typeof u === "string" && u.trim());
}

function holeEventKind(it: FeedItemVM): string {
  const p: any = it.payload ?? {};
  return String(p?.kind ?? p?.event ?? p?.hole_event_type ?? "").toLowerCase();
}

function isHoleInOne(it: FeedItemVM): boolean {
  const k = holeEventKind(it);
  return k.includes("hole") && k.includes("one");
}

function isAlbatross(it: FeedItemVM): boolean {
  const k = holeEventKind(it);
  return k.includes("albatross") || k.includes("double_eagle");
}

function isEagle(it: FeedItemVM): boolean {
  const k = holeEventKind(it);
  // keep simple: "eagle" but avoid "double_eagle" being double-counted
  return k.includes("eagle") && !k.includes("double_eagle");
}

function baseValueOutOf10(it: FeedItemVM, ageDays: number): number {
  // Live rounds aren't scored (they get reserved slots)
  if (isLiveItem(it)) return 0;

  // Achievements ladder you defined:
  // Hole-in-one(10), Albatross(10), Eagle(8), PB(6), Course record(7), “Played a round”(5),
  // User post (photo)(3), User post (text)(2)
  if (it.type === "hole_event") {
    if (isHoleInOne(it)) return 10;
    if (isAlbatross(it)) return 10;
    if (isEagle(it)) return 8;
    // other highlights exist, but they're not in your “achievement” set
    return 0;
  }

  if (it.type === "course_record") {
    // After day 5, course record drops to value 6
    return ageDays > 5 ? 6 : 7;
  }

  if (it.type === "pb") return 6;
  if (it.type === "round_played") return 5;

  if (it.type === "user_post") return hasImages(it) ? 3 : 2;

  return 0;
}

function isAchievement(it: FeedItemVM): boolean {
  if (isLiveItem(it)) return false;
  if (it.type === "pb") return true;
  if (it.type === "course_record") return true;
  if (it.type === "hole_event") {
    return isHoleInOne(it) || isAlbatross(it) || isEagle(it);
  }
  return false;
}

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
  // Your stated expectations:
  // - round played / PB / user posts: decaying over a couple days
  // - course records: a few days
  // - achievements should still hang a bit longer, but not “linger”
  if (it.type === "round_played") return 36; // ~1.5d
  if (it.type === "pb") return 36; // ~1.5d
  if (it.type === "user_post") return 30; // ~1.25d
  if (it.type === "course_record") return 72; // ~3d
  if (it.type === "hole_event") {
    if (isHoleInOne(it) || isAlbatross(it)) return 96; // ~4d
    if (isEagle(it)) return 72; // ~3d
  }
  return 36;
}

function talkedAboutRaw(it: FeedItemVM): number {
  // 1 comment = 3 reactions (your rule)
  const { reactions, comments } = interactionCounts(it);
  return Math.max(0, reactions) + Math.max(0, comments) * 3;
}

type Scored = {
  it: FeedItemVM;
  baseScore: number;
  ageDays: number;
  isAch: boolean;
  actor: string;
};

function scoreNonLiveItems(items: FeedItemVM[], nowMs: number): Scored[] {
  // Build global “what's talked about” scale (relative)
  const talkRaws = items.map(talkedAboutRaw);
  const maxTalk = Math.max(1, ...talkRaws);

  // “viral” = significantly more than anything else (relative)
  const sortedTalk = [...talkRaws].sort((a, b) => b - a);
  const top1 = sortedTalk[0] ?? 0;
  const top2 = sortedTalk[1] ?? 0;
  const viralRatio = top2 > 0 ? top1 / top2 : top1 > 0 ? 999 : 1;
  const isViralEnvironment = viralRatio >= 2.5; // “significantly more”

  const out: Scored[] = [];

  for (const it of items) {
    if (isLiveItem(it)) continue;

    const ageMs = Math.max(0, nowMs - occurredAtMs(it));
    const ageHours = ageMs / (1000 * 60 * 60);
    const ageDays = ageHours / 24;

    // Recency component (fresh + new)
    const halfLife = typeRecencyHalfLifeHours(it);
    let recency = Math.exp(-ageHours / halfLife); // 0..1
    // Slightly separate “just now” from “yesterday”
    recency = Math.pow(recency, 0.7);

    // Talked-about component (relative, log scaled)
    const rawTalk = talkedAboutRaw(it);
    const talkNorm = Math.log1p(rawTalk) / Math.log1p(maxTalk); // 0..1

    // Interaction boost should diminish significantly after 5 days
    const TALK_BOOST_CUTOFF_DAYS = 5;
    const talkAgePenalty =
      ageDays <= TALK_BOOST_CUTOFF_DAYS ? 1 : Math.exp(-(ageDays - TALK_BOOST_CUTOFF_DAYS) / 1.2); // hard drop

    // Viral “spike” should show… but still decay with age
    const viralNudge = isViralEnvironment && rawTalk === top1 ? 0.08 : 0;

    // Achievement component (big moments)
    const v10 = baseValueOutOf10(it, ageDays);
    const value = Math.min(1, Math.max(0, v10 / 10));
    const ach = isAchievement(it);

    // Achievements can resurface when feed is dead (no hard cutoff):
    // give achievements a slow-decaying floor so a 3 month old CR can appear only if everything else is basically 0.
    const achievementLongTail = ach ? Math.exp(-ageDays / 30) : 0;

    // Non-achievements should fade harder after ~2 weeks
    const nonAchLongTail = !ach ? Math.exp(-ageDays / 9) : Math.exp(-ageDays / 14);

    // --- Weights (your target): 65% freshness / 35% biggest moments ---
    // Freshness is split: recency dominates + talked-about secondary
    const freshness = recency * 0.72 + talkNorm * talkAgePenalty * 0.28 + viralNudge; // 0..~1.1
    const moments = value; // 0..1

    let score = freshness * 0.65 + moments * 0.35;

    // Apply “linger control” via long tails
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

function selectWithDiversity(scored: Scored[], count: number): FeedItemVM[] {
  // “Best item from a player unaffected; subsequent items gently deprioritised”
  const remaining = [...scored];
  const picked: FeedItemVM[] = [];
  const perActorCount = new Map<string, number>();

  while (picked.length < count && remaining.length) {
    let bestIdx = 0;
    let bestEff = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      const seen = perActorCount.get(s.actor) ?? 0;
      const penalty = seen === 0 ? 1 : Math.pow(0.86, seen); // gentle
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

function enforceAtLeastOneAchievement(
  pickedNonLive: FeedItemVM[],
  candidateNonLive: FeedItemVM[],
  nowMs: number
): FeedItemVM[] {
  // “Top 5 should always include at least 1 achievement if any exist in last 10 days”
  const ACH_WINDOW_DAYS = 10;

  const anyRecentAchievement = candidateNonLive.some((it) => {
    if (!isAchievement(it)) return false;
    const ageDays = Math.max(0, nowMs - occurredAtMs(it)) / (1000 * 60 * 60 * 24);
    return ageDays <= ACH_WINDOW_DAYS;
  });

  if (!anyRecentAchievement) return pickedNonLive;

  const alreadyHas = pickedNonLive.some((it) => isAchievement(it));
  if (alreadyHas) return pickedNonLive;

  // Find best recent achievement and swap it in for the last slot
  const candidates = candidateNonLive
    .filter((it) => isAchievement(it))
    .map((it) => {
      const ageDays = Math.max(0, nowMs - occurredAtMs(it)) / (1000 * 60 * 60 * 24);
      return { it, ageDays };
    })
    .filter((x) => x.ageDays <= ACH_WINDOW_DAYS);

  if (!candidates.length) return pickedNonLive;

  // Prefer strongest achievement score among recent ones
  const scored = scoreNonLiveItems(candidates.map((c) => c.it), nowMs).sort((a, b) => b.baseScore - a.baseScore);
  const bestAch = scored[0]?.it;
  if (!bestAch) return pickedNonLive;

  // If it's already in picked (rare), do nothing
  if (pickedNonLive.some((x) => x.id === bestAch.id)) return pickedNonLive;

  const out = [...pickedNonLive];
  if (out.length) out[out.length - 1] = bestAch;
  else out.push(bestAch);
  return out;
}

// ---------- Teaser UI helpers (avatar stack + vague copy) ----------

function pickCourseName(item: FeedItemVM): string | null {
  const p: any = item.payload ?? {};
  const c = p?.course_name ?? p?.course ?? p?.courseName ?? p?.course_title ?? p?.course_display_name ?? null;
  return typeof c === "string" && c.trim() ? c : null;
}

function miniFeedCopy(item: FeedItemVM): string {
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

type AvatarLike = { url: string | null; initials: string; key: string };

function initialsFromName(name: string): string {
  const s = String(name ?? "").trim();
  if (!s) return "C";
  const parts = s.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "C";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase();
}

function avatarLikeFromAny(x: any, fallbackKey: string): AvatarLike | null {
  if (!x) return null;
  const url = (typeof x.avatar_url === "string" && x.avatar_url.trim() ? x.avatar_url : null) as string | null;
  const name =
    (typeof x.display_name === "string" && x.display_name.trim() ? x.display_name : null) ??
    (typeof x.name === "string" && x.name.trim() ? x.name : null) ??
    null;
  const initials = initialsFromName(name ?? "CIAGA");
  const key = String(x.id ?? x.profile_id ?? x.user_id ?? fallbackKey);
  return { url, initials, key };
}

// Try to mimic “social page avatar stack” without relying on that component.
// We pull up to 3 distinct avatars (actor/subject/participants).
function avatarStack(item: FeedItemVM): AvatarLike[] {
  const p: any = item.payload ?? {};
  const cands: AvatarLike[] = [];

  const a = avatarLikeFromAny((item as any).actor, "actor");
  if (a) cands.push(a);

  const s = avatarLikeFromAny((item as any).subject, "subject");
  if (s) cands.push(s);

  const participants = Array.isArray(p?.participants) ? p.participants : Array.isArray(p?.players) ? p.players : [];
  if (Array.isArray(participants)) {
    for (let i = 0; i < participants.length; i++) {
      const v = avatarLikeFromAny(participants[i], `p${i}`);
      if (v) cands.push(v);
      if (cands.length >= 6) break;
    }
  }

  // de-dupe by key/url/initials
  const seen = new Set<string>();
  const out: AvatarLike[] = [];
  for (const c of cands) {
    const k = `${c.key}|${c.url ?? ""}|${c.initials}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= 3) break;
  }

  // Ensure we never render empty
  if (!out.length) out.push({ url: null, initials: "C", key: "ciaga" });
  return out;
}

// 1) Make avatars smaller (optional but helps the “skinnier” feel)
  function AvatarStack({ item }: { item: FeedItemVM }) {
    const avs = avatarStack(item);

    return (
      <div className="flex -space-x-2">
        {avs.map((a, idx) => (
          <div
            key={`${a.key}-${idx}`}
            className={[
              // was: h-8 w-8 text-[11px]
              "h-7 w-7 rounded-full border border-emerald-900/45 bg-emerald-900/15 overflow-hidden",
              "grid place-items-center text-[10px] font-extrabold text-emerald-50/90",
            ].join(" ")}
            style={{ zIndex: 10 - idx }}
          >
            {a.url ? (
              <img
                src={a.url}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
                draggable={false}
              />
            ) : (
              a.initials
            )}
          </div>
        ))}
      </div>
    );
  }

function MiniFeedTeaserCard({ item, onOpen }: { item: FeedItemVM; onOpen: () => void }) {
  const live = isLiveItem(item);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        "w-full text-left rounded-2xl border",
        live ? "border-emerald-300/35 bg-emerald-900/10" : "border-emerald-900/35 bg-emerald-950/10",
        // was: px-3 py-2.5 gap-3
        "px-2.5 py-2 hover:bg-emerald-950/15 transition",
        "flex items-center gap-2.5",
      ].join(" ")}
      aria-label="Open social"
      title="Open social"
    >
      <div className="shrink-0">
        <AvatarStack item={item} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div
            className={[
              // was: text-[12px]
              "text-[11px] font-extrabold text-emerald-50/95 leading-snug",
              // keep it to one line so it stays skinny
              "truncate",
            ].join(" ")}
          >
            {miniFeedCopy(item)}
          </div>

          {live ? (
            <span className="shrink-0 text-[9px] font-extrabold tracking-wide px-2 py-0.5 rounded-full bg-emerald-400/15 text-emerald-100 border border-emerald-300/25">
              LIVE
            </span>
          ) : null}
        </div>

        {/* ✅ removed the likes/comments metadata block entirely */}
      </div>
    </button>
  );
}

export default function CIAGAStarter() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("home");

  // viewport-driven layout values
  const [vw, setVw] = useState(390);
  const [vh, setVh] = useState(844);

  // ✅ Live round detection (for "Resume Round")
  const [liveRoundId, setLiveRoundId] = useState<string | null>(null);

  // ✅ Profile id (used for handicap + last round)
  const [myProfileId, setMyProfileId] = useState<string | null>(null);

  // ✅ Subtle home summary
  const [handicapIndex, setHandicapIndex] = useState<number | null>(null);
  const [handicapDelta30, setHandicapDelta30] = useState<number>(0);
  const [roundsPlayed, setRoundsPlayed] = useState<number | null>(null);

  const [lastRound, setLastRound] = useState<{
    course: string | null;
    tee: string | null;
    gross: number | null;
    net: number | null;
    diff: number | null;
    played_at: string | null; // ISO-ish
  } | null>(null);

  const [miniFeed, setMiniFeed] = useState<FeedItemVM[]>([]);
  const [miniFeedLoading, setMiniFeedLoading] = useState(false);
  const [miniFeedError, setMiniFeedError] = useState<string | null>(null);

  useEffect(() => {
    const updateViewport = () => {
      if (typeof window === "undefined") return;
      const w = window.visualViewport?.width ?? window.innerWidth;
      const h = window.visualViewport?.height ?? window.innerHeight;
      setVw(w);
      setVh(h);
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", updateViewport);
    vv?.addEventListener("scroll", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      vv?.removeEventListener("resize", updateViewport);
      vv?.removeEventListener("scroll", updateViewport);
    };
  }, []);

  // ✅ Fetch profile id once
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;
        if (!user) {
          if (!cancelled) setMyProfileId(null);
          return;
        }

        const pid = await getMyProfileIdByAuthUserId(user.id);
        if (!cancelled) setMyProfileId(pid ?? null);
      } catch {
        if (!cancelled) setMyProfileId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ✅ Fetch whether current user has a live round
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;
        if (!user) {
          if (!cancelled) setLiveRoundId(null);
          return;
        }

        const pid = await getMyProfileIdByAuthUserId(user.id);
        if (!pid) {
          if (!cancelled) setLiveRoundId(null);
          return;
        }

        // Step 1: all round_ids I'm a participant in
        const partRes = await supabase.from("round_participants").select("round_id").eq("profile_id", pid);
        if (partRes.error) throw partRes.error;

        const roundIds = (partRes.data ?? []).map((r: any) => r.round_id as string).filter(Boolean);

        if (!roundIds.length) {
          if (!cancelled) setLiveRoundId(null);
          return;
        }

        // Step 2: find most recent live round among those
        const roundsRes = await supabase
          .from("rounds")
          .select("id,status,started_at,created_at")
          .in("id", roundIds)
          .eq("status", "live")
          .order("started_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1);

        if (roundsRes.error) throw roundsRes.error;

        const id = (roundsRes.data?.[0]?.id as string | undefined) ?? null;
        if (!cancelled) setLiveRoundId(id);
      } catch {
        if (!cancelled) setLiveRoundId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ✅ Handicap (current + 30d delta) from handicap_index_history
  useEffect(() => {
    if (!myProfileId) {
      setHandicapIndex(null);
      setHandicapDelta30(0);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const today = new Date();
        const since = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sinceDate = since.toISOString().slice(0, 10); // YYYY-MM-DD

        const curRes = await supabase
          .from("handicap_index_history")
          .select("handicap_index,as_of_date")
          .eq("profile_id", myProfileId)
          .order("as_of_date", { ascending: false })
          .limit(1);

        const currentIndex = safeNum((curRes.data as any)?.[0]?.handicap_index);

        const baseRes = await supabase
          .from("handicap_index_history")
          .select("handicap_index,as_of_date")
          .eq("profile_id", myProfileId)
          .gte("as_of_date", sinceDate)
          .order("as_of_date", { ascending: true })
          .limit(1);

        const baselineIndex = safeNum((baseRes.data as any)?.[0]?.handicap_index);

        const delta =
          typeof currentIndex === "number" && typeof baselineIndex === "number" ? currentIndex - baselineIndex : 0;

        if (!cancelled) {
          setHandicapIndex(currentIndex);
          setHandicapDelta30(delta);
        }
      } catch {
        if (!cancelled) {
          setHandicapIndex(null);
          setHandicapDelta30(0);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [myProfileId]);

  // ✅ Rounds played (accepted handicap rounds)
  useEffect(() => {
    if (!myProfileId) {
      setRoundsPlayed(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await supabase
          .from("handicap_round_results")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", myProfileId)
          .eq("accepted", true);

        if (res.error) throw res.error;
        if (!cancelled) setRoundsPlayed(typeof res.count === "number" ? res.count : 0);
      } catch {
        if (!cancelled) setRoundsPlayed(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [myProfileId]);

  // ✅ Last round summary from handicap_round_results + tee/course snapshots
  useEffect(() => {
    if (!myProfileId) {
      setLastRound(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const rrRes = await supabase
          .from("handicap_round_results")
          .select("played_at,adjusted_gross_score,course_handicap_used,score_differential,tee_snapshot_id")
          .eq("profile_id", myProfileId)
          .eq("accepted", true)
          .order("played_at", { ascending: false })
          .limit(1);

        if (rrRes.error) throw rrRes.error;

        const rr: any = rrRes.data?.[0] ?? null;
        if (!rr) {
          if (!cancelled) setLastRound(null);
          return;
        }

        const gross = safeNum(rr.adjusted_gross_score);
        const ch = safeNum(rr.course_handicap_used);
        const net = typeof gross === "number" && typeof ch === "number" ? gross - ch : null;
        const diff = safeNum(rr.score_differential);
        const teeSnapshotId = typeof rr.tee_snapshot_id === "string" ? rr.tee_snapshot_id : null;

        let teeName: string | null = null;
        let courseName: string | null = null;

        if (teeSnapshotId) {
          const teeRes = await supabase
            .from("round_tee_snapshots")
            .select("name,round_course_snapshot_id")
            .eq("id", teeSnapshotId)
            .maybeSingle();

          if (!teeRes.error && teeRes.data) {
            teeName = typeof (teeRes.data as any).name === "string" ? (teeRes.data as any).name : null;
            const courseSnapId = (teeRes.data as any).round_course_snapshot_id as string | undefined;

            if (courseSnapId) {
              const courseRes = await supabase
                .from("round_course_snapshots")
                .select("course_name")
                .eq("id", courseSnapId)
                .maybeSingle();

              if (!courseRes.error && courseRes.data) {
                courseName =
                  typeof (courseRes.data as any).course_name === "string" ? (courseRes.data as any).course_name : null;
              }
            }
          }
        }

        if (!cancelled) {
          setLastRound({
            course: courseName,
            tee: teeName,
            gross,
            net,
            diff,
            played_at: typeof rr.played_at === "string" ? rr.played_at : null,
          });
        }
      } catch {
        if (!cancelled) setLastRound(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [myProfileId]);

  // ✅ Social Highlight (Top 5: Live reserved + scored “what’s new / talked about / big achievements”)
  useEffect(() => {
    if (!myProfileId) {
      setMiniFeed([]);
      setMiniFeedError(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setMiniFeedLoading(true);
      setMiniFeedError(null);

      try {
        const [liveRes, feedRes] = await Promise.all([fetchLiveFeedItems(), fetchFeed({ limit: 60 })]);

        const liveItemsRaw = ((liveRes as any)?.items as FeedItemVM[]) ?? [];
        const feedItemsRaw = ((feedRes as any)?.items as FeedItemVM[]) ?? [];

        // 1) Live: always top slots (up to 3), most recent first
        const liveItems = [...liveItemsRaw].sort(sortByOccurredAtDesc).slice(0, 3);

        // 2) De-dupe: don’t show same round twice if a live version exists
        const liveRoundIds = new Set<string>();
        for (const li of liveItems) {
          if (li.type === "round_played") {
            const rid = (li.payload as any)?.round_id as string | undefined;
            if (rid) liveRoundIds.add(rid);
          }
        }

        const filteredFeed = feedItemsRaw.filter((it) => {
          if (isLiveItem(it)) return false; // just in case
          if (it.type !== "round_played") return true;
          const rid = (it.payload as any)?.round_id as string | undefined;
          if (!rid) return true;
          return !liveRoundIds.has(rid);
        });

        // 3) Candidate pool is non-live feed items (recent first helps tie-break)
        const candidateNonLive = [...filteredFeed].sort(sortByOccurredAtDesc);

        const now = Date.now();

        // 4) Score non-live candidates and pick remaining slots
        const scored = scoreNonLiveItems(candidateNonLive, now);

        // If everything is basically dead, we still allow old achievements to surface
        // because achievements have a long-tail floor in the scoring.
        const remainingSlots = Math.max(0, 5 - liveItems.length);

        // Sort by base score desc then occurred time desc (for stable ordering before diversity selection)
        const scoredSorted = scored.sort((a, b) => {
          if (b.baseScore !== a.baseScore) return b.baseScore - a.baseScore;
          return occurredAtMs(b.it) - occurredAtMs(a.it);
        });

        let pickedNonLive = selectWithDiversity(scoredSorted, remainingSlots);

        // 5) Must include at least 1 achievement in top5 if any exist in last 10 days
        pickedNonLive = enforceAtLeastOneAchievement(pickedNonLive, candidateNonLive, now);

        // 6) Final mini feed: live first, then scored non-live
        const finalFeed = [...liveItems, ...pickedNonLive].slice(0, 5);

        if (!cancelled) setMiniFeed(finalFeed);
      } catch (e: any) {
        if (!cancelled) {
          setMiniFeed([]);
          setMiniFeedError(e?.message ?? "Failed to load feed");
        }
      } finally {
        if (!cancelled) setMiniFeedLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [myProfileId]);

  const homeMenuItems: MenuItem[] = useMemo(() => {
    return homeMenuItemsBase.map((it) =>
      it.id === "round" ? { ...it, label: liveRoundId ? "Resume Round" : "New Round" } : it
    );
  }, [liveRoundId]);

  const closedOffset = clamp(vh * 0.28, 170, 260);

  const goToMajors = () => {
    setOpen(false);
    setView("majors");
  };

  const goToHome = () => {
    setOpen(false);
    setView("home");
  };

  const handleHomeSelect = (id: string) => {
    setOpen(false);

    if (id === "courses") {
      router.push("/courses");
      return;
    }

    if (id === "round") {
      if (liveRoundId) router.push(`/round/${liveRoundId}`);
      else router.push("/round");
      return;
    }

    if (id === "history") {
      router.push("/history");
      return;
    }

    if (id === "stats") {
      router.push("/stats");
      return;
    }

    if (id === "social") {
      router.push("/social");
      return;
    }
  };

  const handleMajorsSelect = (id: string) => {
    setOpen(false);

    if (id === "majors-hub") {
      router.push("/majors");
      return;
    }
    if (id === "schedule") {
      router.push("/majors/schedule");
      return;
    }
    if (id === "leaderboard") {
      router.push("/majors/leaderboard");
      return;
    }
    if (id === "history") {
      router.push("/majors/history");
      return;
    }
    if (id === "profile") {
      router.push("/majors/profile");
      return;
    }
  };

  const wheelRadius = clamp(Math.min(vw, vh) * 0.38, 115, 170);
  const wheelSide = clamp(wheelRadius * 0.85, 90, 120);

  const wheelPositions = [
    { x: 0, y: -wheelRadius },
    { x: wheelSide, y: -wheelRadius * 0.38 },
    { x: wheelSide * 0.82, y: wheelRadius * 0.54 },
    { x: -wheelSide * 0.82, y: wheelRadius * 0.54 },
    { x: -wheelSide, y: -wheelRadius * 0.38 },
  ];

  const renderRadialMenu = (items: MenuItem[], onSelect: (id: string) => void) => (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 backdrop-blur-md z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />

          {items.map((item, index) => {
            const pos = wheelPositions[index] ?? { x: 0, y: 0 };

            return (
              <motion.button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto z-20 flex items-center justify-center rounded-full border border-emerald-200/70 bg-[#0b3b21]/95 px-4 py-2 shadow-lg text-xs font-medium tracking-wide"
                initial={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
                animate={{ opacity: 1, scale: 1, x: pos.x, y: pos.y }}
                exit={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
                transition={{
                  type: "spring",
                  stiffness: 260,
                  damping: 20,
                  delay: 0.05 * index,
                }}
              >
                {item.label}
              </motion.button>
            );
          })}
        </>
      )}
    </AnimatePresence>
  );

  const majorsHeaderAnchorRef = useRef<HTMLDivElement | null>(null);
  const [majorsClosedY, setMajorsClosedY] = useState<number | null>(null);
  const [majorsFallbackY, setMajorsFallbackY] = useState<number>(-200);
  const majorsNudge = clamp(vh * 0.018, 8, 20);

  const computeMajorsClosedY = useCallback(() => {
    const el = majorsHeaderAnchorRef.current;
    if (!el || typeof window === "undefined") return;

    const rect = el.getBoundingClientRect();
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height === 0) return;

    const anchorCenterY = rect.top + rect.height / 2;
    const viewportCenterY = (window.visualViewport?.height ?? window.innerHeight) / 2;

    const y = anchorCenterY - viewportCenterY;
    if (Number.isFinite(y)) setMajorsClosedY(y);
  }, []);

  useLayoutEffect(() => {
    if (view !== "majors") return;

    setMajorsClosedY(null);

    const h = window.visualViewport?.height ?? window.innerHeight;
    setMajorsFallbackY(-(h / 2) + h * 0.09);

    const el = majorsHeaderAnchorRef.current;
    if (!el) return;

    const run = () => computeMajorsClosedY();

    const raf = requestAnimationFrame(() => requestAnimationFrame(run));
    const t1 = window.setTimeout(run, 50);
    const t2 = window.setTimeout(run, 200);

    const onResize = () => run();
    window.addEventListener("resize", onResize);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", onResize);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => run());
      ro.observe(el);
    }

    (document as any)?.fonts?.ready?.then?.(() => run());

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onResize);
    };
  }, [view, computeMajorsClosedY]);

  // Exactly 5 teaser cards; no scrolling needed.
  const MINI_CARD_H = 44; // teaser height approx
  const MINI_GAP = 8; // space-y-2
  const miniFeedMaxH = MINI_CARD_H * 5 + MINI_GAP * 4;

  return (
    <AnimatePresence initial={false} mode="wait">
      {view === "home" ? (
        <motion.div
          key="home"
          className="h-[100dvh] bg-[#042713] text-slate-100 flex flex-col items-center justify-between pb-[env(safe-area-inset-bottom)] pt-8 px-4 overflow-hidden"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.22 }}
          drag="y"
          dragConstraints={{ top: -160, bottom: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.y < -80 || info.velocity.y < -500) {
              goToMajors();
            }
          }}
        >
          {/* HEADER */}
          <header className="w-full max-w-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[#0a341c]/70 backdrop-blur-sm border border-[#0a341c]/40 grid place-items-center">
                <Image
                  src="/ciaga-logo.png"
                  alt="CIAGA logo"
                  width={40}
                  height={40}
                  className="object-contain rounded-full"
                />
              </div>

              <div className="flex flex-col leading-tight">
                <span className="text-lg font-semibold tracking-wide text-[#f5e6b0]">CIAGA</span>
                <span className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Est. 2025</span>
              </div>
            </div>

            {/* Envelope + avatar */}
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="h-14 w-14 rounded-full grid place-items-center text-emerald-100/75 hover:text-emerald-50 hover:bg-emerald-900/25"
                onClick={() => {
                  // TODO: wire mailbox/notifications
                }}
                aria-label="Notifications"
                title="Notifications"
              >
                <EnvelopeIcon size={38} className="opacity-90" />
              </button>

              <div className="scale-[1.4] origin-top-right -translate-y-[4px]">
                <AuthUser />
              </div>
            </div>
          </header>

          {/* Subtle summary */}
          <motion.div
            className="w-full max-w-sm mt-4"
            initial={false}
            animate={{
              opacity: open ? 0.25 : 1,
              scale: open ? 0.995 : 1,
            }}
            transition={{ duration: 0.18 }}
            style={{
              filter: open ? "blur(2px)" : "blur(0px)",
              pointerEvents: open ? "none" : "auto",
            }}
          >
            {/* Handicap line */}
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">Handicap</div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="text-2xl font-extrabold text-[#f5e6b0] leading-none">
                    {typeof handicapIndex === "number" ? handicapIndex.toFixed(1) : "—"}
                  </span>
                  <span className="text-[11px] font-extrabold text-emerald-50/90">
                    {formatSigned(handicapDelta30, 1)}{" "}
                    <span className="text-emerald-100/60 font-semibold">/ 30d</span>
                  </span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">Rounds</div>
                <div className="mt-1 text-[12px] font-extrabold text-emerald-50/90">
                  {typeof roundsPlayed === "number" ? roundsPlayed : "—"}
                </div>
              </div>
            </div>

            <div className="mt-3 h-px bg-emerald-900/35" />

            {/* Last round line */}
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">Last Round</div>
                <div className="mt-1 text-sm font-extrabold text-emerald-50 truncate">
                  {lastRound?.course ?? "—"}
                  {lastRound?.tee ? <span className="text-emerald-100/70"> · {lastRound.tee}</span> : null}
                </div>
                {lastRound?.played_at ? (
                  <div className="mt-0.5 text-[11px] font-semibold text-emerald-100/60">
                    {new Date(lastRound.played_at).toLocaleDateString()}
                  </div>
                ) : null}
              </div>

              <div className="shrink-0 flex items-center gap-3">
                <div className="text-right">
                  <div className="text-[10px] font-extrabold text-emerald-100/45">G</div>
                  <div className="text-sm font-extrabold text-[#f5e6b0]">{lastRound?.gross ?? "—"}</div>
                </div>

                <div className="w-px h-8 bg-emerald-900/35" />

                <div className="text-right">
                  <div className="text-[10px] font-extrabold text-emerald-100/45">N</div>
                  <div className="text-sm font-extrabold text-emerald-50">{lastRound?.net ?? "—"}</div>
                </div>

                <div className="w-px h-8 bg-emerald-900/35" />

                <div className="text-right">
                  <div className="text-[10px] font-extrabold text-emerald-100/45">DIFF</div>
                  <div className="text-sm font-extrabold text-emerald-50">
                    {typeof lastRound?.diff === "number" ? lastRound.diff.toFixed(1) : "—"}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 h-px bg-emerald-900/35" />

            {/* Social Highlight */}
            <div className="mt-3 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">Social Highlights</div>
              <button
                type="button"
                className="text-[11px] font-extrabold text-emerald-100/80 hover:text-emerald-50"
                onClick={() => router.push("/social")}
              >
                Open →
              </button>
            </div>

            <div className="mt-3 space-y-2 pr-1 overflow-hidden" style={{ maxHeight: miniFeedMaxH }}>
              {miniFeedLoading ? (
                <div className="text-sm font-semibold text-emerald-100/70">Loading…</div>
              ) : miniFeed.length ? (
                miniFeed.map((it) => <MiniFeedTeaserCard key={it.id} item={it} onOpen={() => router.push("/social")} />)
              ) : miniFeedError ? (
                <div className="text-sm font-semibold text-red-200/90">{miniFeedError}</div>
              ) : (
                <div className="text-sm font-semibold text-emerald-100/70">Nothing new yet.</div>
              )}
            </div>
          </motion.div>

          <div className="relative flex-1 w-full max-w-sm">
            {renderRadialMenu(homeMenuItems, handleHomeSelect)}

            <motion.div
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-20 w-20 grid place-items-center z-30"
              initial={false}
              animate={{ y: open ? 0 : closedOffset }}
              transition={{ type: "spring", stiffness: 180, damping: 18 }}
            >
              <motion.button
                className="h-20 w-20 rounded-full bg-transparent grid place-items-center"
                onClick={() => setOpen((prev) => !prev)}
                whileTap={{ scale: 0.92 }}
                initial={false}
                animate={{ rotate: open ? 360 : 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 18 }}
              >
                <motion.div
                  className="h-[72px] w-[72px] rounded-full overflow-hidden flex items-center justify-center"
                  animate={{ scale: open ? 1.05 : 1 }}
                  transition={{ type: "spring", stiffness: 220, damping: 18 }}
                >
                  <Image src="/ciaga-logo.png" alt="CIAGA logo" width={72} height={72} className="object-contain" />
                </motion.div>
              </motion.button>
            </motion.div>
          </div>

          <footer className="mt-4 text-[10px] text-emerald-100/60 text-center">Tap to explore. Swipe up for Majors.</footer>
        </motion.div>
      ) : (
        <motion.div
          key="majors"
          className="min-h-screen bg-[#042713] text-slate-100 flex flex-col items-center pb-[env(safe-area-inset-bottom)] pt-8 px-4 overflow-visible"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.22 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 160 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.y > 80 || info.velocity.y > 500) {
              goToHome();
            }
          }}
        >
          <header className="w-full max-w-sm flex items-center justify-between relative z-50 overflow-visible">
            <div className="h-10 w-[132px]" />

            <div
              ref={majorsHeaderAnchorRef}
              className="absolute left-1/2 top-1/2 z-0"
              style={{
                width: 80,
                height: 80,
                opacity: 0,
                pointerEvents: "none",
                transform: `translate(-50%, -50%) translateY(${majorsNudge}px)`,
              }}
            />

            <div className="relative z-50 overflow-visible pointer-events-auto scale-[1.4] origin-top-right -translate-y-[4px]">
              <AuthUser />
            </div>
          </header>

          <div className="relative flex-1 w-full max-w-sm">
            {renderRadialMenu(majorsMenuItems, handleMajorsSelect)}

            <motion.div
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 flex flex-col items-center"
              initial={false}
              animate={{
                y: open ? 0 : majorsClosedY ?? majorsFallbackY,
                opacity: 1,
              }}
              transition={{ type: "spring", stiffness: 180, damping: 18 }}
            >
              <motion.button
                className="h-20 w-20 rounded-full bg-transparent grid place-items-center"
                onClick={() => setOpen((prev) => !prev)}
                whileTap={{ scale: 0.92 }}
                initial={false}
                animate={{ rotate: open ? 360 : 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 18 }}
              >
                <motion.div
                  className="h-[72px] w-[72px] rounded-full overflow-hidden flex items-center justify-center"
                  animate={{ scale: open ? 1.05 : 1 }}
                  transition={{ type: "spring", stiffness: 220, damping: 18 }}
                >
                  <Image src="/ciaga-logo.png" alt="CIAGA logo" width={72} height={72} className="object-contain" />
                </motion.div>
              </motion.button>

              <div className="mt-2 text-xs tracking-[0.18em] uppercase text-emerald-200/80">Majors</div>
            </motion.div>

            <motion.div
              className="w-full mt-24 space-y-3"
              initial={false}
              animate={{
                opacity: open ? 0.25 : 1,
                scale: open ? 0.995 : 1,
              }}
              transition={{ duration: 0.18 }}
              style={{
                filter: open ? "blur(2px)" : "blur(0px)",
                pointerEvents: open ? "none" : "auto",
              }}
            >
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
                <h2 className="text-sm font-semibold text-emerald-50 mb-1">Season Majors</h2>
                <p className="text-[11px] text-emerald-100/80">
                  Four flagship events with FedEx-style points. Swipe down to return home. Later we’ll wire in live standings and odds.
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-50">Major 1 · Spring</span>
                  <span className="text-emerald-200/80">Coming soon</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-emerald-100/80">
                  <span>Course: TBD</span>
                  <span>Points: —</span>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-50">Major 2 · Summer</span>
                  <span className="text-emerald-200/80">Coming soon</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-emerald-100/80">
                  <span>Course: TBD</span>
                  <span>Points: —</span>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}