"use client";

import Image from "next/image";
import { useState, useEffect, useLayoutEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AuthUser } from "@/components/ui/auth-user";

import type { FeedItemVM } from "@/lib/feed/types";
import type { HomeSummary, HomeCore, HomeMiniFeed } from "@/lib/home/getHomeSummary";

import { clamp, formatSigned } from "@/lib/feed/feedItemUtils";
import { formatHI } from "@/lib/rounds/handicapUtils";
import { MiniFeedTeaserCard } from "@/components/social/MiniFeedTeaser";
import { MajorsView } from "@/components/home/MajorsView";
import type { MajorHubSummary } from "@/lib/majors/types";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { getCachedHomeData, setCachedHomeData } from "@/lib/home/homeDataCache";
import NotificationCenter from "@/components/notifications/NotificationCenter";
import { useNotifications } from "@/lib/notifications/useNotifications";
import AnnouncementModal from "@/components/announcements/AnnouncementModal";
import { useAnnouncements } from "@/lib/announcements/useAnnouncements";
import PushPermissionPrompt from "@/components/notifications/PushPermissionPrompt";

type MenuItem = { id: string; label: string };

const homeMenuItemsBase: MenuItem[] = [
  { id: "round", label: "New Round" },
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

function BellIcon(props: { size?: number; className?: string }) {
  const s = props.size ?? 28;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={props.className} aria-hidden="true">
      <path
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V5a2 2 0 1 0-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Props = {
  initialData?: HomeSummary;
  initialMajors?: MajorHubSummary | null;
};

export default function HomeClient({ initialData, initialMajors }: Props) {
  const router = useRouter();

  const seed = initialData;

  // Show splash on first visit; skip on back navigation (splash_shown persists in sessionStorage).
  // useLayoutEffect runs before paint so returning users never see the overlay flash.
  const [showSplash, setShowSplash] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  useLayoutEffect(() => {
    if (sessionStorage.getItem("splash_shown") === "1") setShowSplash(false);
  }, []);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("home");

  const [vw, setVw] = useState(390);
  const [vh, setVh] = useState(844);

  const [liveRoundId, setLiveRoundId] = useState<string | null>(seed?.live_round_id ?? null);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);

  const [handicapIndex, setHandicapIndex] = useState<number | null>(seed?.handicap?.current ?? null);
  const [handicapDelta30, setHandicapDelta30] = useState<number>(seed?.handicap?.delta_30d ?? 0);
  const [roundsPlayed, setRoundsPlayed] = useState<number | null>(seed?.rounds_played ?? null);

  const [lastRound, setLastRound] = useState<{
    course: string | null;
    tee: string | null;
    gross: number | null;
    net: number | null;
    diff: number | null;
    played_at: string | null;
  } | null>(seed?.last_round ?? null);

  const [miniFeed, setMiniFeed] = useState<FeedItemVM[]>(seed?.mini_feed ?? []);
  const [miniFeedLoading, setMiniFeedLoading] = useState(false);
  const [miniFeedError, setMiniFeedError] = useState<string | null>(null);
  const [majorsPreload, setMajorsPreload] = useState<MajorHubSummary | null>(initialMajors ?? null);
  const [retryKey, setRetryKey] = useState(0);
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [actioningInvite, setActioningInvite] = useState<Record<string, "declining">>({});

  // Notifications + announcements are the lowest priority — don't let them
  // contend with the essential load. Hold them until the splash has cleared.
  const lowPriorityProfileId = dataReady ? myProfileId : null;
  const notif = useNotifications(lowPriorityProfileId);
  const announcements = useAnnouncements(lowPriorityProfileId);
  const pendingInvitesCount = majorsPreload?.pending_invites?.length ?? 0;
  const badgeCount = notif.unreadCount + pendingInvitesCount;

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

  // Home data fetch — uses module cache on back navigation, fetches fresh otherwise.
  // Loads in priority order: essential player info gates the splash; the social
  // feed + Majors hub stream in afterwards without blocking it.
  useEffect(() => {
    if (initialData) return;

    const applyCore = (data: HomeCore) => {
      setLiveRoundId(data.live_round_id ?? null);
      setHandicapIndex(data.handicap?.current ?? null);
      setHandicapDelta30(data.handicap?.delta_30d ?? 0);
      setRoundsPlayed(data.rounds_played ?? null);
      setLastRound(data.last_round ?? null);
    };

    // Serve cached data instantly on back navigation (no network, no loading state)
    const cached = getCachedHomeData();
    if (cached) {
      applyCore(cached.home);
      setMiniFeed((cached.home.mini_feed as FeedItemVM[]) ?? []);
      setMajorsPreload(cached.majors);
      setDataReady(true);
      setMiniFeedLoading(false);
      return;
    }

    let cancelled = false;
    let onlineRetryCleanup: (() => void) | null = null;
    // Safety net: never spin forever if the essential fetch wedges entirely.
    const timeoutId = setTimeout(() => { if (!cancelled) setDataReady(true); }, 10_000);

    const scheduleRetry = () => {
      if (onlineRetryCleanup) return;
      const handler = () => {
        if (!cancelled) setRetryKey((k) => k + 1);
      };
      window.addEventListener("online", handler, { once: true });
      onlineRetryCleanup = () => window.removeEventListener("online", handler);
    };

    (async () => {
      try {
        const session = await getViewerSession();
        if (!session || cancelled) {
          if (!cancelled) {
            setMyProfileId(null);
            setDataReady(true);
            router.replace("/auth");
          }
          return;
        }
        if (!cancelled) setMyProfileId(session.profileId);
        const authHeader = { Authorization: `Bearer ${session.accessToken}` };

        // ESSENTIAL — gates the splash. Kept small/fast so it resolves before
        // the 10s safety net and never dismisses the splash prematurely.
        const coreRes = await fetch("/api/home/summary?part=core", { headers: authHeader });
        if (cancelled) return;
        if (!coreRes.ok) {
          setDataReady(true);
          scheduleRetry();
          return;
        }
        const coreData = (await coreRes.json()) as HomeCore;
        if (cancelled) return;
        applyCore(coreData);
        setMiniFeedLoading(true);
        setMiniFeedError(null);
        setDataReady(true); // splash may dismiss now

        // LOW PRIORITY — background, never blocks the splash. The Majors hub is
        // fetched eagerly so the swipe-up view is hydrated if the user goes
        // straight there (MajorsHubPreview self-fetches as a fallback otherwise).
        const [feedRes, majorsRes] = await Promise.all([
          fetch("/api/home/summary?part=feed", { headers: authHeader }),
          fetch("/api/majors/hub", { headers: authHeader }),
        ]);
        if (cancelled) return;
        const feedData = feedRes.ok ? ((await feedRes.json()) as HomeMiniFeed) : null;
        const majorsData = majorsRes.ok ? ((await majorsRes.json()) as MajorHubSummary) : null;
        if (cancelled) return;

        const miniFeed = (feedData?.mini_feed as FeedItemVM[]) ?? [];
        setMiniFeed(miniFeed);
        setMajorsPreload(majorsData);
        setMiniFeedLoading(false);
        if (!feedRes.ok) setMiniFeedError("Failed to load");

        setCachedHomeData({ ...coreData, mini_feed: miniFeed }, majorsData);
      } catch (e: any) {
        if (!cancelled) {
          setMiniFeedError(e?.message ?? "Failed to load");
          setMiniFeedLoading(false);
          setDataReady(true);
          scheduleRetry();
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      onlineRetryCleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  const homeMenuItems: MenuItem[] = useMemo(() => {
    return homeMenuItemsBase.map((it) =>
      it.id === "round" ? { ...it, label: liveRoundId ? "Resume Round" : "New Round" } : it
    );
  }, [liveRoundId]);

  // Sit the closed wheel a touch lower to reclaim dead space for the mini feed.
  const closedOffset = clamp(vh * 0.34, 210, 300);

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

    if (id === "courses") { router.push("/courses"); return; }
    if (id === "round") {
      if (liveRoundId) router.push(`/round/${liveRoundId}`);
      else router.push("/round");
      return;
    }
    if (id === "history") { router.push("/history"); return; }
    if (id === "stats") { router.push("/stats"); return; }
    if (id === "social") { router.push("/social"); return; }
  };

  const handleMajorsSelect = (id: string) => {
    setOpen(false);

    if (id === "majors-hub") { router.push("/majors"); return; }
    if (id === "schedule") { router.push("/majors/schedule"); return; }
    if (id === "leaderboard") { router.push("/majors/leaderboard"); return; }
    if (id === "history") { router.push("/majors/history"); return; }
    if (id === "profile") { router.push("/majors/profile"); return; }
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

  // Mini cards now carry a second detail line, so they're a little taller.
  // The lower wheel frees vertical room to show them without clipping.
  const MINI_CARD_H = 52;
  const MINI_GAP = 8;
  const miniFeedMaxH = MINI_CARD_H * 5 + MINI_GAP * 4;

  return (
    <>
      {showSplash && (
        <LoadingScreen
          isReady={dataReady}
          onDone={() => {
            setShowSplash(false);
            window.dispatchEvent(new CustomEvent("splash:done"));
          }}
        />
      )}
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

            <div className="flex items-center gap-4">
              <button
                type="button"
                className="relative h-14 w-14 rounded-full grid place-items-center text-emerald-100/75 hover:text-emerald-50 hover:bg-emerald-900/25"
                onClick={() => setShowNotifications(true)}
                aria-label="Notifications"
                title="Notifications"
              >
                <BellIcon size={28} className="opacity-90" />
                {badgeCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-red-500 text-[10px] font-bold text-white border border-[#071c10]">
                    {badgeCount > 9 ? "9+" : badgeCount}
                  </span>
                )}
              </button>

              <div className="scale-[1.4] origin-top-right -translate-y-[4px]">
                <AuthUser />
              </div>
            </div>

            {/* Invite sheet */}
            {showInviteSheet && (majorsPreload?.pending_invites?.length ?? 0) > 0 && (
              <div
                className="fixed inset-0 z-50 flex items-end"
                onClick={() => setShowInviteSheet(false)}
              >
                <div className="absolute inset-0 bg-black/60" />
                <div
                  className="relative w-full rounded-t-3xl bg-[#071c10] border-t border-emerald-900/60 px-4 pt-4 pb-10 space-y-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="w-10 h-1 rounded-full bg-emerald-800/60 mx-auto mb-3" />
                  <div className="text-[11px] uppercase tracking-widest text-emerald-200/50 font-semibold mb-3">Group Invites</div>
                  {(majorsPreload?.pending_invites ?? []).map((inv) => {
                    const isActioning = !!actioningInvite[inv.group_id];
                    return (
                      <div
                        key={inv.group_id}
                        className="w-full flex items-center gap-3 rounded-2xl border border-emerald-900/50 bg-emerald-950/40 px-4 py-3"
                      >
                        <div className="h-9 w-9 rounded-full bg-emerald-900/60 grid place-items-center text-[11px] font-bold text-emerald-200 shrink-0 overflow-hidden">
                          {inv.group.image_url
                            ? <img src={inv.group.image_url} alt="" className="h-full w-full object-cover" />
                            : inv.group.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-emerald-50 truncate">{inv.group.name}</div>
                          <div className="text-[11px] text-emerald-200/50">You&apos;ve been invited</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={isActioning}
                            onClick={() => {
                              setShowInviteSheet(false);
                              router.push(`/majors/groups/${inv.group_id}?autoJoin=1`);
                            }}
                            className="text-[11px] font-semibold text-emerald-900 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-full px-3 py-1.5 leading-none"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            disabled={isActioning}
                            onClick={async () => {
                              if (!myProfileId) return;
                              setActioningInvite((prev) => ({ ...prev, [inv.group_id]: "declining" }));
                              try {
                                const session = await getViewerSession();
                                if (!session) return;
                                await fetch(`/api/majors/groups/${inv.group_id}/members?profile_id=${myProfileId}`, {
                                  method: "DELETE",
                                  headers: { Authorization: `Bearer ${session.accessToken}` },
                                });
                                setMajorsPreload((prev) => {
                                  if (!prev) return prev;
                                  const updated = prev.pending_invites.filter((i) => i.group_id !== inv.group_id);
                                  if (updated.length === 0) setShowInviteSheet(false);
                                  return { ...prev, pending_invites: updated };
                                });
                              } finally {
                                setActioningInvite((prev) => {
                                  const next = { ...prev };
                                  delete next[inv.group_id];
                                  return next;
                                });
                              }
                            }}
                            className="text-[11px] font-semibold text-emerald-200/60 hover:text-emerald-200 disabled:opacity-50 rounded-full border border-emerald-900/60 px-3 py-1.5 leading-none"
                          >
                            {isActioning ? "…" : "Decline"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <NotificationCenter
              open={showNotifications}
              onClose={() => setShowNotifications(false)}
              items={notif.items}
              loading={notif.loading}
              unreadCount={notif.unreadCount}
              markRead={notif.markRead}
              markAllRead={notif.markAllRead}
              pendingInvitesCount={pendingInvitesCount}
              onOpenInvites={() => setShowInviteSheet(true)}
            />

            {/* First-run onboarding + admin announcements (shown once each) */}
            {dataReady && !showSplash && (
              <AnnouncementModal items={announcements.items} onSeen={announcements.markSeen} />
            )}

            {/* Recurring push-permission prompt (3-month cooldown) — only once
                any pending announcement/onboarding has been cleared. */}
            {dataReady &&
              !showSplash &&
              myProfileId &&
              announcements.loaded &&
              announcements.items.length === 0 && (
                <PushPermissionPrompt profileId={myProfileId} suppressed={false} />
              )}
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
                    {typeof handicapIndex === "number" ? formatHI(handicapIndex) : "—"}
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
                miniFeed.map((it) => (
                  <MiniFeedTeaserCard
                    key={it.id}
                    item={it}
                    onOpen={() => router.push(`/social?focus=${encodeURIComponent(it.id)}`)}
                  />
                ))
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
          initialHub={majorsPreload}
        />
      )}
    </AnimatePresence>
    </>
  );
}
