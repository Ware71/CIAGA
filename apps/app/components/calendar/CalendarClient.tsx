"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/button";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  AvailabilityFilter,
  CalendarEvent,
  CalendarRound,
  Circle,
  ProfileLite,
  ResolvedOccurrence,
  Scope,
  ViewMode,
} from "@/lib/calendar/types";
import {
  addDays,
  formatMonthLabel,
  formatRangeLabel,
  formatWeekCommencing,
  getMonthMatrix,
  getWeekDays,
  isSameMonth,
  rangeForView,
  startOfDay,
} from "@/lib/calendar/dateUtils";
import {
  applyAvailabilityFilter,
  groupOccurrencesByDay,
  hidePastAvailability,
  resolveDayStates,
  resolveOccurrences,
} from "@/lib/calendar/recurrence";
import {
  deleteEvent,
  fetchCircles,
  fetchEvents,
  fetchLookingForRound,
  fetchRounds,
  resolveProfileNames,
} from "@/lib/calendar/api";
import { SegmentedControl } from "./SegmentedControl";
import { MonthView } from "./views/MonthView";
import { TimeGridView } from "./views/TimeGridView";
import { AgendaView } from "./views/AgendaView";
import { LookingForRoundView } from "./views/LookingForRoundView";
import { CreateEventSheet } from "./CreateEventSheet";
import { CircleManager } from "./CircleManager";
import { ScopePicker, ScopePickerButton } from "./ScopePicker";
import { RoundInfoSheet } from "./RoundInfoSheet";

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
  const [viewMode, setViewMode] = useState<ViewMode>("month");
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

  const isLooking = scope.kind === "looking";
  const isAgenda = viewMode === "agenda";

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
    return rangeForView(anchor, isLooking ? "agenda" : viewMode);
  }, [anchor, viewMode, isLooking, isAgenda]);

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
        const [ev, rd] = await Promise.all([
          fetchEvents(profileIds, range.start, range.end),
          fetchRounds(profileIds, range.start, range.end),
        ]);
        if (cancelled) return;
        setEvents(ev);
        setRounds(rd);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load calendar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileIds, range.start, range.end, isLooking]);

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
    () => hidePastAvailability(resolveOccurrences(events, rounds, range.start, range.end)),
    [events, rounds, range.start, range.end]
  );

  const viewDays = useMemo(() => {
    if (isLooking || viewMode === "agenda") return enumerateDays(range.start, range.end);
    if (viewMode === "week") return getWeekDays(anchor);
    if (viewMode === "weekends")
      return getMonthMatrix(anchor)
        .flat()
        .filter((d) => isSameMonth(d, anchor) && (d.getDay() === 0 || d.getDay() === 6));
    return getMonthMatrix(anchor).flat();
  }, [viewMode, anchor, range.start, range.end, isLooking]);

  const dayStates = useMemo(
    () => resolveDayStates(occurrences, profileIds, viewDays),
    [occurrences, profileIds, viewDays]
  );

  const filtered = useMemo(
    () => applyAvailabilityFilter(occurrences, filter),
    [occurrences, filter]
  );

  const occurrencesByDay = useMemo(
    () => groupOccurrencesByDay(filtered, viewDays),
    [filtered, viewDays]
  );

  // Agenda ignores the filter — everything upcoming.
  const agendaByDay = useMemo(
    () => groupOccurrencesByDay(occurrences, viewDays),
    [occurrences, viewDays]
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
    // Week/LFG move by week; Month & Weekends (whole-month) move by month.
    if (isLooking || viewMode === "week") {
      setAnchor((a) => addDays(a, dir * 7));
    } else {
      setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1));
    }
  }

  function handleOccurrenceClick(occ: ResolvedOccurrence) {
    if (occ.kind === "round") {
      setRoundInfoId(occ.sourceId);
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
    const [ev, rd] = await Promise.all([
      fetchEvents(profileIds, range.start, range.end),
      fetchRounds(profileIds, range.start, range.end),
    ]);
    setEvents(ev);
    setRounds(rd);
  }

  const headerSubtitle = isLooking
    ? formatRangeLabel(range.start, range.end)
    : viewMode === "week"
      ? formatWeekCommencing(anchor)
      : viewMode === "weekends"
        ? "Weekends"
        : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#042713] via-[#04240f] to-[#031a0c] text-slate-100 px-3 pt-6 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-md space-y-2.5">
        {/* Title + scope on one row to save vertical space */}
        <header className="flex items-center gap-2">
          <BackButton onClick={() => router.replace("/round")} />
          <div className="text-base font-semibold tracking-wide text-[#f5e6b0]">Calendar</div>
          <div className="ml-auto">
            <ScopePickerButton label={scopeLabel} onClick={() => setScopePickerOpen(true)} />
          </div>
        </header>

        {/* Month / week navigation (agenda is a rolling "upcoming" list) */}
        <div className="flex items-center justify-between rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/30 px-2 py-1.5">
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
                <div className="text-sm font-semibold text-emerald-50">
                  {isLooking ? "Looking for a round" : formatMonthLabel(anchor)}
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

        {/* View mode (+ availability filter, hidden for LFG and Agenda) */}
        {!isLooking ? (
          <div className="space-y-2">
            <SegmentedControl<ViewMode>
              size="sm"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
                { value: "weekends", label: "Weekends" },
                { value: "agenda", label: "Agenda" },
              ]}
            />
            {!isAgenda ? (
              <SegmentedControl<AvailabilityFilter>
                size="sm"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "Show all" },
                  { value: "hide_unavailable", label: "Hide busy" },
                  { value: "available_only", label: "Available" },
                ]}
              />
            ) : null}
          </div>
        ) : null}

        {err ? (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-100">
            {err}
          </div>
        ) : null}

        <AnimatePresence mode="wait">
          <motion.div
            key={`${scope.kind}-${viewMode}-${isLooking}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-emerald-100/60">
                <Loader2 className="animate-spin" size={18} /> Loading…
              </div>
            ) : isLooking ? (
              <LookingForRoundView
                days={viewDays}
                occurrencesByDay={lfgByDay}
                nameById={nameById}
                onOpenPerson={(id) => setScope({ kind: "people", ids: [id], includeSelf: false })}
              />
            ) : viewMode === "month" ? (
              <MonthView
                anchor={anchor}
                occurrencesByDay={occurrencesByDay}
                dayStates={dayStates}
                showOwners={showOwners}
                nameById={nameById}
                onDayClick={(day) => setCreateTarget({ day, hour: null })}
                onOccurrenceClick={handleOccurrenceClick}
              />
            ) : viewMode === "agenda" ? (
              <AgendaView
                days={viewDays}
                occurrencesByDay={agendaByDay}
                showOwners={showOwners}
                nameById={nameById}
                onOccurrenceClick={handleOccurrenceClick}
              />
            ) : (
              <TimeGridView
                days={viewDays}
                occurrences={occurrences}
                profileIds={profileIds}
                filter={filter}
                nameById={nameById}
                showOwners={showOwners}
                onSlotClick={(day, hour) => setCreateTarget({ day, hour })}
                onOccurrenceClick={handleOccurrenceClick}
              />
            )}
          </motion.div>
        </AnimatePresence>
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
