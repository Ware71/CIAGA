"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { RoundInfo } from "@/lib/calendar/types";
import { fetchRoundInfo } from "@/lib/calendar/api";
import { InitialsAvatar } from "./Avatar";

function statusBadge(status: RoundInfo["status"]): { label: string; cls: string } {
  switch (status) {
    case "live":
    case "starting":
      return { label: "Live", cls: "bg-red-500/20 text-red-200 border-red-500/40" };
    case "finished":
      return { label: "Finished", cls: "bg-[#f5e6b0]/20 text-[#f5e6b0] border-[#f5e6b0]/40" };
    case "scheduled":
      return { label: "Scheduled", cls: "bg-emerald-500/20 text-emerald-100 border-emerald-400/40" };
    default:
      return { label: "Draft", cls: "bg-emerald-900/40 text-emerald-200/80 border-emerald-800/50" };
  }
}

function prettyFormat(f: string | null): string | null {
  if (!f) return null;
  return f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function RoundInfoSheet(props: { roundId: string; onClose: () => void }) {
  const { roundId, onClose } = props;
  const router = useRouter();
  const [info, setInfo] = useState<RoundInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchRoundInfo(roundId);
        if (!cancelled) setInfo(data);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load round");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roundId]);

  const status = info?.status ?? "scheduled";
  const finished = status === "finished";
  const when = info?.finished_at ?? info?.scheduled_at ?? info?.started_at ?? null;
  const badge = statusBadge(status);

  const action =
    status === "draft" || status === "scheduled"
      ? { label: "Open setup", path: `/round/${roundId}/setup` }
      : status === "finished"
        ? { label: "View round", path: `/round/${roundId}` }
        : { label: "Open scorecard", path: `/round/${roundId}` };

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
            <div className="sticky top-0 flex items-start justify-between border-b border-emerald-900/60 bg-[#061f12] p-4">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-emerald-50">
                  {info?.name ?? info?.course_name ?? "Round"}
                </div>
                {info?.course_name ? (
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-100/60">
                    <MapPin size={12} /> {info.course_name}
                  </div>
                ) : null}
              </div>
              <button onClick={onClose} className="ml-2 text-emerald-100/70 hover:text-emerald-50">
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", badge.cls)}>
                  {badge.label}
                </span>
                {prettyFormat(info?.format_type ?? null) ? (
                  <span className="rounded-full border border-emerald-900/60 bg-[#0b3b21]/50 px-2 py-0.5 text-[10px] text-emerald-100/80">
                    {prettyFormat(info?.format_type ?? null)}
                  </span>
                ) : null}
                {when ? (
                  <span className="text-[11px] text-emerald-100/60">
                    {new Date(when).toLocaleString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                ) : null}
              </div>

              {err ? (
                <div className="text-[11px] text-red-300">{err}</div>
              ) : !info ? (
                <div className="flex items-center gap-2 py-6 text-emerald-100/60">
                  <Loader2 className="animate-spin" size={16} /> Loading…
                </div>
              ) : (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200/50">
                    Players
                  </div>
                  <div className="divide-y divide-emerald-900/40 rounded-xl border border-emerald-900/50 bg-[#042713]">
                    {info.participants.map((p) => {
                      const net =
                        p.ags != null && p.course_handicap != null ? p.ags - p.course_handicap : null;
                      const toPar =
                        p.raw_strokes != null && p.par_played != null
                          ? p.raw_strokes - p.par_played
                          : null;
                      const stats: { label: string; value: string }[] = [];
                      if (finished) {
                        if (p.raw_strokes != null) stats.push({ label: "Strokes", value: String(p.raw_strokes) });
                        if (p.ags != null) stats.push({ label: "AGS", value: String(p.ags) });
                        if (net != null) stats.push({ label: "Net", value: String(net) });
                        if (toPar != null)
                          stats.push({ label: "To par", value: toPar >= 0 ? `+${toPar}` : `${toPar}` });
                        if (p.score_differential != null)
                          stats.push({ label: "Diff", value: String(p.score_differential) });
                      }
                      return (
                        <div key={p.profile_id} className="px-3 py-2">
                          <div className="flex items-center gap-2.5">
                            <InitialsAvatar profileId={p.profile_id} name={p.name} size={26} />
                            <span className="min-w-0 flex-1 truncate text-sm text-emerald-50">
                              {p.name ?? "Player"}
                            </span>
                          </div>
                          {stats.length > 0 ? (
                            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-[38px]">
                              {stats.map((s) => (
                                <span key={s.label} className="text-[11px] text-emerald-100/60">
                                  {s.label}{" "}
                                  <span className="font-semibold tabular-nums text-emerald-50">
                                    {s.value}
                                  </span>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {info.participants.length === 0 ? (
                      <div className="px-3 py-3 text-center text-[11px] text-emerald-100/50">
                        No players yet.
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              <Button
                className="w-full rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c]"
                onClick={() => router.push(action.path)}
              >
                {action.label}
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
