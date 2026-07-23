"use client";

import { useState } from "react";
import type { FeedItemDetail as FeedItemDetailData, MatchplayDetail, HoleStatBlock } from "@/lib/feed/types";
import dynamic from "next/dynamic";

// recharts is the single biggest dependency in the app and only ever renders
// inside an opened feed detail — keep it out of the main bundle.
const RoundProgressionChart = dynamic(() => import("./RoundProgressionChart"), {
  ssr: false,
  loading: () => <div className="h-48 w-full animate-pulse rounded-2xl bg-emerald-900/30" />,
});

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
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-100/50 truncate">{label}</div>
      <div className="mt-0.5 text-base font-extrabold text-emerald-50">{value}</div>
    </div>
  );
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-wide transition",
        active
          ? "bg-[#f5e6b0] text-[#042713]"
          : "border border-emerald-800/60 bg-emerald-950/30 text-emerald-100/70 hover:bg-emerald-900/40",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function StatGroup({ title, block, eventLabel }: { title: string; block: HoleStatBlock; eventLabel: string }) {
  return (
    <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-2.5">
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-100/50">{title}</div>
      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold text-emerald-100/60">Avg</span>
        <span className="text-sm font-extrabold text-emerald-50">
          {block.avg_score != null ? block.avg_score.toFixed(2) : "—"}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold text-emerald-100/60">{eventLabel}</span>
        <span className="text-sm font-extrabold text-[#f5e6b0]">
          {block.event_pct != null ? `${block.event_pct.toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="mt-1 text-[10px] font-semibold text-emerald-100/40">
        {block.plays} {block.plays === 1 ? "play" : "plays"}
      </div>
    </div>
  );
}

function MatchplayH2H({ mp }: { mp: MatchplayDetail }) {
  const [scope, setScope] = useState<"all" | "through">("all");
  const t = scope === "all" ? mp.all_time : mp.through_this_match;

  return (
    <Panel title="Head to head">
      <div className="mb-2 flex gap-1">
        <ToggleBtn active={scope === "all"} onClick={() => setScope("all")}>
          All time
        </ToggleBtn>
        <ToggleBtn active={scope === "through"} onClick={() => setScope("through")}>
          Through this match
        </ToggleBtn>
      </div>

      {t.total > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={mp.a_name} value={String(t.a_wins)} />
            <Stat label="Drawn" value={String(t.draws)} />
            <Stat label={mp.b_name} value={String(t.b_wins)} />
          </div>
          <div className="mt-1.5 text-[10px] font-semibold text-emerald-100/45">
            {t.total} {t.total === 1 ? "match" : "matches"}
          </div>
        </>
      ) : (
        <div className="text-xs font-semibold text-emerald-100/60">
          {scope === "all" ? "First meeting between these players." : "No earlier meetings."}
        </div>
      )}
    </Panel>
  );
}

export default function FeedItemDetail({ detail }: { detail: FeedItemDetailData | null }) {
  if (!detail) return null;

  if (detail.kind === "round") {
    if (!detail.players.length) return null;
    return (
      <div className="space-y-3">
        <RoundProgressionChart
          players={detail.players}
          grossRows={detail.gross_rows}
          netRows={detail.net_rows}
          formatChart={detail.format_chart ?? null}
        />
        {detail.matchplay ? <MatchplayH2H mp={detail.matchplay} /> : null}
      </div>
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
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatGroup title="This player" block={detail.player} eventLabel={detail.event_label} />
          <StatGroup title="Everyone" block={detail.everyone} eventLabel={detail.event_label} />
        </div>
      </Panel>
    );
  }

  if (detail.kind === "pb") {
    return (
      <Panel title="Personal best">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="New best" value={detail.gross != null ? String(detail.gross) : "—"} />
          <Stat label="Previous best" value={detail.previous_best ? String(detail.previous_best.gross) : "—"} />
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
