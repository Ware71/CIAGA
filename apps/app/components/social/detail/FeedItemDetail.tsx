"use client";

import type { FeedItemDetail as FeedItemDetailData } from "@/lib/feed/types";
import RoundProgressionChart from "./RoundProgressionChart";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/40 p-3">
      <div className="mb-2 text-xs font-extrabold text-[#f5e6b0]">{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-center">
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-100/50">{label}</div>
      <div className="mt-0.5 text-base font-extrabold text-emerald-50">{value}</div>
    </div>
  );
}

export default function FeedItemDetail({ detail }: { detail: FeedItemDetailData | null }) {
  if (!detail) return null;

  if (detail.kind === "round") {
    if (!detail.players.length) return null;
    return <RoundProgressionChart players={detail.players} rows={detail.rows} />;
  }

  if (detail.kind === "matchplay") {
    const at = detail.all_time;
    return (
      <Panel title="Head to head">
        {detail.this_match ? (
          <div className="mb-3 rounded-xl border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-sm font-extrabold text-[#f5e6b0]">
            {detail.this_match}
          </div>
        ) : null}

        {at && at.total > 0 ? (
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-100/50">
              All-time ({at.total} {at.total === 1 ? "match" : "matches"})
            </div>
            <div className="mt-1 grid grid-cols-3 gap-2">
              <Stat label={at.a_name} value={String(at.a_wins)} />
              <Stat label="Drawn" value={String(at.draws)} />
              <Stat label={at.b_name} value={String(at.b_wins)} />
            </div>
          </div>
        ) : (
          <div className="text-xs font-semibold text-emerald-100/60">First meeting between these players.</div>
        )}
      </Panel>
    );
  }

  if (detail.kind === "hole_event") {
    return (
      <Panel title={`${detail.event_label}${detail.hole_number ? ` · Hole ${detail.hole_number}` : ""}`}>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Par" value={detail.par != null ? String(detail.par) : "—"} />
          <Stat label="Yards" value={detail.yardage != null ? String(detail.yardage) : "—"} />
          <Stat label="SI" value={detail.stroke_index != null ? String(detail.stroke_index) : "—"} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stat label="Avg score" value={detail.avg_score != null ? detail.avg_score.toFixed(2) : "—"} />
          <Stat
            label={`${detail.event_label} rate`}
            value={detail.event_pct != null ? `${detail.event_pct.toFixed(1)}%` : "—"}
          />
        </div>
        {detail.plays > 0 ? (
          <div className="mt-2 text-[11px] font-semibold text-emerald-100/50">
            Based on {detail.plays} recorded {detail.plays === 1 ? "score" : "scores"} on this hole.
          </div>
        ) : null}
      </Panel>
    );
  }

  if (detail.kind === "pb") {
    return (
      <Panel title="Personal best">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="New best" value={detail.gross != null ? String(detail.gross) : "—"} />
          <Stat
            label="Previous best"
            value={detail.previous_best ? String(detail.previous_best.gross) : "—"}
          />
        </div>
        {detail.previous_best && detail.gross != null ? (
          <div className="mt-2 text-[11px] font-semibold text-emerald-100/60">
            Improved by {detail.previous_best.gross - detail.gross} shot
            {detail.previous_best.gross - detail.gross === 1 ? "" : "s"}.
          </div>
        ) : null}
      </Panel>
    );
  }

  if (detail.kind === "course_record") {
    return (
      <Panel title="Course record">
        {detail.beat ? (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="New record" value={detail.gross != null ? String(detail.gross) : "—"} />
            <Stat label={`Beat ${detail.beat.name ?? "previous"}`} value={String(detail.beat.gross)} />
          </div>
        ) : (
          <div className="text-sm font-semibold text-emerald-100/70">
            First recorded course record{detail.gross != null ? ` (${detail.gross})` : ""}.
          </div>
        )}
      </Panel>
    );
  }

  return null;
}
