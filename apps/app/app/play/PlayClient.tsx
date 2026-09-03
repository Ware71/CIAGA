"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, History, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";
import { Group, PageHeader, PrimaryAction, Row, Tag } from "@/components/ui/chrome";
import { TileCard } from "@/components/ui/TileCard";
import { Skeleton } from "@/components/ui/skeleton";
import { getWhsDefaultPolicy } from "@/lib/rounds/whsDefaults";

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

type RoundRow = {
  id: string;
  name: string | null;
  status: "draft" | "scheduled" | "starting" | "live" | "finished";
  started_at: string | null;
  created_at: string;
  course_id: string | null;
  scheduled_at: string | null;
  event_tee_time_id: string | null;
  courses?: { name: string | null } | null;
  /** Populated when the round is linked to a Majors tee time */
  linked_event?: LinkedEvent;
  /** The viewer's role on this round (owner vs scorer/player) */
  myRole?: "owner" | "scorer" | "player";
};

type ParticipantRow = {
  id: string;
  role: "owner" | "scorer" | "player";
  round: RoundRow;
};

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
 * Swipe-left to reveal a destructive action. Square-cornered now that the rows
 * it wraps sit flush in a `Group` rather than floating as separate cards.
 *
 * The divider lives on this wrapper, not on the Row inside it: wrapping makes
 * every Row the last child of its own container, so Row's `last:border-b-0`
 * would strip every divider in the list rather than just the final one.
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
    <div className="relative overflow-hidden border-b border-[color:var(--hair)] last:border-b-0">
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
        className="bg-[color:var(--ciaga-ground)] will-change-transform"
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

      const { data, error } = await supabase
        .from("round_participants")
        .select(`id, role, round:rounds!round_id(
          id, name, status, started_at, created_at, course_id, scheduled_at,
          event_tee_time_id,
          courses(name),
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
        return { ...round, linked_event, myRole: r.role } as RoundRow;
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
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated");

      const res = await fetch("/api/rounds/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          // Create round without course/tee - user will select in setup
          course_id: null,
          pending_tee_box_id: null,
          format_type: "strokeplay",
          // Seed the WHS default for the initial format (still editable in setup).
          default_playing_handicap_mode: getWhsDefaultPolicy("strokeplay").mode,
          default_playing_handicap_value: getWhsDefaultPolicy("strokeplay").allowance_pct,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to create round");

      // Navigate directly to setup, flagging this as a brand-new round
      router.push(`/round/${json.round_id}/setup?new=1`);
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

              const title = r.linked_event?.name ?? r.name ?? r.courses?.name ?? "Round";

              // Course name if the title already used the event/round name,
              // otherwise the status word — never repeat the title back.
              const context =
                r.courses?.name && (r.linked_event?.name ?? r.name)
                  ? r.courses.name
                  : isMajorsRound
                    ? "Majors"
                    : null;

              const when = r.scheduled_at
                ? new Date(r.scheduled_at).toLocaleString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : null;

              const swipeHint = canSwipe
                ? `Swipe to ${isOwner ? "delete" : "withdraw"}`
                : null;

              const subtitle = [context, when, swipeHint].filter(Boolean).join(" · ") || undefined;

              const statusTag = isLive ? (
                <Tag on>Live</Tag>
              ) : (
                <Tag>{isDraft ? "Draft" : isMajorsRound ? "Majors" : "Scheduled"}</Tag>
              );

              return (
                <SwipeToDeleteRow
                  key={r.id}
                  enabled={canSwipe}
                  deleting={isDeleting}
                  actionLabel={isOwner ? "Delete" : "Withdraw"}
                  onDelete={() => setConfirmAction({ id: r.id, type: swipeAction })}
                >
                  <Row
                    href={isDraft || isScheduled ? `/round/${r.id}/setup` : `/round/${r.id}`}
                    live={isLive}
                    title={title}
                    subtitle={subtitle}
                    trailing={statusTag}
                  />
                </SwipeToDeleteRow>
              );
            })
          )}
        </Group>

        {/* A Majors round can't be removed here — say where it can be. */}
        {rounds.some((r) => !!r.event_tee_time_id && r.status === "scheduled") ? (
          <p className="-mt-[calc(var(--sp-grp)-4px)] mb-[var(--sp-grp)] text-[length:var(--t-label)] text-[color:var(--sec-muted)]">
            Majors rounds are withdrawn from the event, not from here.
          </p>
        ) : null}

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
