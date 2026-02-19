"use client";

import Image from "next/image";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AuthUser } from "@/components/ui/auth-user";

import type { FeedItemVM } from "@/lib/feed/types";
import { fetchFeed, fetchLiveFeedItems } from "@/lib/social/api";

import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";

import {
  clamp,
  safeNum,
  formatSigned,
  sortByOccurredAtDesc,
  isLiveItem,
  occurredAtMs,
  scoreNonLiveItems,
  selectWithDiversity,
  enforceAtLeastOneAchievement,
} from "@/lib/feed/feedItemUtils";
import { MiniFeedTeaserCard } from "@/components/social/MiniFeedTeaser";
import { MajorsView } from "@/components/home/MajorsView";

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

  // ✅ Social Highlight (Top 5: Live reserved + scored "what's new / talked about / big achievements")
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

        // 2) De-dupe: don't show same round twice if a live version exists
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

        const remainingSlots = Math.max(0, 5 - liveItems.length);

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
        <MajorsView
          open={open}
          setOpen={setOpen}
          goToHome={goToHome}
          majorsMenuItems={majorsMenuItems}
          handleMajorsSelect={handleMajorsSelect}
          renderRadialMenu={renderRadialMenu}
          vh={vh}
        />
      )}
    </AnimatePresence>
  );
}
