"use client";

import { useState, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AuthUser } from "@/components/ui/auth-user";
import {
  Delta,
  Figures,
  Group,
  Hero,
  PageHeader,
  Row,
} from "@/components/ui/chrome";
import { ResumeRoundBar } from "@/components/home/ResumeRoundBar";

import type { FeedItemVM } from "@/lib/feed/types";
import type { HomeCore, HomeMiniFeed } from "@/lib/home/getHomeSummary";

import { pickCourseName } from "@/lib/feed/feedItemUtils";
import { formatHI } from "@/lib/rounds/handicapUtils";
import { MiniFeedTeaserCard } from "@/components/social/MiniFeedTeaser";
import type { MajorHubSummary } from "@/lib/majors/types";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import { markSplashReady } from "@/lib/ui/splashReady";
import { readCache, writeCache, setCacheScope } from "@/lib/cache/clientCache";
import NotificationCenter from "@/components/notifications/NotificationCenter";
import { useNotifications } from "@/lib/notifications/useNotifications";
import { useAppBadge } from "@/lib/notifications/useAppBadge";
import AnnouncementModal from "@/components/announcements/AnnouncementModal";
import { useAnnouncements } from "@/lib/announcements/useAnnouncements";
import PushPermissionPrompt from "@/components/notifications/PushPermissionPrompt";

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

/** Server-streamed core result — {ok} shaped so a failure can't reject across the RSC boundary. */
type CoreResult = { ok: true; data: HomeCore } | { ok: false; error: string };

/** Snapshot persisted so a cold start paints before Postgres is reached. */
type CachedHome = {
  core: HomeCore;
  mini_feed: FeedItemVM[];
  majors: MajorHubSummary | null;
};

const HOME_CACHE_KEY = "home";
// Worth showing a day-old handicap/last round while the fresh copy loads —
// it's replaced within a second and never silently: staleTime is 60s, so any
// visit past a minute revalidates immediately.
const HOME_CACHE_OPTS = { ttl: 24 * 60 * 60_000, staleTime: 60_000 };

type Props = {
  /** Pending promise for the essential (splash-gating) player info, streamed from the server. */
  initialCore?: Promise<CoreResult>;
  /** Pending promise for the low-priority feed + Majors hub, streamed behind the splash. */
  initialRest?: Promise<[HomeMiniFeed | null, MajorHubSummary | null]>;
  /** Server-resolved viewer id — skips the client-side session round trip. */
  initialProfileId?: string | null;
};

export default function HomeClient({ initialCore, initialRest, initialProfileId }: Props) {
  const router = useRouter();

  // The essential player info is on screen. Releases the cold-start splash
  // (which lives in the root layout — see components/ui/SplashHost.tsx) and
  // un-gates the low-priority work below.
  const [coreReady, setCoreReady] = useState(false);
  // The splash overlay has finished its exit. Modals wait for this so they
  // can't pop up behind it.
  const [splashDone, setSplashDone] = useState(false);

  const [liveRoundId, setLiveRoundId] = useState<string | null>(null);
  const [myProfileId, setMyProfileId] = useState<string | null>(initialProfileId ?? null);

  const [handicapIndex, setHandicapIndex] = useState<number | null>(null);
  const [handicapDelta30, setHandicapDelta30] = useState<number>(0);
  const [roundsPlayed, setRoundsPlayed] = useState<number | null>(null);

  const [lastRound, setLastRound] = useState<{
    course: string | null;
    tee: string | null;
    gross: number | null;
    net: number | null;
    diff: number | null;
    played_at: string | null;
  } | null>(null);

  const [miniFeed, setMiniFeed] = useState<FeedItemVM[]>([]);
  const [miniFeedLoading, setMiniFeedLoading] = useState(false);
  const [miniFeedError, setMiniFeedError] = useState<string | null>(null);
  const [majorsPreload, setMajorsPreload] = useState<MajorHubSummary | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [actioningInvite, setActioningInvite] = useState<Record<string, "declining">>({});

  // Notifications + announcements are the lowest priority — don't let them
  // contend with the essential load. Hold them until the splash has cleared.
  const lowPriorityProfileId = coreReady ? myProfileId : null;
  const notif = useNotifications(lowPriorityProfileId);
  const announcements = useAnnouncements(lowPriorityProfileId);
  const pendingInvitesCount =
    (majorsPreload?.pending_invites?.length ?? 0) +
    (majorsPreload?.pending_event_invites?.length ?? 0);
  const badgeCount = notif.unreadCount + pendingInvitesCount;

  // Mirror unread notifications onto the installed PWA's app-icon badge while
  // the app is open (the service worker sets it on push while it's closed).
  useAppBadge(notif.unreadCount);

  useEffect(() => {
    const onSplashDone = () => setSplashDone(true);
    window.addEventListener("splash:done", onSplashDone);
    try {
      // Repeat visit this session — SplashHost renders nothing, so no event fires.
      if (sessionStorage.getItem("splash_shown") === "1") setSplashDone(true);
    } catch {
      setSplashDone(true);
    }
    return () => window.removeEventListener("splash:done", onSplashDone);
  }, []);

  const applyCore = useCallback((data: HomeCore) => {
    setLiveRoundId(data.live_round_id ?? null);
    setHandicapIndex(data.handicap?.current ?? null);
    setHandicapDelta30(data.handicap?.delta_30d ?? 0);
    setRoundsPlayed(data.rounds_played ?? null);
    setLastRound(data.last_round ?? null);
  }, []);

  // Paint the last snapshot before anything touches the network, so a PWA cold
  // start shows the handicap, last round and highlights immediately and the
  // splash can exit rather than waiting on Postgres. The live data overwrites
  // this as soon as it streams in.
  //
  // Seeded in an effect, not a useState initialiser: the server renders this
  // page, and returning seeded values from the first client render would be a
  // hydration mismatch. useLayoutEffect runs before paint, so there's still no
  // flash of the empty "—" state.
  useLayoutEffect(() => {
    if (initialProfileId) setCacheScope(initialProfileId);

    const hit = readCache<CachedHome>(HOME_CACHE_KEY, HOME_CACHE_OPTS);
    if (!hit) return;

    applyCore(hit.data.core);
    setMiniFeed(hit.data.mini_feed ?? []);
    setMajorsPreload(hit.data.majors ?? null);
    setMiniFeedLoading(false);
    setCoreReady(true);
    markSplashReady();
  }, [initialProfileId, applyCore]);

  // Home data load. First render consumes the promises the server streamed
  // (core releases the splash; feed + Majors fill in behind it). On a retry —
  // or when the promises are absent — it falls back to the client fetch.
  useEffect(() => {
    let cancelled = false;
    let onlineRetryCleanup: (() => void) | null = null;

    // The essential info is on screen: release the splash and un-gate the
    // low-priority work.
    const releaseCore = () => {
      setCoreReady(true);
      markSplashReady();
    };

    // Safety net: never spin forever if the essential load wedges entirely.
    const timeoutId = setTimeout(() => { if (!cancelled) releaseCore(); }, 10_000);

    const scheduleRetry = () => {
      if (onlineRetryCleanup) return;
      const handler = () => {
        if (!cancelled) setRetryKey((k) => k + 1);
      };
      window.addEventListener("online", handler, { once: true });
      onlineRetryCleanup = () => window.removeEventListener("online", handler);
    };

    // ── Streamed path: consume the server-provided promises (first render only;
    //    on retry they're stale, so we fall through to a real client fetch). ──
    if (initialCore && retryKey === 0) {
      // A promise passed from a Server Component arrives as a React thenable
      // whose `.then()` isn't a chainable native Promise. Normalise with
      // Promise.resolve so `.then/.catch/.all` behave.
      const corePromise = Promise.resolve(initialCore);
      const restPromise = initialRest ? Promise.resolve(initialRest) : Promise.resolve(null);

      corePromise
        .then((r) => {
          if (cancelled) return;
          if (r.ok) {
            applyCore(r.data);
            setMiniFeedLoading(true);
            setMiniFeedError(null);
            releaseCore(); // splash may dismiss now
          } else {
            setMiniFeedError(r.error);
            releaseCore();
            scheduleRetry();
          }
        })
        .catch(() => { if (!cancelled) releaseCore(); });

      restPromise.then((rest) => {
        if (cancelled) return;
        const feed = (rest?.[0]?.mini_feed as FeedItemVM[]) ?? [];
        setMiniFeed(feed);
        setMajorsPreload(rest?.[1] ?? null);
        setMiniFeedLoading(false);
      });

      // Persist the snapshot once both have settled, for the next cold start.
      Promise.all([corePromise, restPromise]).then(([cr, rest]) => {
        if (cancelled || !cr.ok) return;
        writeCache<CachedHome>(
          HOME_CACHE_KEY,
          {
            core: cr.data,
            mini_feed: (rest?.[0]?.mini_feed as FeedItemVM[]) ?? [],
            majors: rest?.[1] ?? null,
          },
          HOME_CACHE_OPTS
        );
      });

      return () => {
        cancelled = true;
        clearTimeout(timeoutId);
        onlineRetryCleanup?.();
      };
    }

    // ── Fallback / retry: client-side fetch (the original path). ──
    // The layout effect above has already painted the snapshot if there was
    // one; skip the network entirely while it's still inside the stale window.
    // A retry is an explicit "try again", so it always goes to the network.
    const cached = retryKey === 0 ? readCache<CachedHome>(HOME_CACHE_KEY, HOME_CACHE_OPTS) : null;
    if (cached && !cached.isStale) {
      releaseCore();
      clearTimeout(timeoutId);
      return () => { cancelled = true; };
    }

    (async () => {
      try {
        const session = await getViewerSession();
        if (!session || cancelled) {
          if (!cancelled) {
            setMyProfileId(null);
            releaseCore();
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
          releaseCore();
          scheduleRetry();
          return;
        }
        const coreData = (await coreRes.json()) as HomeCore;
        if (cancelled) return;
        applyCore(coreData);
        setMiniFeedLoading(true);
        setMiniFeedError(null);
        releaseCore(); // splash may dismiss now

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

        writeCache<CachedHome>(
          HOME_CACHE_KEY,
          { core: coreData, mini_feed: miniFeed, majors: majorsData },
          HOME_CACHE_OPTS
        );
      } catch (e: any) {
        if (!cancelled) {
          setMiniFeedError(e?.message ?? "Failed to load");
          setMiniFeedLoading(false);
          releaseCore();
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

  // Highlights are rows, not spaced cards, and they run one type size quieter
  // than the groups above them — they're the screen's background reading, not
  // its headline. Still capped at five; curateMiniFeed slices to the same.
  const MINI_ROW_H = 40;
  const miniFeedMaxH = MINI_ROW_H * 5;

  // The resume bar's sub-line. Core knows the live round's id but not where it
  // is being played, and the mini feed already carries a live item for the same
  // round — so read it from there rather than pay for a second query. It arrives
  // after core does, so the bar renders unlabelled for a beat.
  const liveRoundHint = liveRoundId
    ? (miniFeed
        .filter((it) => (it.payload as any)?.round_id === liveRoundId)
        .map(pickCourseName)
        .find(Boolean) ?? null)
    : null;

  return (
    // The resume bar floats over the scroll, so the last highlight needs room to
    // clear it — its own height plus the gap it sits on above the nav.
    <div
      className="min-h-[100dvh] flex flex-col items-center px-4"
      style={liveRoundId ? { paddingBottom: 64 } : undefined}
    >
          {/* HEADER */}
          <header className="w-full max-w-sm">
            {/* The brand lockup — mark and wordmark as one thing. The mark is
                back at 26px: at 40px beside 13px type it had nothing anchoring
                it, which is why it read as two objects rather than a signature. */}
            <PageHeader
              brand
              title="CIAGA"
              subtitle="Est. 2025"
              actions={
                <>
                  <button
                    type="button"
                    className="relative grid h-11 w-11 place-items-center rounded-full text-[color:var(--sec-text-2)] transition-colors hover:bg-[color:var(--sec-surface)] hover:text-[color:var(--sec-text)]"
                    onClick={() => setShowNotifications(true)}
                    aria-label="Notifications"
                    title="Notifications"
                  >
                    <BellIcon size={26} />
                    {badgeCount > 0 && (
                      <span className="absolute right-0 top-0 grid h-[19px] min-w-[19px] place-items-center rounded-full border-2 border-[color:var(--ciaga-ground)] bg-red-500 px-1 text-[10px] font-semibold text-white">
                        {badgeCount > 9 ? "9+" : badgeCount}
                      </span>
                    )}
                  </button>

                  <AuthUser size={38} />
                </>
              }
            />

            {/* Invite sheet — portalled to <body> so drags inside it don't bubble
                into this screen's drag-to-Majors handler. */}
            {showInviteSheet &&
              typeof document !== "undefined" &&
              ((majorsPreload?.pending_invites?.length ?? 0) +
                (majorsPreload?.pending_event_invites?.length ?? 0)) >
                0 &&
              createPortal(
              <div
                className="fixed inset-0 z-50 flex items-end"
                onClick={() => setShowInviteSheet(false)}
              >
                <div className="absolute inset-0 bg-black/60" />
                <div
                  className="relative w-full rounded-t-3xl bg-[color:var(--ciaga-ground)] border-t border-[color:var(--sec-hair)] px-4 pt-4 pb-10 space-y-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="w-10 h-1 rounded-full bg-[color:var(--sec-surface-2)] mx-auto mb-3" />
                  {(majorsPreload?.pending_invites?.length ?? 0) > 0 && (
                    <div className="text-[11px] uppercase tracking-widest text-[color:var(--sec-muted)] font-semibold mb-3">Group Invites</div>
                  )}
                  {(majorsPreload?.pending_invites ?? []).map((inv) => {
                    const isActioning = !!actioningInvite[inv.group_id];
                    return (
                      <div
                        key={inv.group_id}
                        className="w-full flex items-center gap-3 rounded-2xl border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] px-4 py-3"
                      >
                        <div className="h-9 w-9 rounded-full bg-[color:var(--sec-surface)] grid place-items-center text-[11px] font-bold text-[color:var(--sec-text-2)] shrink-0 overflow-hidden">
                          {inv.group.image_url
                            ? <img src={inv.group.image_url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                            : inv.group.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[color:var(--sec-text)] truncate">{inv.group.name}</div>
                          <div className="text-[11px] text-[color:var(--sec-muted)]">You&apos;ve been invited</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={isActioning}
                            onClick={() => {
                              setShowInviteSheet(false);
                              router.push(`/majors/groups/${inv.group_id}?autoJoin=1`);
                            }}
                            className="text-[11px] font-semibold text-[color:var(--ciaga-ground)] bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-full px-3 py-1.5 leading-none"
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
                                const session = await requireViewerSession();
                                if (!session) return;
                                await fetch(`/api/majors/groups/${inv.group_id}/members?profile_id=${myProfileId}`, {
                                  method: "DELETE",
                                  headers: { Authorization: `Bearer ${session.accessToken}` },
                                });
                                setMajorsPreload((prev) => {
                                  if (!prev) return prev;
                                  const updated = prev.pending_invites.filter((i) => i.group_id !== inv.group_id);
                                  if (updated.length === 0 && (prev.pending_event_invites?.length ?? 0) === 0) setShowInviteSheet(false);
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
                            className="text-[11px] font-semibold text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text-2)] disabled:opacity-50 rounded-full border border-[color:var(--sec-hair)] px-3 py-1.5 leading-none"
                          >
                            {isActioning ? "…" : "Decline"}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {(majorsPreload?.pending_event_invites?.length ?? 0) > 0 && (
                    <div className="text-[11px] uppercase tracking-widest text-[color:var(--sec-muted)] font-semibold mb-3 mt-1">Event Invites</div>
                  )}
                  {(majorsPreload?.pending_event_invites ?? []).map((inv) => {
                    const isActioning = !!actioningInvite[inv.event_id];
                    return (
                      <div
                        key={inv.event_id}
                        className="w-full flex items-center gap-3 rounded-2xl border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] px-4 py-3"
                      >
                        <div className="h-9 w-9 rounded-full bg-[color:var(--sec-surface)] grid place-items-center text-[11px] font-bold text-[color:var(--sec-text-2)] shrink-0">
                          {inv.event.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[color:var(--sec-text)] truncate">{inv.event.name}</div>
                          <div className="text-[11px] text-[color:var(--sec-muted)] truncate">
                            {inv.group_name ? `${inv.group_name} · ` : ""}You&apos;ve been invited
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={isActioning}
                            onClick={() => {
                              setShowInviteSheet(false);
                              router.push(`/majors/events/${inv.event_id}?autoEnter=1`);
                            }}
                            className="text-[11px] font-semibold text-[color:var(--ciaga-ground)] bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-full px-3 py-1.5 leading-none"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            disabled={isActioning}
                            onClick={async () => {
                              if (!myProfileId) return;
                              setActioningInvite((prev) => ({ ...prev, [inv.event_id]: "declining" }));
                              try {
                                const session = await requireViewerSession();
                                if (!session) return;
                                await fetch(`/api/majors/events/${inv.event_id}/invitations?profile_id=${myProfileId}`, {
                                  method: "DELETE",
                                  headers: { Authorization: `Bearer ${session.accessToken}` },
                                });
                                setMajorsPreload((prev) => {
                                  if (!prev) return prev;
                                  const updated = prev.pending_event_invites.filter((i) => i.event_id !== inv.event_id);
                                  if (updated.length === 0 && (prev.pending_invites?.length ?? 0) === 0) setShowInviteSheet(false);
                                  return { ...prev, pending_event_invites: updated };
                                });
                              } finally {
                                setActioningInvite((prev) => {
                                  const next = { ...prev };
                                  delete next[inv.event_id];
                                  return next;
                                });
                              }
                            }}
                            className="text-[11px] font-semibold text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text-2)] disabled:opacity-50 rounded-full border border-[color:var(--sec-hair)] px-3 py-1.5 leading-none"
                          >
                            {isActioning ? "…" : "Decline"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>,
              document.body
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
              profileId={myProfileId}
            />

            {/* First-run onboarding + admin announcements (shown once each) */}
            {coreReady && splashDone && (
              <AnnouncementModal items={announcements.items} onSeen={announcements.markSeen} />
            )}

            {/* Recurring push-permission prompt (3-month cooldown) — only once
                any pending announcement/onboarding has been cleared. */}
            {coreReady &&
              splashDone &&
              myProfileId &&
              announcements.loaded &&
              announcements.items.length === 0 && (
                <PushPermissionPrompt profileId={myProfileId} suppressed={false} />
              )}
          </header>

          <div className="w-full max-w-sm">
            <Group label="Handicap">
              {/* The 30-day move rides the index rather than sitting under it in
                  prose: it is the same measurement, one step down in size. An
                  arrow, not a ± — a falling index is an improvement, and the
                  sign alone can't say so. */}
              <Hero
                figure={
                  <span className="flex items-baseline gap-2">
                    <span>{typeof handicapIndex === "number" ? formatHI(handicapIndex) : "—"}</span>
                    {typeof handicapIndex === "number" ? (
                      <Delta value={handicapDelta30} digits={1} />
                    ) : null}
                  </span>
                }
                caption="Index · last 30 days"
                sideLabel="Rounds"
                sideValue={typeof roundsPlayed === "number" ? roundsPlayed : "—"}
              />
            </Group>

            <Group label="Last round">
              {/* One band, not two. Gross, net and differential are small enough
                  to sit beside the course they belong to, and the whole row is
                  the way into the full history. */}
              <Row
                href="/history"
                title={lastRound?.course ?? "—"}
                subtitle={
                  [
                    lastRound?.played_at
                      ? new Date(lastRound.played_at).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                        })
                      : null,
                    lastRound?.tee ?? null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
                trailing={
                  <Figures
                    items={[
                      { label: "Gross", value: lastRound?.gross ?? "—", tone: "accent" },
                      { label: "Net", value: lastRound?.net ?? "—" },
                      {
                        label: "Diff",
                        value:
                          typeof lastRound?.diff === "number" ? lastRound.diff.toFixed(1) : "—",
                      },
                    ]}
                  />
                }
              />
            </Group>

            <Group
              label="Highlights"
              action={
                <button
                  type="button"
                  className="hover:text-[color:var(--sec-text)]"
                  onClick={() => router.push("/social")}
                >
                  Open ›
                </button>
              }
            >
              <div className="overflow-hidden" style={{ maxHeight: miniFeedMaxH }}>
                {/* Cached highlights stay on screen while the fresh ones load —
                    "Loading…" is only for a genuine cold miss. */}
                {miniFeed.length ? (
                  miniFeed.map((it) => (
                    <MiniFeedTeaserCard
                      key={it.id}
                      item={it}
                      onOpen={() => router.push(`/social?focus=${encodeURIComponent(it.id)}`)}
                    />
                  ))
                ) : miniFeedLoading ? (
                  <div className="py-3 text-[length:var(--t-body)] text-[color:var(--sec-muted)]">
                    Loading…
                  </div>
                ) : miniFeedError ? (
                  <div className="py-3 text-[length:var(--t-body)] text-[color:var(--sec-bad)]">{miniFeedError}</div>
                ) : (
                  <div className="py-3 text-[length:var(--t-body)] text-[color:var(--sec-muted)]">
                    Nothing new yet.
                  </div>
                )}
              </div>
            </Group>

          </div>

          {/* Starting a round is the Play tab's job now. What's left is getting
              back into one already underway, which floats above the bar rather
              than waiting at the bottom of the scroll. */}
          {liveRoundId ? <ResumeRoundBar roundId={liveRoundId} hint={liveRoundHint} /> : null}
        </div>
  );
}
