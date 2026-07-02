"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Users2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/button";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  AvailabilityFilter,
  CalendarEvent,
  CalendarRound,
  Circle,
  ResolvedOccurrence,
  ViewMode,
} from "@/lib/calendar/types";
import {
  addDays,
  dayKey,
  formatMonthLabel,
  getMonthMatrix,
  getWeekDays,
  getWeekendDays,
  rangeForView,
  startOfDay,
} from "@/lib/calendar/dateUtils";
import { applyAvailabilityFilter, resolveDayStates, resolveOccurrences } from "@/lib/calendar/recurrence";
import { fetchCircles, fetchEvents, fetchRounds, deleteEvent } from "@/lib/calendar/api";
import { SegmentedControl } from "./SegmentedControl";
import { MonthView } from "./views/MonthView";
import { WeekView } from "./views/WeekView";
import { AgendaView } from "./views/AgendaView";
import { CreateEventSheet } from "./CreateEventSheet";
import { CircleManager } from "./CircleManager";

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

  const [circles, setCircles] = useState<Circle[]>([]);
  const [activeCircleId, setActiveCircleId] = useState<string | null>(null);
  const [circleManagerOpen, setCircleManagerOpen] = useState(false);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [rounds, setRounds] = useState<CalendarRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [createDay, setCreateDay] = useState<Date | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResolvedOccurrence | null>(null);

  const activeCircle = useMemo(
    () => circles.find((c) => c.id === activeCircleId) ?? null,
    [circles, activeCircleId]
  );

  // People whose calendars are displayed (self + active circle's members).
  const profileIds = useMemo(() => {
    if (!selfId) return [];
    if (!activeCircle) return [selfId];
    return Array.from(new Set([selfId, ...activeCircle.members.map((m) => m.profile_id)]));
  }, [selfId, activeCircle]);

  const range = useMemo(() => rangeForView(anchor, viewMode), [anchor, viewMode]);

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

  // Fetch events + rounds for the displayed people and range.
  useEffect(() => {
    if (profileIds.length === 0) return;
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
  }, [profileIds, range.start, range.end]);

  const occurrences = useMemo(
    () => resolveOccurrences(events, rounds, range.start, range.end),
    [events, rounds, range.start, range.end]
  );

  // Days spanned by the current view (for aggregate day states + agenda).
  const viewDays = useMemo(() => {
    if (viewMode === "week") return getWeekDays(anchor);
    if (viewMode === "weekends") return getWeekendDays(anchor);
    if (viewMode === "agenda") return enumerateDays(range.start, range.end);
    return getMonthMatrix(anchor).flat();
  }, [viewMode, anchor, range.start, range.end]);

  const dayStates = useMemo(
    () => resolveDayStates(occurrences, profileIds, viewDays),
    [occurrences, profileIds, viewDays]
  );

  const filtered = useMemo(
    () => applyAvailabilityFilter(occurrences, dayStates, filter),
    [occurrences, dayStates, filter]
  );

  const occurrencesByDay = useMemo(() => {
    const map = new Map<string, ResolvedOccurrence[]>();
    for (const occ of filtered) {
      const key = dayKey(occ.start);
      const list = map.get(key);
      if (list) list.push(occ);
      else map.set(key, [occ]);
    }
    return map;
  }, [filtered]);

  const showOwnerDots = profileIds.length > 1;

  function shift(dir: -1 | 1) {
    if (viewMode === "week" || viewMode === "agenda") {
      setAnchor((a) => addDays(a, dir * 7));
    } else {
      setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1));
    }
  }

  function handleOccurrenceClick(occ: ResolvedOccurrence) {
    if (occ.kind === "round") {
      const path =
        occ.roundStatus === "scheduled" ? `/round/${occ.sourceId}/setup` : `/round/${occ.sourceId}`;
      router.push(path);
      return;
    }
    // Only your own availability/unavailability can be edited/removed here.
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

  async function refreshData() {
    if (profileIds.length === 0) return;
    const [ev, rd] = await Promise.all([
      fetchEvents(profileIds, range.start, range.end),
      fetchRounds(profileIds, range.start, range.end),
    ]);
    setEvents(ev);
    setRounds(rd);
  }

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-3 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-md space-y-4">
        <header className="flex items-center justify-between">
          <BackButton onClick={() => router.replace("/round")} />
          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Calendar</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
              {activeCircle ? activeCircle.name : "My schedule"}
            </div>
          </div>
          <button
            onClick={() => setCircleManagerOpen(true)}
            className="flex h-9 w-[60px] items-center justify-end text-emerald-200/70 hover:text-emerald-50"
            aria-label="Manage circles"
          >
            <Users2 size={20} />
          </button>
        </header>

        {/* Scope: me + circles */}
        {circles.length > 0 ? (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <ScopeChip active={!activeCircleId} onClick={() => setActiveCircleId(null)}>
              Me
            </ScopeChip>
            {circles.map((c) => (
              <ScopeChip
                key={c.id}
                active={activeCircleId === c.id}
                onClick={() => setActiveCircleId(c.id)}
              >
                {c.name}
              </ScopeChip>
            ))}
          </div>
        ) : null}

        {/* Month/week navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => shift(-1)}
            className="rounded-full p-1.5 text-emerald-100/70 hover:bg-emerald-900/30"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setAnchor(new Date())}
            className="text-sm font-semibold text-emerald-50"
          >
            {formatMonthLabel(anchor)}
          </button>
          <button
            onClick={() => shift(1)}
            className="rounded-full p-1.5 text-emerald-100/70 hover:bg-emerald-900/30"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* View mode + availability filter */}
        <div className="space-y-2">
          <SegmentedControl<ViewMode>
            className="w-full justify-between"
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
          <SegmentedControl<AvailabilityFilter>
            className="w-full justify-between"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "Show all" },
              { value: "hide_unavailable", label: "Hide unavailable" },
              { value: "available_only", label: "Available only" },
            ]}
          />
        </div>

        {err ? (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-100">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-emerald-100/60">
            <Loader2 className="animate-spin" size={18} /> Loading…
          </div>
        ) : viewMode === "month" ? (
          <MonthView
            anchor={anchor}
            occurrencesByDay={occurrencesByDay}
            dayStates={dayStates}
            filter={filter}
            showOwnerDots={showOwnerDots}
            onDayClick={setCreateDay}
            onOccurrenceClick={handleOccurrenceClick}
          />
        ) : viewMode === "agenda" ? (
          <AgendaView
            days={viewDays}
            occurrencesByDay={occurrencesByDay}
            dayStates={dayStates}
            filter={filter}
            showOwnerDots={showOwnerDots}
            onOccurrenceClick={handleOccurrenceClick}
          />
        ) : (
          <WeekView
            days={viewDays}
            occurrencesByDay={occurrencesByDay}
            dayStates={dayStates}
            filter={filter}
            showOwnerDots={showOwnerDots}
            onDayClick={setCreateDay}
            onOccurrenceClick={handleOccurrenceClick}
          />
        )}
      </div>

      {createDay ? (
        <CreateEventSheet
          day={createDay}
          onClose={() => setCreateDay(null)}
          onCreated={() => {
            setCreateDay(null);
            refreshData();
          }}
        />
      ) : null}

      {circleManagerOpen ? (
        <CircleManager
          circles={circles}
          onClose={() => setCircleManagerOpen(false)}
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

function ScopeChip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        props.active
          ? "border-[#f5e6b0] bg-[#f5e6b0] text-[#042713]"
          : "border-emerald-900/70 bg-[#0b3b21]/50 text-emerald-100/70 hover:bg-emerald-900/30"
      )}
    >
      {props.children}
    </button>
  );
}
