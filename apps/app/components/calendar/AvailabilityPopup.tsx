"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Plus, X } from "lucide-react";
import type { PlayerDayStatus, ProfileLite } from "@/lib/calendar/types";
import { formatDayLabel } from "@/lib/calendar/dateUtils";
import { Button } from "@/components/ui/button";
import { STATUS_COLORS } from "./eventStyles";
import { InitialsAvatar } from "./Avatar";

const GROUPS: { status: PlayerDayStatus; label: string }[] = [
  { status: "available", label: "Available" },
  { status: "scheduled", label: "Playing a round" },
  { status: "unavailable", label: "Unavailable" },
  { status: "none", label: "No status" },
];

export function AvailabilityPopup(props: {
  day: Date;
  statuses: Map<string, PlayerDayStatus>;
  nameById: Map<string, ProfileLite>;
  onAddEvent: (day: Date) => void;
  onClose: () => void;
}) {
  const { day, statuses, nameById, onAddEvent, onClose } = props;

  const byStatus = new Map<PlayerDayStatus, string[]>();
  for (const g of GROUPS) byStatus.set(g.status, []);
  for (const [id, s] of statuses) byStatus.get(s)!.push(id);

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
          <div className="mx-auto w-full max-w-[520px] max-h-[85vh] overflow-y-auto rounded-t-3xl border border-emerald-900/70 bg-[#061f12] shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-emerald-900/60 bg-[#061f12] p-4">
              <div className="text-sm font-semibold text-emerald-50">{formatDayLabel(day)}</div>
              <button onClick={onClose} className="text-emerald-100/70 hover:text-emerald-50" aria-label="Close">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {GROUPS.map(({ status, label }) => {
                const ids = byStatus.get(status)!;
                if (ids.length === 0) return null;
                return (
                  <div key={status}>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-200/60">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[status] }}
                      />
                      {label} ({ids.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ids.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-900/70 bg-[#0b3b21]/40 py-1 pl-1 pr-2.5 text-xs text-emerald-50"
                        >
                          <InitialsAvatar profileId={id} name={nameById.get(id)?.name ?? null} size={18} />
                          {nameById.get(id)?.name ?? "Player"}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}

              <Button
                className="w-full rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c]"
                onClick={() => onAddEvent(day)}
              >
                <Plus size={16} /> Add event
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
