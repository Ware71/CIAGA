"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "./SegmentedControl";
import {
  RecurrenceEditor,
  buildRRule,
  EMPTY_RECURRENCE,
  type RecurrenceValue,
} from "./RecurrenceEditor";
import { createEvent, createScheduledRound } from "@/lib/calendar/api";
import { formatDayLabel } from "@/lib/calendar/dateUtils";

type Tab = "round" | "available" | "unavailable";

/** Combine a local day with an "HH:MM" string into an ISO timestamp. */
function combine(day: Date, time: string): string {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0, 0);
  return d.toISOString();
}

function dayStartISO(day: Date): string {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0).toISOString();
}
function nextDayStartISO(day: Date): string {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0).toISOString();
}

export function CreateEventSheet(props: {
  day: Date;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { day, onClose, onCreated } = props;
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("round");
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [roundTime, setRoundTime] = useState("09:00");
  const [recurrence, setRecurrence] = useState<RecurrenceValue>(EMPTY_RECURRENCE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleRound() {
    setBusy(true);
    setErr(null);
    try {
      const roundId = await createScheduledRound(combine(day, roundTime));
      router.push(`/round/${roundId}/setup?new=1`);
    } catch (e: any) {
      setErr(e?.message || "Failed to create round");
      setBusy(false);
    }
  }

  async function handleSaveEvent() {
    setBusy(true);
    setErr(null);
    try {
      const start_at = allDay ? dayStartISO(day) : combine(day, startTime);
      const end_at = allDay ? nextDayStartISO(day) : combine(day, endTime);
      if (!allDay && new Date(end_at) <= new Date(start_at)) {
        throw new Error("End time must be after start time");
      }
      await createEvent({
        kind: tab === "available" ? "available" : "unavailable",
        title: title.trim() || null,
        all_day: allDay,
        start_at,
        end_at,
        rrule: buildRRule(recurrence),
      });
      onCreated();
    } catch (e: any) {
      setErr(e?.message || "Failed to save");
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50">
        <motion.button
          className="absolute inset-0 bg-black/60"
          onClick={onClose}
          aria-label="Close"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
        <motion.div
          className="absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)]"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
        >
          <div className="mx-auto w-full max-w-[520px] rounded-t-3xl border border-emerald-900/70 bg-[#061f12] shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-emerald-900/60">
              <div className="text-sm font-semibold text-emerald-50">New event</div>
              <div className="text-[11px] text-emerald-100/70 mt-0.5">{formatDayLabel(day)}</div>
            </div>

            <div className="p-4 space-y-4">
              <SegmentedControl<Tab>
                className="w-full justify-between"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "round", label: "Round" },
                  { value: "available", label: "Availability" },
                  { value: "unavailable", label: "Unavailability" },
                ]}
              />

              {tab === "round" ? (
                <div className="space-y-3">
                  <p className="text-[11px] text-emerald-100/70 leading-relaxed">
                    Creates a scheduled round on this date and takes you to setup to finish the
                    details.
                  </p>
                  <label className="flex items-center gap-2 text-xs text-emerald-100/80">
                    <span className="shrink-0">Tee time</span>
                    <input
                      type="time"
                      value={roundTime}
                      onChange={(e) => setRoundTime(e.target.value)}
                      className="rounded-md border border-emerald-900/70 bg-[#042713] px-2 py-1 text-emerald-50"
                    />
                  </label>
                  <Button
                    className="w-full rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c]"
                    onClick={handleRound}
                    disabled={busy}
                  >
                    {busy ? "Creating…" : "Set up round"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={
                      tab === "available" ? "Title (optional)" : "e.g. Work (optional)"
                    }
                    className="w-full rounded-xl border border-emerald-900/70 bg-[#042713] px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-100/40"
                  />

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-emerald-100/80">All day</span>
                    <button
                      type="button"
                      onClick={() => setAllDay((v) => !v)}
                      className={cn(
                        "relative h-6 w-11 rounded-full transition-colors",
                        allDay ? "bg-[#f5e6b0]" : "bg-emerald-900/70"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                          allDay ? "translate-x-5" : "translate-x-0.5"
                        )}
                      />
                    </button>
                  </div>

                  {!allDay ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-100/80">
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="rounded-md border border-emerald-900/70 bg-[#042713] px-2 py-1 text-emerald-50"
                      />
                      <span>to</span>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="rounded-md border border-emerald-900/70 bg-[#042713] px-2 py-1 text-emerald-50"
                      />
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-emerald-900/60 bg-[#0b3b21]/40 p-3">
                    <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
                  </div>

                  <Button
                    className={cn(
                      "w-full rounded-2xl",
                      tab === "available"
                        ? "bg-emerald-500 text-white hover:bg-emerald-600"
                        : "bg-red-500 text-white hover:bg-red-600"
                    )}
                    onClick={handleSaveEvent}
                    disabled={busy}
                  >
                    {busy
                      ? "Saving…"
                      : tab === "available"
                        ? "Add availability"
                        : "Add unavailability"}
                  </Button>
                </div>
              )}

              {err ? <div className="text-[11px] text-red-300">{err}</div> : null}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
