// app/stats/shot-tracking/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/BackButton";
import { pct, parseYMD, daysAgo, monthsAgo, round1 } from "@/lib/stats/helpers";
import { fetchHoleScoringSourceCached, peekHoleScoringSource } from "@/lib/stats/queries";
import { DirectionArrow } from "@/components/ui/DirectionArrow";
import {
  computeShotTracking,
  APPROACH_CELL_ARIA,
  APPROACH_CELL_ARROW,
  APPROACH_CELL_LABEL,
  APPROACH_CELL_ORDER,
  type ApproachCell,
  type Avg,
  type Breakdown,
  type Rate,
  type ShotRow,
} from "@/lib/stats/shotTracking";

type Option = { id: string; name: string };

type TrackingRow = ShotRow & {
  profile_id: string | null;
  round_id: string | null;
  played_at: string | null;
  course_id: string | null;
  course_name: string | null;
  tee_box_id: string | null;
  tee_name: string | null;
  hole_number: number | null;
};

type TimePreset = "all" | "12m" | "6m" | "30d" | "40r" | "20r" | "10r" | "5r";

/** A rate with no qualifying holes shows a dash, never 0%. */
function fmtRate(r: Rate) {
  return r.rate == null ? "–" : pct(r.rate);
}

function fmtAvg(a: Avg, dp = 2) {
  if (a.avg == null) return "–";
  return dp === 2 ? a.avg.toFixed(2) : String(round1(a.avg));
}

/** Spells out how many holes contributed a derived zero rather than a tap. */
function inferredNote(inferred: number | undefined, what: string): string | undefined {
  if (!inferred) return undefined;
  return `+ ${inferred} tracked hole${inferred === 1 ? "" : "s"} counted as ${what}`;
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-4">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--sec-muted)] font-bold">{title}</div>
      {subtitle ? <div className="mt-1 text-[12px] text-[color:var(--sec-muted)] font-semibold">{subtitle}</div> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** Headline number with its denominator and an optional proportion bar. */
function MetricCard({
  title,
  value,
  meta,
  bar,
}: {
  title: string;
  value: string;
  meta: string;
  bar?: number | null;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_45%,transparent)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-extrabold text-[color:var(--sec-text)] truncate">{title}</div>
        <div className="text-[11px] text-[color:var(--sec-muted)] font-semibold shrink-0">{meta}</div>
      </div>
      <div className="mt-1 text-lg font-extrabold tabular-nums text-[color:var(--sec-accent)]">{value}</div>
      {bar != null ? (
        <div className="mt-2 h-2 w-full rounded-xl bg-[color:color-mix(in_srgb,var(--ciaga-ground)_60%,transparent)] border border-[color:var(--sec-hair)] overflow-hidden">
          <div className="h-full bg-[color:color-mix(in_srgb,var(--sec-accent)_70%,transparent)]" style={{ width: `${Math.max(0, Math.min(100, bar * 100))}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function BarRow({ label, r }: { label: string; r: Rate }) {
  const w = r.rate == null ? 0 : r.rate * 100;
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 text-[12px] text-[color:var(--sec-muted)] font-extrabold truncate">{label}</div>
      <div className="flex-1 h-2 rounded-xl bg-[color:color-mix(in_srgb,var(--ciaga-ground)_60%,transparent)] border border-[color:var(--sec-hair)] overflow-hidden">
        <div className="h-full bg-[color:var(--sec-surface-2)]" style={{ width: `${w}%` }} />
      </div>
      <div className="w-12 text-right text-[12px] text-[color:var(--sec-muted)] font-extrabold tabular-nums">{fmtRate(r)}</div>
      <div className="w-10 text-right text-[11px] text-[color:var(--sec-muted)] font-semibold tabular-nums">{r.hits}</div>
    </div>
  );
}

function CoverageRow({
  label,
  holes,
  rounds,
  note,
}: {
  label: string;
  holes: number;
  rounds: number;
  note?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="text-[12px] font-extrabold text-[color:var(--sec-text)] shrink-0">{label}</div>
      <div className="text-right">
        <div className="text-[12px] text-[color:var(--sec-muted)] font-semibold tabular-nums">
          {holes === 0
            ? "not recorded"
            : `${holes} hole${holes === 1 ? "" : "s"} · ${rounds} round${rounds === 1 ? "" : "s"}`}
        </div>
        {note ? <div className="text-[10px] text-[color:var(--sec-muted)] font-semibold">{note}</div> : null}
      </div>
    </div>
  );
}

/**
 * The nine approach cells as a dispersion target, mirroring the input grid on the
 * scorecard: long along the top, short along the bottom, green in the middle.
 * Cell shading is relative to the busiest cell so a miss pattern stands out.
 */
function ApproachGrid({ grid, n }: { grid: Record<ApproachCell, number>; n: number }) {
  const max = Math.max(1, ...APPROACH_CELL_ORDER.map((c) => grid[c]));

  return (
    <div className="grid grid-cols-3 gap-1 max-w-[300px] mx-auto">
      {APPROACH_CELL_ORDER.map((c) => {
        const count = grid[c];
        const share = n > 0 && count > 0 ? count / n : null;
        return (
          <div
            key={c}
            className="rounded-xl border border-[color:var(--sec-hair)] p-2 text-center"
            style={{ backgroundColor: `rgba(245, 230, 176, ${count === 0 ? 0.04 : 0.1 + 0.55 * (count / max)})` }}
          >
            <div
              className="text-[10px] font-bold text-[color:var(--sec-muted)] truncate h-[14px] flex items-center justify-center"
              title={APPROACH_CELL_ARIA[c]}
            >
              {APPROACH_CELL_LABEL[c] ?? <DirectionArrow dir={APPROACH_CELL_ARROW[c]!} size={12} />}
            </div>
            <div className="text-[15px] font-extrabold tabular-nums text-[color:var(--sec-text)]">{count}</div>
            <div className="text-[10px] font-semibold tabular-nums text-[color:var(--sec-muted)]">
              {share == null ? "–" : pct(share)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownTable({ rows }: { rows: Breakdown[] }) {
  if (!rows.length) {
    return <div className="text-[12px] text-[color:var(--sec-muted)] font-semibold">Nothing recorded yet.</div>;
  }
  const cell = (main: string, n: number) => (
    <div className="text-right">
      <div className="text-[13px] font-extrabold tabular-nums text-[color:var(--sec-text)]">{main}</div>
      <div className="text-[10px] text-[color:var(--sec-muted)] font-semibold tabular-nums">n={n}</div>
    </div>
  );
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[320px] space-y-2">
        <div className="grid grid-cols-5 gap-2 text-[10px] uppercase tracking-[0.1em] text-[color:var(--sec-muted)] font-bold">
          <div />
          <div className="text-right">GIR</div>
          <div className="text-right">FIR</div>
          <div className="text-right">Putts</div>
          <div className="text-right">Scr</div>
        </div>
        {rows.map((b) => (
          <div key={b.label} className="grid grid-cols-5 gap-2 items-center">
            <div className="text-[12px] font-extrabold text-[color:var(--sec-muted)] truncate">{b.label}</div>
            {cell(fmtRate(b.gir), b.gir.n)}
            {cell(fmtRate(b.fir), b.fir.n)}
            {cell(fmtAvg(b.putts), b.putts.n)}
            {cell(fmtRate(b.scramble), b.scramble.n)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ShotTrackingPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<TrackingRow[]>([]);

  const [preset, setPreset] = useState<TimePreset>("all");
  const [courseId, setCourseId] = useState<string>("");
  const [teeBoxId, setTeeBoxId] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const user = (authData.user as any) ?? null;
        if (!user) throw new Error("You must be signed in.");

        const pid = await getMyProfileIdByAuthUserId(user.id);

        const cached = peekHoleScoringSource(pid);
        if (cached && alive) {
          setRows(cached as TrackingRow[]);
          setLoading(false);
        }

        const data = await fetchHoleScoringSourceCached(pid, (fresh) => {
          if (alive) setRows(fresh as TrackingRow[]);
        });

        if (!alive) return;
        setRows(((data as any) ?? []) as TrackingRow[]);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load shot tracking.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const courseOptions: Option[] = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (!r.course_id) continue;
      m.set(r.course_id, r.course_name ?? r.course_id.slice(0, 8));
    }
    return Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const teeOptions: Option[] = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (courseId && r.course_id !== courseId) continue;
      if (!r.tee_box_id) continue;
      m.set(r.tee_box_id, r.tee_name ?? r.tee_box_id.slice(0, 8));
    }
    return Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, courseId]);

  useEffect(() => {
    if (!teeBoxId) return;
    if (!teeOptions.some((t) => t.id === teeBoxId)) setTeeBoxId("");
  }, [courseId, teeOptions, teeBoxId]);

  const timeFiltered = useMemo(() => {
    if (!rows.length) return [];

    if (preset === "30d" || preset === "6m" || preset === "12m") {
      const minTs = preset === "30d" ? daysAgo(30) : preset === "6m" ? monthsAgo(6) : monthsAgo(12);
      return rows.filter((r) => {
        const ts = parseYMD(r.played_at);
        return ts != null && ts >= minTs;
      });
    }

    if (preset === "5r" || preset === "10r" || preset === "20r" || preset === "40r") {
      const limitRounds = preset === "5r" ? 5 : preset === "10r" ? 10 : preset === "20r" ? 20 : 40;
      const allowed = new Set<string>();
      for (const r of rows) {
        if (!r.round_id || allowed.has(r.round_id)) continue;
        allowed.add(r.round_id);
        if (allowed.size >= limitRounds) break;
      }
      return rows.filter((r) => !!r.round_id && allowed.has(r.round_id));
    }

    return rows;
  }, [rows, preset]);

  const filtered = useMemo(
    () =>
      timeFiltered.filter((r) => {
        if (courseId && r.course_id !== courseId) return false;
        if (teeBoxId && r.tee_box_id !== teeBoxId) return false;
        return true;
      }),
    [timeFiltered, courseId, teeBoxId]
  );

  const stats = useMemo(() => computeShotTracking(filtered), [filtered]);

  const presetLabel = (p: TimePreset) => {
    if (p === "all") return "All time";
    if (p === "12m") return "Last 12 months";
    if (p === "6m") return "Last 6 months";
    if (p === "30d") return "Last 30 days";
    if (p === "40r") return "Last 40 rounds";
    if (p === "20r") return "Last 20 rounds";
    if (p === "10r") return "Last 10 rounds";
    return "Last 5 rounds";
  };

  const subtitle = useMemo(() => {
    const parts = [presetLabel(preset)];
    if (courseId) parts.push(courseOptions.find((c) => c.id === courseId)?.name ?? "Course");
    if (teeBoxId) parts.push(teeOptions.find((t) => t.id === teeBoxId)?.name ?? "Tee");
    return parts.join(" · ");
  }, [preset, courseId, teeBoxId, courseOptions, teeOptions]);

  return (
    <div className="h-[calc(100dvh-var(--ciaga-nav-h))] bg-[color:var(--ciaga-ground)] text-slate-100 px-1.5 sm:px-2 pt-4">
      <div className="mx-auto w-full max-w-3xl h-full flex flex-col">
        <header className="sticky top-0 z-20 bg-[color:var(--ciaga-ground)] pb-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <BackButton onClick={() => router.back()} />

            <div className="text-center flex-1 min-w-0 px-2">
              <div className="text-[15px] sm:text-base font-semibold tracking-wide text-[color:var(--sec-accent)] truncate">
                Shot tracking
              </div>
              <div className="text-[11px] sm:text-[10px] uppercase tracking-[0.14em] text-[color:var(--sec-muted)] truncate">
                {subtitle}
              </div>
            </div>

            <div className="w-[64px]" />
          </div>

          <div className="mt-3 px-1">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setFiltersOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setFiltersOpen((v) => !v);
              }}
              className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-2 select-none cursor-pointer"
              aria-expanded={filtersOpen}
              title="Tap to expand filters"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--sec-muted)] font-bold">Filters</div>
                  <div className="mt-1 text-[12px] text-[color:var(--sec-text)] font-extrabold leading-tight">{subtitle}</div>
                </div>
                <div className="shrink-0 text-[12px] font-extrabold text-[color:var(--sec-accent)] pt-[2px]">
                  {filtersOpen ? "▲" : "▼"}
                </div>
              </div>

              {filtersOpen ? (
                <div className="mt-3 space-y-2">
                  <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_40%,transparent)] p-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--sec-muted)] font-bold mb-2">
                      Time range
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreset("all");
                        }}
                        className={[
                          "rounded-2xl px-3 py-2 text-[13px] font-extrabold border w-full",
                          preset === "all"
                            ? "bg-[color:color-mix(in_srgb,var(--ciaga-ground)_70%,transparent)] border-[color:color-mix(in_srgb,var(--sec-accent)_60%,transparent)] text-[color:var(--sec-accent)]"
                            : "bg-[color:color-mix(in_srgb,var(--ciaga-ground)_30%,transparent)] border-[color:var(--sec-hair)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]",
                        ].join(" ")}
                      >
                        All time
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {(
                        [
                          ["12m", "Last 12 months"],
                          ["6m", "Last 6 months"],
                          ["30d", "Last 30 days"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreset(id);
                          }}
                          className={[
                            "rounded-2xl px-3 py-2 text-[13px] font-extrabold border leading-tight",
                            preset === id
                              ? "bg-[color:color-mix(in_srgb,var(--ciaga-ground)_70%,transparent)] border-[color:color-mix(in_srgb,var(--sec-accent)_60%,transparent)] text-[color:var(--sec-accent)]"
                              : "bg-[color:color-mix(in_srgb,var(--ciaga-ground)_30%,transparent)] border-[color:var(--sec-hair)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]",
                          ].join(" ")}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(
                        [
                          ["40r", "Last 40 rounds"],
                          ["20r", "Last 20 rounds"],
                          ["10r", "Last 10 rounds"],
                          ["5r", "Last 5 rounds"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreset(id);
                          }}
                          className={[
                            "rounded-2xl px-3 py-2 text-[13px] font-extrabold border leading-tight",
                            preset === id
                              ? "bg-[color:color-mix(in_srgb,var(--ciaga-ground)_70%,transparent)] border-[color:color-mix(in_srgb,var(--sec-accent)_60%,transparent)] text-[color:var(--sec-accent)]"
                              : "bg-[color:color-mix(in_srgb,var(--ciaga-ground)_30%,transparent)] border-[color:var(--sec-hair)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]",
                          ].join(" ")}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_40%,transparent)] p-2">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--sec-muted)] font-bold">Course</div>
                      <select
                        value={courseId}
                        onChange={(e) => setCourseId(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 w-full rounded-xl bg-[color:color-mix(in_srgb,var(--ciaga-ground)_70%,transparent)] border border-[color:var(--sec-hair)] px-2 py-2 text-[13px] text-[color:var(--sec-text)]"
                      >
                        <option value="">All</option>
                        {courseOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_40%,transparent)] p-2">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--sec-muted)] font-bold">Tee</div>
                      <select
                        value={teeBoxId}
                        onChange={(e) => setTeeBoxId(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 w-full rounded-xl bg-[color:color-mix(in_srgb,var(--ciaga-ground)_70%,transparent)] border border-[color:var(--sec-hair)] px-2 py-2 text-[13px] text-[color:var(--sec-text)]"
                      >
                        <option value="">All tees</option>
                        {teeOptions.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-y-contain pb-[env(safe-area-inset-bottom)]">
          {loading ? (
            <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-4 text-sm text-[color:var(--sec-muted)]">
              Loading…
            </div>
          ) : err ? (
            <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-4">
              <p className="text-sm text-red-100">{err}</p>
              <div className="mt-3">
                <Button
                  variant="outline"
                  className="border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
                  onClick={() => window.location.reload()}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : !stats.anyData ? (
            <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-6 space-y-2">
              <div className="text-sm font-semibold text-[color:var(--sec-text)]">Nothing tracked yet</div>
              <p className="text-[12px] text-[color:var(--sec-muted)] leading-relaxed">
                Shot tracking is optional and off to one side of scoring. While you&apos;re playing, tap a score cell on
                the scorecard and expand <span className="font-extrabold text-[color:var(--sec-text)]">Shot tracking</span> above the
                keypad, then tap whatever you care about — putts, fairway, approach, bunker, penalties.
              </p>
              <p className="text-[12px] text-[color:var(--sec-muted)] leading-relaxed">
                Every stat here counts only the holes you actually recorded, so you can track one thing and ignore the
                rest.
              </p>
              {rows.length ? (
                <p className="text-[11px] text-[color:var(--sec-muted)] font-semibold">
                  Nothing recorded in this filter — try widening the time range.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <Panel title="Coverage" subtitle="What you actually recorded — every number below counts only these holes.">
                <div className="space-y-1.5">
                  <CoverageRow label="Putts" {...stats.coverage.putts} />
                  <CoverageRow label="Fairways" {...stats.coverage.fairway} />
                  <CoverageRow label="Approaches" {...stats.coverage.approach} />
                  <CoverageRow
                    label="Bunkers"
                    {...stats.coverage.bunker}
                    note={inferredNote(stats.coverage.bunker.inferred, "no bunker")}
                  />
                  <CoverageRow
                    label="Penalties"
                    {...stats.coverage.penalties}
                    note={inferredNote(stats.coverage.penalties.inferred, "no penalty")}
                  />
                  <div className="pt-1.5 mt-1.5 border-t border-[color:var(--sec-hair)] space-y-1.5">
                    <CoverageRow label="GIR (from putts)" {...stats.coverage.gir} />
                    <CoverageRow label="Tracked holes" {...stats.coverage.tracked} />
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-[color:var(--sec-muted)] font-semibold leading-relaxed">
                  A hole counts as tracked once you record two or more things on it. Bunkers and penalties only get
                  tapped when they happen, so on a tracked hole an untouched one is read as &ldquo;didn&rsquo;t
                  happen&rdquo; — that&rsquo;s the only place a number here is inferred rather than entered.
                </p>
              </Panel>

              <Panel title="Putting" subtitle="Holes where you recorded putts">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <MetricCard
                    title="Putts / hole"
                    value={fmtAvg(stats.putting.overall)}
                    meta={`n=${stats.putting.overall.n}`}
                  />
                  <MetricCard
                    title="Per 18"
                    value={stats.putting.per18 == null ? "–" : String(round1(stats.putting.per18))}
                    meta="projected"
                  />
                  <MetricCard
                    title="3-putt+"
                    value={fmtRate(stats.putting.threePlus)}
                    meta={`${stats.putting.threePlus.hits} hole${stats.putting.threePlus.hits === 1 ? "" : "s"}`}
                    bar={stats.putting.threePlus.rate}
                  />
                </div>

                <div className="mt-3 space-y-2">
                  <BarRow label="0 putts" r={stats.putting.zero} />
                  <BarRow label="1 putt" r={stats.putting.one} />
                  <BarRow label="2 putts" r={stats.putting.two} />
                  <BarRow label="3+ putts" r={stats.putting.threePlus} />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MetricCard
                    title="Putts on GIR"
                    value={fmtAvg(stats.putting.onGir)}
                    meta={`n=${stats.putting.onGir.n}`}
                  />
                  <MetricCard
                    title="Putts off GIR"
                    value={fmtAvg(stats.putting.offGir)}
                    meta={`n=${stats.putting.offGir.n}`}
                  />
                </div>
              </Panel>

              <Panel
                title="Greens in regulation"
                subtitle="Derived from putts: on the green in par − 2 or fewer shots"
              >
                <MetricCard
                  title="GIR"
                  value={fmtRate(stats.gir.overall)}
                  meta={`${stats.gir.overall.hits} of ${stats.gir.overall.n}`}
                  bar={stats.gir.overall.rate}
                />
                {stats.gir.byPar.length ? (
                  <div className="mt-3 space-y-2">
                    {stats.gir.byPar.map((b) => (
                      <BarRow key={b.label} label={b.label} r={b.rate} />
                    ))}
                  </div>
                ) : null}
              </Panel>

              <Panel title="Off the tee" subtitle="Fairways hit — par 4s and 5s only">
                <MetricCard
                  title="Fairways in regulation"
                  value={fmtRate(stats.fir.overall)}
                  meta={`${stats.fir.overall.hits} of ${stats.fir.overall.n}`}
                  bar={stats.fir.overall.rate}
                />
                <div className="mt-3 space-y-2">
                  <BarRow label="Missed left" r={stats.fir.missLeft} />
                  <BarRow label="Missed right" r={stats.fir.missRight} />
                </div>
                {stats.fir.byPar.length ? (
                  <div className="mt-3 space-y-2 pt-3 border-t border-[color:var(--sec-hair)]">
                    {stats.fir.byPar.map((b) => (
                      <BarRow key={b.label} label={b.label} r={b.rate} />
                    ))}
                  </div>
                ) : null}
              </Panel>

              <Panel
                title="Approach pattern"
                subtitle={`Where your approach finished · ${stats.approach.n} recorded`}
              >
                <ApproachGrid grid={stats.approach.grid} n={stats.approach.n} />

                <div className="mt-3 pt-3 border-t border-[color:var(--sec-hair)] text-[12px] font-semibold text-[color:var(--sec-muted)] text-center tabular-nums">
                  Short {fmtRate(stats.approach.short)} · Long {fmtRate(stats.approach.long)} · Left{" "}
                  {fmtRate(stats.approach.left)} · Right {fmtRate(stats.approach.right)}
                </div>

                <p className="mt-3 text-[11px] text-[color:var(--sec-muted)] font-semibold leading-relaxed">
                  A corner counts on both axes, so the summary line reads short/long and left/right separately rather
                  than as one set adding to 100%. This is dispersion only — GIR above comes from putts, because the shot
                  you hit at the green isn&apos;t always the one that decides regulation.
                </p>
              </Panel>

              <Panel title="Scrambling & sand" subtitle="Holes where the green was missed">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <MetricCard
                    title="Par scramble"
                    value={fmtRate(stats.scrambling.parSave)}
                    meta={`${stats.scrambling.parSave.hits} of ${stats.scrambling.parSave.n}`}
                    bar={stats.scrambling.parSave.rate}
                  />
                  <MetricCard
                    title="Bogey scramble"
                    value={fmtRate(stats.scrambling.bogeySave)}
                    meta={`${stats.scrambling.bogeySave.hits} of ${stats.scrambling.bogeySave.n}`}
                    bar={stats.scrambling.bogeySave.rate}
                  />
                  <MetricCard
                    title="Sand save"
                    value={fmtRate(stats.scrambling.sandSave)}
                    meta={`${stats.scrambling.sandSave.hits} of ${stats.scrambling.sandSave.n}`}
                    bar={stats.scrambling.sandSave.rate}
                  />
                </div>
                <div className="mt-2">
                  <MetricCard
                    title="Holes with a bunker"
                    value={fmtRate(stats.scrambling.bunkerHoles)}
                    meta={`${stats.scrambling.bunkerHoles.hits} of ${stats.scrambling.bunkerHoles.n}`}
                    bar={stats.scrambling.bunkerHoles.rate}
                  />
                </div>

                <p className="mt-3 text-[11px] text-[color:var(--sec-muted)] font-semibold leading-relaxed">
                  A sand save needs both a bunker and a missed green on the same hole, so a fairway bunker on a green
                  you hit is never counted as a missed opportunity.
                </p>
              </Panel>

              <Panel title="Penalties" subtitle="Across tracked holes">
                <div className="grid grid-cols-3 gap-2">
                  <MetricCard title="Total" value={String(stats.penalties.total)} meta="strokes" />
                  <MetricCard
                    title="Per 18"
                    value={stats.penalties.per18 == null ? "–" : String(round1(stats.penalties.per18))}
                    meta="projected"
                  />
                  <MetricCard
                    title="1+ penalty"
                    value={fmtRate(stats.penalties.holesWithPenalty)}
                    meta={`${stats.penalties.holesWithPenalty.hits} of ${stats.penalties.holesWithPenalty.n}`}
                    bar={stats.penalties.holesWithPenalty.rate}
                  />
                </div>
              </Panel>

              <Panel title="By par" subtitle="GIR · fairways · putts · par scramble">
                <BreakdownTable rows={stats.breakdowns.byPar} />
              </Panel>

              <Panel title="By stroke index" subtitle="Hardest holes first">
                <BreakdownTable rows={stats.breakdowns.bySi} />
              </Panel>

              <Panel title="By length" subtitle="Banded relative to each hole's par">
                <BreakdownTable rows={stats.breakdowns.byLength} />
              </Panel>

              <div className="pt-1 pb-4 text-[10px] text-[color:var(--sec-muted)] text-center font-semibold">
                CIAGA · Shot tracking
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
