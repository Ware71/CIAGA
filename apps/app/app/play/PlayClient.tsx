"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, History, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";
import { Group, PageHeader, PrimaryAction } from "@/components/ui/chrome";
import { TileCard } from "@/components/ui/TileCard";
import { RoundCard } from "@/components/rounds/RoundCard";
import { Skeleton } from "@/components/ui/skeleton";
import { createRound, newRoundSetupHref } from "@/lib/rounds/createRound";

/**
 * The Play hub — the 4th tab, and the round list that used to live at /round.
 *
 * Order is deliberate: your record, then the one action, then a way to find a
 * game, then everything already on your card. The primary action is the whole
 * point of the tab, so it never drops below the fold.
 *
 * A live round REPLACES the New round button here rather than floating a resume
 * bar over it the way Home does — on a screen this is about, a second control
 * saying the same thing is noise.
 */

type LinkedEvent = {
  id: string;
  name: string;
  event_type: string;
} | null;

type TeeRef = { id: string; name: string | null } | null;

type RoundRow = {
  id: string;
  name: string | null;
  status: "draft" | "scheduled" | "starting" | "live" | "finished";
  started_at: string | null;
  created_at: string;
  course_id: string | null;
  scheduled_at: string | null;
  event_tee_time_id: string | null;
  pending_tee_box_id: string | null;
  courses?: { name: string | null } | null;
  /** The round's default tee, used when the viewer has no override. */
  default_tee?: TeeRef;
  /** Populated when the round is linked to a Majors tee time */
  linked_event?: LinkedEvent;
  /** The viewer's role on this round (owner vs scorer/player) */
  myRole?: "owner" | "scorer" | "player";
  /** Resolved viewer's tee name — see resolveMyTeeName. */
  myTee?: string | null;
};

type ParticipantRow = {
  id: string;
  role: "owner" | "scorer" | "player";
  pending_tee_box_id: string | null;
  tee_snapshot_id: string | null;
  my_tee_box?: TeeRef;
  my_tee_snapshot?: TeeRef;
  round: RoundRow;
};

/**
 * Which tee this player is on, in precedence order.
 *
 * A round's tees move table when it starts: before that they are a pointer into
 * the live course catalogue, after it a frozen snapshot (so a club re-rating a
 * tee can't rewrite a played round). A participant may also override the round
 * default with their own. So: my snapshot, then my override, then the round's
 * default, then nothing.
 */
function resolveMyTeeName(p: ParticipantRow): string | null {
  return (
    p.my_tee_snapshot?.name ??
    p.my_tee_box?.name ??
    p.round?.default_tee?.name ??
    null
  );
}

function ConfirmSheet(props: {
  title: string;
  subtitle?: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { title, subtitle, confirmLabel, confirmDisabled, onConfirm, onClose } = props;

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />
      <div className="absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-[520px] rounded-t-3xl border border-[color:var(--sec-hair)] bg-[color:var(--ciaga-ground)] shadow-2xl overflow-hidden">
          <div className="p-4 border-b border-[color:var(--sec-hair)]">
            <div className="text-sm font-semibold text-[color:var(--sec-text)]">{title}</div>
            {subtitle ? <div className="text-[11px] text-[color:var(--sec-muted)] mt-1">{subtitle}</div> : null}
          </div>

          <div className="p-4 flex gap-2">
            <Button
              variant="ghost"
              className="flex-1 rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
              onClick={onClose}
              disabled={!!confirmDisabled}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-2xl bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
              onClick={onConfirm}
              disabled={!!confirmDisabled}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Swipe-left to reveal a destructive action.
 *
 * Rounded to match the card it wraps, and it owns the gap between cards: its
 * overflow-hidden clips the reveal rail to this box, so a margin on the card
 * itself would leave a strip of red showing between rows mid-swipe.
 */
function SwipeToDeleteRow(props: {
  children: React.ReactNode;
  enabled: boolean;
  onDelete: () => void;
  deleting?: boolean;
  actionLabel?: string;
}) {
  const { children, enabled, onDelete, deleting, actionLabel } = props;

  const maxReveal = 96; // px
  const threshold = 12; // px before we decide direction
  const openThreshold = 48; // px to snap open

  const [x, setX] = useState(0);
  const [open, setOpen] = useState(false);

  const start = useRef<{ x: number; y: number } | null>(null);
  const locked = useRef<"none" | "h" | "v">("none");

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  function close() {
    setOpen(false);
    setX(0);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!enabled) return;

    start.current = { x: e.clientX, y: e.clientY };
    locked.current = "none";

    // Important: capture so we keep getting moves even if finger leaves element
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!enabled) return;
    if (!start.current) return;

    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;

    // Decide direction (lock)
    if (locked.current === "none") {
      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
        locked.current = "h";
      } else if (Math.abs(dy) > threshold && Math.abs(dy) > Math.abs(dx)) {
        locked.current = "v";
      } else {
        return;
      }
    }

    // If vertical scroll, do nothing (let the page scroll)
    if (locked.current === "v") return;

    // Horizontal swipe: stop the browser from scrolling vertically
    e.preventDefault();

    // Only allow swipe left
    setX(clamp(dx, -maxReveal, 0));
  }

  function onPointerUp() {
    if (!enabled) return;

    // If we never locked to horizontal, keep existing state
    if (locked.current !== "h") {
      start.current = null;
      locked.current = "none";
      return;
    }

    const shouldOpen = x < -openThreshold;
    setOpen(shouldOpen);
    setX(shouldOpen ? -maxReveal : 0);

    start.current = null;
    locked.current = "none";
  }

  const showRail = enabled && (open || x < -10);

  return (
    <div className="relative mb-2 overflow-hidden rounded-[var(--r-ui)] last:mb-0">
      {/* Rail: hidden unless swiping/open */}
      <div
        className={[
          "absolute inset-y-0 right-0 w-[96px] flex items-stretch transition-opacity",
          showRail ? "opacity-100" : "opacity-0 pointer-events-none",
        ].join(" ")}
      >
        <button
          className="w-full bg-red-600 text-white text-sm font-semibold"
          onClick={() => {
            close();
            onDelete();
          }}
          disabled={!!deleting}
        >
          {deleting ? "…" : (actionLabel ?? "Delete")}
        </button>
      </div>

      {/* Foreground */}
      <div
        // Key: let the browser know vertical pan is allowed, horizontal is handled by us
        style={{ transform: `translateX(${x}px)`, touchAction: enabled ? "pan-y" : "auto" }}
        className="will-change-transform"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* If row is open and user taps it, close instead of navigating */}
        <div
          onClickCapture={(e) => {
            if (open) {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default function PlayClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<ParticipantRow[]>([]);

  const [confirmAction, setConfirmAction] = useState<{ id: string; type: "delete" | "withdraw" } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creatingRound, setCreatingRound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/auth");
        return;
      }

      const myProfileId = await getMyProfileIdByAuthUserId(auth.user.id);

      // The two tee embeds are the viewer's own tee, which lives in a different
      // table either side of the round starting — see resolveMyTeeName. Both are
      // FK embeds on named constraints, so the whole card is still one round trip.
      const { data, error } = await supabase
        .from("round_participants")
        .select(`id, role, pending_tee_box_id, tee_snapshot_id,
          my_tee_box:course_tee_boxes!round_participants_pending_tee_box_id_fkey(id, name),
          my_tee_snapshot:round_tee_snapshots!fk_round_participants_tee_snapshot(id, name),
          round:rounds!round_id(
          id, name, status, started_at, created_at, course_id, scheduled_at,
          event_tee_time_id, pending_tee_box_id,
          courses(name),
          default_tee:course_tee_boxes!rounds_pending_tee_box_id_fkey(id, name),
          event_tee_time:event_tee_times!event_tee_time_id(
            event_id,
            events!event_id(id, name, event_type)
          )
        )`)
        .eq("profile_id", myProfileId)
        .not("rounds.status", "in", "(finished)") // Exclude finished rounds
        .order("created_at", { ascending: false, referencedTable: "rounds" as any });

      if (cancelled) return;

      if (error) {
        setErr(error.message);
        setRows([]);
      } else {
        setRows((data ?? []) as any);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const rounds = useMemo(() => {
    return rows
      .map((r) => {
        const round = r.round as any;
        if (!round) return null;
        // Flatten the nested event join into a top-level field
        const teeTimeJoin = round.event_tee_time;
        const linked_event: LinkedEvent = teeTimeJoin?.events ?? null;
        return {
          ...round,
          linked_event,
          myRole: r.role,
          myTee: resolveMyTeeName(r),
        } as RoundRow;
      })
      .filter(Boolean)
      .sort((a, b) => {
        const ra = a as RoundRow;
        const rb = b as RoundRow;
        // Group order: in-progress (live/starting) → drafts → scheduled.
        const group = (r: RoundRow) =>
          r.status === "live" || r.status === "starting" ? 0 : r.status === "draft" ? 1 : 2;
        const ga = group(ra);
        const gb = group(rb);
        if (ga !== gb) return ga - gb;

        // Scheduled: soonest first (ISO sorts lexicographically); undated last.
        if (ga === 2) {
          const sa = ra.scheduled_at;
          const sb = rb.scheduled_at;
          if (sa && sb) return sa.localeCompare(sb);
          if (sa) return -1;
          if (sb) return 1;
        }

        // In-progress & drafts: newest first.
        return (rb.created_at ?? "").localeCompare(ra.created_at ?? "");
      }) as RoundRow[];
  }, [rows]);

  // The list already carries the live round, so the primary action needs no
  // second query to know whether it should say Resume.
  const liveRound = useMemo(
    () => rounds.find((r) => r.status === "live" || r.status === "starting") ?? null,
    [rounds]
  );

  async function handleCreateNewRound() {
    setCreatingRound(true);
    setErr(null);

    try {
      // Shared with the nav wheel's "New round" — see lib/rounds/createRound.
      const roundId = await createRound();
      router.push(newRoundSetupHref(roundId));
    } catch (e: any) {
      setErr(e?.message || "Failed to create round");
      setCreatingRound(false);
    }
  }

  async function deleteDraft(roundId: string) {
    setErr(null);
    setDeletingId(roundId);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated.");

      const res = await fetch("/api/rounds/delete-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ round_id: roundId }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);

      // Optimistic remove from UI
      setRows((prev) => prev.filter((p) => p.round?.id !== roundId));
    } catch (e: any) {
      setErr(e?.message || "Failed to delete draft");
    } finally {
      setDeletingId(null);
      setConfirmAction(null);
    }
  }

  async function withdrawRound(roundId: string) {
    setErr(null);
    setDeletingId(roundId);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated.");

      const res = await fetch("/api/rounds/withdraw", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ round_id: roundId }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);

      // Optimistic remove from UI
      setRows((prev) => prev.filter((p) => p.round?.id !== roundId));
    } catch (e: any) {
      setErr(e?.message || "Failed to withdraw from round");
    } finally {
      setDeletingId(null);
      setConfirmAction(null);
    }
  }

  const liveRoundHint =
    liveRound?.courses?.name ?? liveRound?.linked_event?.name ?? liveRound?.name ?? "You have a round in progress";

  return (
    <div className="min-h-screen px-4 pb-4">
      <div className="mx-auto w-full max-w-sm">
        {/* Tab root, so no back link. The calendar lost its tab to this screen
            and lives here instead — it is scheduling, which is a play task. */}
        <PageHeader
          title="Play"
          subtitle="Start, schedule and revisit"
          actions={
            <Link
              href="/calendar"
              aria-label="Open calendar"
              title="Calendar"
              className="grid h-11 w-11 place-items-center rounded-full text-[color:var(--sec-text-2)] transition-colors hover:bg-[color:var(--sec-surface)] hover:text-[color:var(--sec-text)]"
            >
              <CalendarDays size={20} />
            </Link>
          }
        />

        <Group label="Your record">
          <TileCard
            title="Round history"
            subtitle="Every finished round, and which ones count toward WHS"
            href="/history"
            icon={<History className="h-[18px] w-[18px] text-[color:var(--sec-accent)]" strokeWidth={2} />}
          />
        </Group>

        <div className="mb-[var(--sp-grp)]">
          <PrimaryAction
            label={liveRound ? "Resume round" : creatingRound ? "Creating…" : "New round"}
            hint={liveRound ? liveRoundHint : "Start a round at any course"}
            onClick={
              liveRound
                ? () => router.push(`/round/${liveRound.id}`)
                : creatingRound
                  ? undefined
                  : handleCreateNewRound
            }
          />
        </div>

        <Group label="Find a game">
          <TileCard
            title="Find a round"
            subtitle="See who's looking for a game and when they're free"
            href="/calendar?scope=looking"
            icon={<Users className="h-[18px] w-[18px] text-[color:var(--sec-accent)]" strokeWidth={2} />}
          />
        </Group>

        <Group label="In progress & upcoming">
          {err ? (
            <div className="py-3 text-[length:var(--t-body)] text-[color:var(--sec-bad)]">{err}</div>
          ) : null}

          {loading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-[var(--r-ui)]" />
              ))}
            </div>
          ) : rounds.length === 0 ? (
            <div className="py-3 text-[length:var(--t-body)] text-[color:var(--sec-muted)]">
              Nothing on your card. Start a round above.
            </div>
          ) : (
            rounds.map((r) => {
              const isDraft = r.status === "draft";
              const isScheduled = r.status === "scheduled";
              const isLive = r.status === "live" || r.status === "starting";
              const isMajorsRound = !!r.event_tee_time_id;
              const isOwner = r.myRole === "owner";
              // Owners delete the round; non-owners withdraw themselves. Majors-linked
              // rounds are managed from the Majors section, never swiped here.
              const canSwipe = (isDraft || isScheduled) && !isMajorsRound;
              const swipeAction: "delete" | "withdraw" = isOwner ? "delete" : "withdraw";
              const isDeleting = deletingId === r.id;

              // A Majors round's own name carries the round label the event name
              // doesn't ("The OPEN 2026 · Round 2"), so prefer it — the event is
              // already identified by the competition pill on the right.
              const title = r.name ?? r.linked_event?.name ?? r.courses?.name ?? "Round";

              // Competition type reads better than a flat "Majors": "Matchplay",
              // "Order Of Merit". Same de-underscore + title-case as production.
              const competitionLabel = r.linked_event?.event_type
                ? r.linked_event.event_type
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase())
                : null;

              const status = isLive
                ? "Live"
                : isDraft
                  ? "Draft"
                  : competitionLabel ?? (isMajorsRound ? "Majors" : "Scheduled");

              // A draft has no scheduled_at and a live round may not either, so
              // fall through rather than showing a card with no date at all.
              const whenIso = r.scheduled_at ?? r.started_at ?? r.created_at ?? null;
              const when = whenIso
                ? new Date(whenIso).toLocaleString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : null;

              const footnote = canSwipe ? (
                `Swipe to ${isOwner ? "delete" : "withdraw"}`
              ) : isMajorsRound && isScheduled ? (
                <Link
                  href={`/majors/events/${r.linked_event?.id ?? ""}`}
                  className="underline underline-offset-2 hover:text-[color:var(--sec-text)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  Withdraw in Majors to remove
                </Link>
              ) : null;

              return (
                <SwipeToDeleteRow
                  key={r.id}
                  enabled={canSwipe}
                  deleting={isDeleting}
                  actionLabel={isOwner ? "Delete" : "Withdraw"}
                  onDelete={() => setConfirmAction({ id: r.id, type: swipeAction })}
                >
                  <RoundCard
                    href={isDraft || isScheduled ? `/round/${r.id}/setup` : `/round/${r.id}`}
                    title={title}
                    status={status}
                    live={isLive}
                    course={r.courses?.name ?? null}
                    tee={r.myTee ?? null}
                    when={when}
                    footnote={footnote}
                  />
                </SwipeToDeleteRow>
              );
            })
          )}
        </Group>

        {confirmAction ? (() => {
          const round = rounds.find((r) => r.id === confirmAction.id);
          const isScheduled = round?.status === "scheduled";
          const roundWord = isScheduled ? "scheduled round" : "draft";
          const busy = deletingId === confirmAction.id;

          if (confirmAction.type === "withdraw") {
            return (
              <ConfirmSheet
                title={`Withdraw from ${roundWord}?`}
                subtitle="You'll be removed from this round's setup. The organiser can re-add you later."
                confirmLabel={busy ? "Withdrawing…" : "Withdraw"}
                confirmDisabled={busy}
                onClose={() => setConfirmAction(null)}
                onConfirm={() => withdrawRound(confirmAction.id)}
              />
            );
          }

          return (
            <ConfirmSheet
              title={isScheduled ? "Delete scheduled round?" : "Delete draft round?"}
              subtitle={isScheduled
                ? "This removes the scheduled round and any related data from the database."
                : "This removes the draft and any related data from the database."}
              confirmLabel={busy ? "Deleting…" : "Delete"}
              confirmDisabled={busy}
              onClose={() => setConfirmAction(null)}
              onConfirm={() => deleteDraft(confirmAction.id)}
            />
          );
        })() : null}
      </div>
    </div>
  );
}
