"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Filter, Loader2 } from "lucide-react";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/button";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { useIsLandscape } from "@/lib/useIsLandscape";
import type {
  AvailabilityFilter,
  CalendarEvent,
  CalendarGroupEvent,
  CalendarMode,
  CalendarRound,
  Circle,
  Density,
  ProfileLite,
  ResolvedOccurrence,
  Scope,
  ZoomLevel,
} from "@/lib/calendar/types";
import { WEEKENDS_MAX_ZOOM } from "@/lib/calendar/types";
import {
  addDays,
  daysForZoom,
  formatMonthLabel,
  formatRangeLabel,
  rangeForView,
  rangeForZoom,
  shiftAnchorForZoom,
  startOfDay,
} from "@/lib/calendar/dateUtils";
import {
  applyAvailabilityFilter,
  groupOccurrencesByDay,
  hidePastAvailability,
  resolveOccurrences,
} from "@/lib/calendar/recurrence";
import { useZoomGestures } from "@/lib/calendar/useZoomGestures";
import {
  deleteEvent,
  fetchCircles,
  fetchEvents,
  fetchGroupEvents,
  fetchLookingForRound,
  fetchRounds,
  resolveProfileNames,
} from "@/lib/calendar/api";
import { WeekGridView } from "./views/WeekGridView";
import { WeekendsGridView } from "./views/WeekendsGridView";
import { TimeGridView } from "./views/TimeGridView";
import { AgendaView } from "./views/AgendaView";
import { LookingForRoundView } from "./views/LookingForRoundView";
import { CreateEventSheet } from "./CreateEventSheet";
import { CircleManager } from "./CircleManager";
import { ScopePicker } from "./ScopePicker";
import { RoundInfoSheet } from "./RoundInfoSheet";

const ZOOM_LABELS = ["Month", "4 Weeks", "3 Weeks", "2 Weeks", "Week", "3-Day", "Day"] as const;

/** How richly cells render at a given zoom — weekends cells are wider, so bump. */
function densityForView(zoom: ZoomLevel, weekends: boolean): Density {
  const base: Density =
    zoom >= 6 ? "full" : zoom === 5 || zoom === 4 ? "medium" : zoom >= 2 ? "compact" : "pip";
  if (!weekends) return base;
  if (base === "pip") return "compact";
  if (base === "compact") return "medium";
  return base;
}

function enumerateDays(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  let d = startOfDay(start);
  while (d < end) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export function CalendarClient() {
  const router = useRouter();

  const [selfId, setSelfId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [zoom, setZoom] = useState<ZoomLevel>(0);
  const [mode, setMode] = useState<CalendarMode>("calendar");
  const [weekendsOnly, setWeekendsOnly] = useState(false);
  const [threeHourRule, setThreeHourRule] = useState(true);
  const [filter, setFilter] = useState<AvailabilityFilter>("all");

  const [scope, setScope] = useState<Scope>({ kind: "me" });
  const [circles, setCircles] = useState<Circle[]>([]);
  const [nameById, setNameById] = useState<Map<string, ProfileLite>>(new Map());

  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const [circleManager, setCircleManager] = useState<{ open: boolean; id?: string | null }>({
    open: false,
  });

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [rounds, setRounds] = useState<CalendarRound[]>([]);
  const [lfgEvents, setLfgEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [createTarget, setCreateTarget] = useState<{ day: Date; hour?: number | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResolvedOccurrence | null>(null);
  const [roundInfoId, setRoundInfoId] = useState<string | null>(null);
  const [groupEvents, setGroupEvents] = useState<CalendarGroupEvent[]>([]);
  const isLandscape = useIsLandscape();

  const isLooking = scope.kind === "looking";
  const isAgenda = mode === "agenda";
  const gesturesActive = !isLooking && !isAgenda;
  const density = densityForView(zoom, weekendsOnly);

  // Zoom is pinch-driven; the ladder auto-fits the screen so there's no scroll
  // to fight. Weekends caps at the 1-week grid (no time-grid levels).
  const maxZoom: ZoomLevel = weekendsOnly ? WEEKENDS_MAX_ZOOM : 6;
  const zoomIn = useCallback(
    () => setZoom((z) => (z < maxZoom ? ((z + 1) as ZoomLevel) : z)),
    [maxZoom]
  );
  const zoomOut = useCallback(() => setZoom((z) => (z > 0 ? ((z - 1) as ZoomLevel) : z)), []);
  const zoomGestures = useZoomGestures({ onZoomIn: zoomIn, onZoomOut: zoomOut });

  // Keep zoom within the weekends ladder when the view is toggled on.
  useEffect(() => {
    if (weekendsOnly && zoom > WEEKENDS_MAX_ZOOM) setZoom(WEEKENDS_MAX_ZOOM as ZoomLevel);
  }, [weekendsOnly, zoom]);

  // A shared calendar (circle / several players) defaults to the Month grid,
  // which surfaces everyone's rounds/events + joint-availability heat.
  useEffect(() => {
    if (scope.kind === "circle" || scope.kind === "people") {
      setMode("calendar");
      setZoom(0);
      setWeekendsOnly(false);
    }
  }, [scope]);

  // People whose calendars are displayed for the main views.
  const profileIds = useMemo(() => {
    if (!selfId) return [];
    if (scope.kind === "me") return [selfId];
    if (scope.kind === "circle") {
      const c = circles.find((x) => x.id === scope.id);
      return Array.from(new Set([selfId, ...(c?.members.map((m) => m.profile_id) ?? [])]));
    }
    if (scope.kind === "people") {
      const ids = scope.includeSelf ? [selfId, ...scope.ids] : scope.ids;
      return Array.from(new Set(ids));
    }
    return [selfId];
  }, [scope, circles, selfId]);

  const range = useMemo(() => {
    // Agenda shows everything upcoming from today.
    if (isAgenda && !isLooking) {
      const start = startOfDay(new Date());
      return { start, end: addDays(start, 42) };
    }
    if (isLooking) return rangeForView(anchor, "agenda");
    return rangeForZoom(anchor, zoom);
  }, [anchor, zoom, isLooking, isAgenda]);

  // Resolve session + circles once.
  useEffect(() => {
    (async () => {
      const session = await getViewerSession();
      if (!session) {
        router.replace("/auth");
        return;
      }
      setSelfId(session.profileId);
      try {
        setCircles(await fetchCircles());
      } catch {
        /* non-fatal */
      }
    })();
  }, [router]);

  const mergeNames = useCallback((profiles: ProfileLite[]) => {
    if (profiles.length === 0) return;
    setNameById((prev) => {
      const next = new Map(prev);
      for (const p of profiles) next.set(p.id, p);
      return next;
    });
  }, []);

  // Resolve display names for everyone currently shown.
  useEffect(() => {
    const missing = profileIds.filter((id) => !nameById.has(id));
    if (missing.length === 0) return;
    (async () => {
      try {
        mergeNames(await resolveProfileNames(missing));
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileIds]);

  // Main calendar fetch.
  useEffect(() => {
    if (isLooking || profileIds.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [ev, rd, ge] = await Promise.all([
          fetchEvents(profileIds, range.start, range.end),
          fetchRounds(profileIds, range.start, range.end, selfId),
          selfId ? fetchGroupEvents(selfId, range.start, range.end) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setEvents(ev);
        setRounds(rd);
        setGroupEvents(ge);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load calendar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileIds, range.start, range.end, isLooking, selfId]);

  // "Looking for a round" fetch.
  useEffect(() => {
    if (!isLooking || !selfId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const circleMemberIds = circles.flatMap((c) => c.members.map((m) => m.profile_id));
        const { events: ev, profiles } = await fetchLookingForRound(
          selfId,
          circleMemberIds,
          range.start,
          range.end
        );
        if (cancelled) return;
        setLfgEvents(ev);
        mergeNames(profiles);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLooking, selfId, circles, range.start, range.end, mergeNames]);

  const occurrences = useMemo(
    () =>
      hidePastAvailability(
        resolveOccurrences(events, rounds, range.start, range.end, groupEvents, selfId)
      ),
    [events, rounds, groupEvents, selfId, range.start, range.end]
  );

  const viewDays = useMemo(() => {
    if (isLooking || isAgenda) return enumerateDays(range.start, range.end);
    return daysForZoom(anchor, zoom);
  }, [isLooking, isAgenda, anchor, zoom, range.start, range.end]);

  // Agenda routes through the availability filter (rounds & events always kept).
  const filtered = useMemo(
    () => applyAvailabilityFilter(occurrences, filter),
    [occurrences, filter]
  );
  const occurrencesByDay = useMemo(
    () => groupOccurrencesByDay(filtered, viewDays),
    [filtered, viewDays]
  );

  // LFG occurrences (availability only), grouped by day.
  const lfgByDay = useMemo(() => {
    const occ = hidePastAvailability(resolveOccurrences(lfgEvents, [], range.start, range.end)).filter(
      (o) => o.kind === "available"
    );
    return groupOccurrencesByDay(occ, viewDays);
  }, [lfgEvents, range.start, range.end, viewDays]);

  const showOwners = profileIds.length > 1 || isLooking;

  const scopeLabel = useMemo(() => {
    if (scope.kind === "me") return "Me";
    if (scope.kind === "looking") return "Looking for a round";
    if (scope.kind === "circle") return circles.find((c) => c.id === scope.id)?.name ?? "Circle";
    // people
    const names = scope.ids.map((id) => nameById.get(id)?.name?.split(" ")[0] ?? "Player");
    const base = names.length === 1 ? names[0] : `${scope.ids.length} players`;
    return scope.includeSelf ? `${base} + me` : base;
  }, [scope, circles, nameById]);

  function shift(dir: -1 | 1) {
    if (isLooking) {
      setAnchor((a) => addDays(a, dir * 7));
    } else {
      setAnchor((a) => shiftAnchorForZoom(a, zoom, dir));
    }
  }

  function handleOccurrenceClick(occ: ResolvedOccurrence) {
    if (occ.kind === "round") {
      setRoundInfoId(occ.sourceId);
      return;
    }
    if (occ.kind === "event") {
      router.push(`/majors/events/${occ.sourceId}`);
      return;
    }
    if (occ.profileId === selfId) setDeleteTarget(occ);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteEvent(deleteTarget.sourceId);
      setEvents((prev) => prev.filter((e) => e.id !== deleteTarget.sourceId));
    } catch (e: any) {
      setErr(e?.message || "Failed to delete");
    } finally {
      setDeleteTarget(null);
    }
  }

  async function refreshMain() {
    if (profileIds.length === 0) return;
    const [ev, rd, ge] = await Promise.all([
      fetchEvents(profileIds, range.start, range.end),
      fetchRounds(profileIds, range.start, range.end, selfId),
      selfId ? fetchGroupEvents(selfId, range.start, range.end) : Promise.resolve([]),
    ]);
    setEvents(ev);
    setRounds(rd);
    setGroupEvents(ge);
  }

  const rangeLabel = formatRangeLabel(range.start, range.end);
  const headerSubtitle = isLooking
    ? rangeLabel
    : weekendsOnly
      ? zoom === 0
        ? "Weekends"
        : `Weekends · ${rangeLabel}`
      : zoom === 0
        ? null
        : rangeLabel;

  const gridProps = {
    anchor,
    zoom,
    occurrences,
    profileIds,
    filter,
    applyThreeHour: threeHourRule,
    density,
    nameById,
    showOwners,
    onOccurrenceClick: handleOccurrenceClick,
    onEmptyDayClick: (day: Date) => setCreateTarget({ day }),
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-[#042713] via-[#04240f] to-[#031a0c] px-3 pt-6 pb-[env(safe-area-inset-bottom)] text-slate-100">
      <div className="mx-auto flex w-full min-h-0 max-w-md flex-1 flex-col gap-2.5 landscape:max-w-5xl">
        {/* Centered title; funnel opens the settings sheet (scope + view + filter) */}
        <header className="relative flex shrink-0 items-center">
          <BackButton onClick={() => router.replace("/round")} />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-base font-semibold tracking-wide text-[#f5e6b0]">Calendar</div>
            <div className="max-w-[60%] truncate text-[10px] text-emerald-200/60">{scopeLabel}</div>
          </div>
          <button
            onClick={() => setScopePickerOpen(true)}
            aria-label="Calendar settings"
            className="ml-auto rounded-full border border-emerald-900/60 bg-[#0b3b21]/60 p-2 text-emerald-100/80 hover:bg-emerald-900/30"
          >
            <Filter size={18} />
          </button>
        </header>

        {/* Month / week navigation (agenda is a rolling "upcoming" list) */}
        <div className="flex shrink-0 items-center justify-between rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/30 px-2 py-1.5">
          {isAgenda && !isLooking ? (
            <div className="w-full py-0.5 text-center text-sm font-semibold text-emerald-50">
              Upcoming
            </div>
          ) : (
            <>
              <button
                onClick={() => shift(-1)}
                className="rounded-full p-1.5 text-emerald-100/70 hover:bg-emerald-900/40"
              >
                <ChevronLeft size={18} />
              </button>
              <button onClick={() => setAnchor(new Date())} className="text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-sm font-semibold text-emerald-50">
                    {isLooking ? "Looking for a round" : formatMonthLabel(anchor)}
                  </span>
                  {!isLooking ? (
                    <span className="rounded-full bg-[#f5e6b0]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#f5e6b0]">
                      {ZOOM_LABELS[zoom]}
                    </span>
                  ) : null}
                </div>
                {headerSubtitle ? (
                  <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-200/60">
                    {headerSubtitle}
                  </div>
                ) : null}
              </button>
              <button
                onClick={() => shift(1)}
                className="rounded-full p-1.5 text-emerald-100/70 hover:bg-emerald-900/40"
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}
        </div>

        {err ? (
          <div className="shrink-0 rounded-xl border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-100">
            {err}
          </div>
        ) : null}

        <div
          className="relative min-h-0 flex-1"
          style={{ touchAction: gesturesActive ? "none" : undefined }}
          onPointerDown={gesturesActive ? zoomGestures.onPointerDown : undefined}
          onPointerMove={gesturesActive ? zoomGestures.onPointerMove : undefined}
          onPointerUp={gesturesActive ? zoomGestures.onPointerUp : undefined}
          onPointerCancel={gesturesActive ? zoomGestures.onPointerCancel : undefined}
          onWheel={gesturesActive ? zoomGestures.onWheel : undefined}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={`${scope.kind}-${mode}-${zoom}-${weekendsOnly}-${isLooking}`}
              className="h-full min-h-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
            >
              {loading ? (
                <div className="flex h-full items-center justify-center gap-2 text-emerald-100/60">
                  <Loader2 className="animate-spin" size={18} /> Loading…
                </div>
              ) : isLooking ? (
                <div className="h-full overflow-y-auto">
                  <LookingForRoundView
                    days={viewDays}
                    occurrencesByDay={lfgByDay}
                    nameById={nameById}
                    onOpenPerson={(id) =>
                      setScope({ kind: "people", ids: [id], includeSelf: false })
                    }
                  />
                </div>
              ) : isAgenda ? (
                <div className="h-full overflow-y-auto">
                  <AgendaView
                    days={viewDays}
                    occurrencesByDay={occurrencesByDay}
                    showOwners={showOwners}
                    nameById={nameById}
                    onOccurrenceClick={handleOccurrenceClick}
                  />
                </div>
              ) : zoom <= WEEKENDS_MAX_ZOOM ? (
                weekendsOnly ? (
                  <WeekendsGridView {...gridProps} />
                ) : (
                  <WeekGridView {...gridProps} />
                )
              ) : (
                <TimeGridView
                  days={viewDays}
                  occurrences={occurrences}
                  profileIds={profileIds}
                  filter={filter}
                  density={density}
                  markUnusable={threeHourRule}
                  nameById={nameById}
                  showOwners={showOwners}
                  orientation={isLandscape ? "horizontal" : "vertical"}
                  onSlotClick={(day, hour) => setCreateTarget({ day, hour })}
                  onOccurrenceClick={handleOccurrenceClick}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {createTarget ? (
        <CreateEventSheet
          day={createTarget.day}
          hour={createTarget.hour}
          onClose={() => setCreateTarget(null)}
          onCreated={() => {
            setCreateTarget(null);
            refreshMain();
          }}
        />
      ) : null}

      {roundInfoId ? (
        <RoundInfoSheet roundId={roundInfoId} onClose={() => setRoundInfoId(null)} />
      ) : null}

      {scopePickerOpen ? (
        <ScopePicker
          scope={scope}
          circles={circles}
          mode={mode}
          onMode={setMode}
          filter={filter}
          onFilter={setFilter}
          weekendsOnly={weekendsOnly}
          onWeekendsOnly={setWeekendsOnly}
          threeHourRule={threeHourRule}
          onThreeHourRule={setThreeHourRule}
          onSelect={(s) => {
            setScope(s);
            setScopePickerOpen(false);
          }}
          onManageCircle={(id) => {
            setScopePickerOpen(false);
            setCircleManager({ open: true, id });
          }}
          onNewCircle={() => {
            setScopePickerOpen(false);
            setCircleManager({ open: true, id: null });
          }}
          onClose={() => setScopePickerOpen(false)}
        />
      ) : null}

      {circleManager.open ? (
        <CircleManager
          circles={circles}
          initialExpandedId={circleManager.id}
          onClose={() => setCircleManager({ open: false })}
          onChanged={async () => {
            try {
              setCircles(await fetchCircles());
            } catch {
              /* ignore */
            }
          }}
        />
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50">
          <button
            className="absolute inset-0 bg-black/60"
            onClick={() => setDeleteTarget(null)}
            aria-label="Close"
          />
          <div className="absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto w-full max-w-[520px] rounded-t-3xl border border-emerald-900/70 bg-[#061f12] p-4 shadow-2xl">
              <div className="text-sm font-semibold text-emerald-50">
                Delete {deleteTarget.kind === "available" ? "availability" : "unavailability"}?
              </div>
              <div className="text-[11px] text-emerald-100/70 mt-1">
                {deleteTarget.recurring
                  ? "This removes the whole recurring series."
                  : "This removes the event from your calendar."}
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 hover:bg-emerald-900/20"
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 rounded-2xl bg-red-500 text-white hover:bg-red-600"
                  onClick={confirmDelete}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
