// app/stats/scoring-breakdown/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";

// -----------------------------
// Helpers (match hole-scoring style)
// -----------------------------
function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function pct(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}
function safeNum(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function parseYMD(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getTime();
}
function monthsAgo(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.getTime();
}

type Option = { id: string; name: string };

// IMPORTANT: this matches your view columns as pasted
type BreakdownRow = {
  profile_id: string | null;
  round_id: string | null;
  played_at: string | null;

  course_id: string | null;
  course_name: string | null;

  tee_box_id: string | null;
  tee_name: string | null;

  hole_number: number | null;
  par: number | null;
  yardage: number | null;
  stroke_index: number | null;

  strokes: number | null;
  to_par: number | null;

  // Net (from view)
  net_strokes?: number | null;
  net_to_par?: number | null;
  strokes_received?: number | null;

  is_double_plus: boolean | null;
  is_triple_plus: boolean | null;
};

type TimePreset = "all" | "12m" | "6m" | "30d" | "40r" | "20r" | "10r" | "5r";

async function fetchAllHoleScoringSource(profileId: string) {
  const pageSize = 1000;
  let from = 0;

  const out: any[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("hole_scoring_source")
      .select(
        "profile_id, round_id, played_at, course_id, course_name, tee_box_id, tee_name, hole_number, par, yardage, stroke_index, strokes, to_par, net_strokes, net_to_par, strokes_received, is_double_plus, is_triple_plus"
      )
      .eq("profile_id", profileId)
      .order("played_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const chunk = (data ?? []) as any[];
    out.push(...chunk);

    // Stop once we get less than a full page
    if (chunk.length < pageSize) break;

    from += pageSize;
  }

  return out;
}

export default function ScoringBreakdownPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [scoreMode, setScoreMode] = useState<"gross" | "net">("gross");
  const [preset, setPreset] = useState<TimePreset>("6m");

  // Data (fetch once; filter in-memory like hole-scoring)
  const [rows, setRows] = useState<BreakdownRow[]>([]);

  const [courseId, setCourseId] = useState<string>(""); // empty = all
  const [teeBoxId, setTeeBoxId] = useState<string>(""); // empty = all
  const [filtersOpen, setFiltersOpen] = useState(false);

  // -----------------------------
  // Load data (once)
  // -----------------------------
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

        const data = await fetchAllHoleScoringSource(pid);
        const got = ((data as any) ?? []) as BreakdownRow[];

        if (!alive) return;
        setRows(got);

      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load scoring breakdown.");
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

  // Tee options depend on selected course
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

  // If course changes and tee no longer matches, reset tee filter
  useEffect(() => {
    if (!teeBoxId) return;
    const ok = teeOptions.some((t) => t.id === teeBoxId);
    if (!ok) setTeeBoxId("");
  }, [courseId, teeOptions, teeBoxId]);

  const netAvailable = useMemo(
    () => rows.some((r) => safeNum(r.net_to_par) != null || safeNum(r.net_strokes) != null),
    [rows]
  );

  const getToPar = (r: BreakdownRow) => (scoreMode === "net" ? safeNum(r.net_to_par) : safeNum(r.to_par));

  // Apply time preset
  const timeFiltered = useMemo(() => {
    if (!rows.length) return [];

    if (preset === "30d" || preset === "6m" || preset === "12m") {
      const minTs = preset === "30d" ? daysAgo(30) : preset === "6m" ? monthsAgo(6) : monthsAgo(12);
      return rows.filter((r) => {
        const ts = parseYMD(r.played_at);
        if (ts == null) return false;
        return ts >= minTs;
      });
    }

    if (preset === "5r" || preset === "10r" || preset === "20r" || preset === "40r") {
      const limitRounds = preset === "5r" ? 5 : preset === "10r" ? 10 : preset === "20r" ? 20 : 40;

      const roundOrder: string[] = [];
      const seen = new Set<string>();

      for (const r of rows) {
        if (!r.round_id) continue;
        if (seen.has(r.round_id)) continue;
        seen.add(r.round_id);
        roundOrder.push(r.round_id);
        if (roundOrder.length >= limitRounds) break;
      }

      const allowed = new Set(roundOrder);
      return rows.filter((r) => !!r.round_id && allowed.has(r.round_id));
    }

    return rows;
  }, [rows, preset]);

  // Apply course/tee filters
  const filtered = useMemo(() => {
    return timeFiltered.filter((r) => {
      if (courseId && r.course_id !== courseId) return false;
      if (teeBoxId && r.tee_box_id !== teeBoxId) return false;
      return true;
    });
  }, [timeFiltered, courseId, teeBoxId]);

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

  // -----------------------------
  // Aggregations
  // -----------------------------
  const summary = useMemo(() => {
    const n = filtered.length;
    if (!n) return null;

    let birdiePlus = 0;
    let par = 0;
    let parPlus = 0;

    const roundTotals = new Map<string, number>(); // round_id -> sum(to_par/net_to_par)

    for (const r of filtered) {
      const tp = getToPar(r);
      if (tp == null) continue;

      if (tp <= -1) birdiePlus += 1;
      else if (tp === 0) par += 1;
      else parPlus += 1;

      if (r.round_id) roundTotals.set(r.round_id, (roundTotals.get(r.round_id) ?? 0) + tp);
    }

    const classified = Math.max(1, birdiePlus + par + parPlus);

    return {
      holes: n,
      rounds: roundTotals.size,
      birdiePlus,
      par,
      parPlus,
      birdiePlusRate: birdiePlus / classified,
      parRate: par / classified,
      parPlusRate: parPlus / classified,
      roundTotals,
    };
  }, [filtered, scoreMode]);

  const distribution = useMemo(() => {
    if (!summary) return [];

    const m = new Map<string, number>();

    for (const v of summary.roundTotals.values()) {
      const k = Math.round(v);

      let label: string;
      if (k <= -5) label = "≤ -5";
      else if (k >= 11) label = "≥ +11";
      else label = k === 0 ? "E" : k > 0 ? `+${k}` : `${k}`;

      m.set(label, (m.get(label) ?? 0) + 1);
    }

    const orderKey = (label: string) => {
      if (label === "≤ -5") return -999;
      if (label === "≥ +11") return 999;
      if (label === "E") return 0;
      return parseInt(label.replace("+", ""), 10);
    };

    return Array.from(m.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => orderKey(a.label) - orderKey(b.label));
  }, [summary]);

  function RateCard(props: { title: string; count: number; rate: number }) {
    const { title, count, rate } = props;

    return (
      <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-emerald-50 truncate">{title}</div>
          </div>
          <div className="text-[11px] text-emerald-100/70 font-semibold shrink-0">count: {count}</div>
        </div>

        <div className="mt-2">
          <div className="text-[11px] text-emerald-100/70 font-bold">Rate</div>
          <div className="text-lg font-extrabold tabular-nums text-[#f5e6b0]">{pct(rate)}</div>

          <div className="mt-2 h-2 w-full rounded-xl bg-[#042713]/60 border border-emerald-900/60 overflow-hidden">
            <div
              className="h-full bg-[#f5e6b0]/70"
              style={{ width: `${Math.max(0, Math.min(100, rate * 100))}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  function DistRow(props: { label: string; count: number; max: number }) {
    const { label, count, max } = props;
    const w = max ? (count / max) * 100 : 0;

    return (
      <div className="flex items-center gap-3">
        <div className="w-16 text-[12px] text-emerald-100/70 font-extrabold tabular-nums">{label}</div>
        <div className="flex-1 h-2 rounded-xl bg-[#042713]/60 border border-emerald-900/60 overflow-hidden">
          <div className="h-full bg-emerald-100/55" style={{ width: `${w}%` }} />
        </div>
        <div className="w-10 text-right text-[12px] text-emerald-100/70 font-extrabold tabular-nums">{count}</div>
      </div>
    );
  }

  const subtitle = useMemo(() => {
    const parts = [presetLabel(preset), scoreMode === "gross" ? "Gross" : "Net"];
    if (courseId) parts.push(courseOptions.find((c) => c.id === courseId)?.name ?? "Course");
    if (teeBoxId) parts.push(teeOptions.find((t) => t.id === teeBoxId)?.name ?? "Tee");
    return parts.join(" · ");
  }, [preset, scoreMode, courseId, teeBoxId, courseOptions, teeOptions]);

  // -----------------------------
  // UI (match hole-scoring layout)
  // -----------------------------
  return (
    <div className="h-screen bg-[#042713] text-slate-100 px-1.5 sm:px-2 pt-4">
      <div className="mx-auto w-full max-w-3xl h-full flex flex-col">
        <header className="sticky top-0 z-20 bg-[#042713] pb-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-emerald-100 hover:bg-emerald-900/30"
              onClick={() => router.back()}
            >
              ← Back
            </Button>

            <div className="text-center flex-1 min-w-0 px-2">
              <div className="text-[15px] sm:text-base font-semibold tracking-wide text-[#f5e6b0] truncate">
                Scoring breakdown
              </div>
              <div className="text-[11px] sm:text-[10px] uppercase tracking-[0.14em] text-emerald-200/70 truncate">
                {subtitle}
              </div>
            </div>

            <div className="w-[64px]" />
          </div>

          {/* Filters (tap container to expand/collapse) */}
          <div className="mt-3 px-1">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setFiltersOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setFiltersOpen((v) => !v);
              }}
              className={[
                "rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70",
                "p-2 select-none cursor-pointer",
              ].join(" ")}
              aria-expanded={filtersOpen}
              title="Tap to expand filters"
            >
              {/* Collapsed summary row */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Filters</div>
                  <div className="mt-1 text-[12px] text-emerald-50/90 font-extrabold leading-tight">{subtitle}</div>
                </div>

                <div className="shrink-0 text-[12px] font-extrabold text-[#f5e6b0] pt-[2px]">
                  {filtersOpen ? "▲" : "▼"}
                </div>
              </div>

              {filtersOpen ? (
                <div className="mt-3 space-y-2">
                  {/* Time range as 3 rows */}
                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold mb-2">
                      Time range
                    </div>

                    {/* Row 1: All time */}
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
                            ? "bg-[#042713]/70 border-[#f5e6b0]/60 text-[#f5e6b0]"
                            : "bg-[#042713]/30 border-emerald-900/70 text-emerald-50/90 hover:bg-emerald-900/20",
                        ].join(" ")}
                      >
                        All time
                      </button>
                    </div>

                    {/* Row 2: time */}
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {([
                        ["12m", "Last 12 months"],
                        ["6m", "Last 6 months"],
                        ["30d", "Last 30 days"],
                      ] as const).map(([id, label]) => {
                        const active = preset === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreset(id);
                            }}
                            className={[
                              "rounded-2xl px-3 py-2 text-[13px] font-extrabold border leading-tight",
                              active
                                ? "bg-[#042713]/70 border-[#f5e6b0]/60 text-[#f5e6b0]"
                                : "bg-[#042713]/30 border-emerald-900/70 text-emerald-50/90 hover:bg-emerald-900/20",
                            ].join(" ")}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Row 3: rounds */}
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {([
                        ["40r", "Last 40 rounds"],
                        ["20r", "Last 20 rounds"],
                        ["10r", "Last 10 rounds"],
                        ["5r", "Last 5 rounds"],
                      ] as const).map(([id, label]) => {
                        const active = preset === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreset(id);
                            }}
                            className={[
                              "rounded-2xl px-3 py-2 text-[13px] font-extrabold border leading-tight",
                              active
                                ? "bg-[#042713]/70 border-[#f5e6b0]/60 text-[#f5e6b0]"
                                : "bg-[#042713]/30 border-emerald-900/70 text-emerald-50/90 hover:bg-emerald-900/20",
                            ].join(" ")}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Course + tee + scoring */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-2 col-span-2">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Course</div>
                      <select
                        value={courseId}
                        onChange={(e) => setCourseId(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 w-full rounded-xl bg-[#042713]/70 border border-emerald-900/70 px-2 py-2 text-[13px] text-emerald-50"
                      >
                        <option value="">All</option>
                        {courseOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-2 col-span-2 sm:col-span-1">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Tee</div>
                      <select
                        value={teeBoxId}
                        onChange={(e) => setTeeBoxId(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 w-full rounded-xl bg-[#042713]/70 border border-emerald-900/70 px-2 py-2 text-[13px] text-emerald-50"
                      >
                        <option value="">All tees</option>
                        {teeOptions.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-2 col-span-2 sm:col-span-1">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">
                        Scoring
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (scoreMode === "net" && !netAvailable) return;
                            setScoreMode(scoreMode === "gross" ? "net" : "gross");
                          }}
                          className={[
                            "w-full rounded-xl border px-3 py-2 text-[13px] font-extrabold",
                            scoreMode === "gross"
                              ? "bg-[#042713]/70 border-[#f5e6b0]/30 text-emerald-50"
                              : "bg-[#042713]/70 border-[#f5e6b0]/60 text-[#f5e6b0]",
                          ].join(" ")}
                          title="Toggle gross vs net"
                        >
                          {scoreMode === "gross" ? "Gross" : "Net"}
                        </button>
                      </div>

                      <div className="mt-2 text-[12px] font-semibold text-emerald-100/80 leading-snug">
                        <span className="font-extrabold text-emerald-50">
                          {scoreMode === "gross" ? "Gross scoring" : "Net scoring"}
                        </span>
                        {" · "}
                        Birdie+ / Par / Par+
                      </div>

                      {scoreMode === "net" && !netAvailable ? (
                        <div className="mt-1 text-[11px] text-red-200/80 font-semibold">
                          Net fields not available (view not rebuilt yet)
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-y-contain pb-[env(safe-area-inset-bottom)]">
          {loading ? (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
              Loading…
            </div>
          ) : err ? (
            <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-4">
              <p className="text-sm text-red-100">{err}</p>
              <div className="mt-3">
                <Button
                  variant="outline"
                  className="border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 hover:bg-emerald-900/20"
                  onClick={() => window.location.reload()}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : !filtered.length ? (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-6 space-y-2">
              <div className="text-sm font-semibold text-emerald-50">No hole data found</div>
              <p className="text-[12px] text-emerald-100/70">Try a different time preset or clear course/tee filters.</p>
            </div>
          ) : !summary ? (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-6 space-y-2">
              <div className="text-sm font-semibold text-emerald-50">No stats available</div>
              <p className="text-[12px] text-emerald-100/70">Some rows are missing to-par values.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Summary</div>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <div className="text-[11px] text-emerald-100/70 font-bold">Rounds</div>
                    <div className="text-lg font-extrabold tabular-nums text-emerald-50">{summary.rounds}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-emerald-100/70 font-bold">Holes</div>
                    <div className="text-lg font-extrabold tabular-nums text-emerald-50">{summary.holes}</div>
                  </div>
                  <div className="sm:block hidden">
                    <div className="text-[11px] text-emerald-100/70 font-bold">Birdie+ / Par / Par+</div>
                    <div className="text-[12px] font-extrabold tabular-nums text-emerald-50 whitespace-nowrap">
                      {pct(summary.birdiePlusRate)} / {pct(summary.parRate)} / {pct(summary.parPlusRate)}
                    </div>
                  </div>
                </div>

                <div className="mt-2 sm:hidden">
                  <div className="text-[11px] text-emerald-100/70 font-bold">Birdie+ / Par / Par+</div>
                  <div className="text-[12px] font-extrabold tabular-nums text-emerald-50 whitespace-nowrap">
                    {pct(summary.birdiePlusRate)} / {pct(summary.parRate)} / {pct(summary.parPlusRate)}
                  </div>
                </div>
              </div>

              {/* Rates */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">
                  Birdie / Par / Par+ rates
                </div>
                <div className="mt-1 text-[12px] text-emerald-100/70 font-semibold">
                  {scoreMode === "gross" ? "Gross scoring" : "Net scoring"} · by hole
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <RateCard title="Birdie+" count={summary.birdiePlus} rate={summary.birdiePlusRate} />
                  <RateCard title="Par" count={summary.par} rate={summary.parRate} />
                  <RateCard title="Par+" count={summary.parPlus} rate={summary.parPlusRate} />
                </div>
              </div>

              {/* Distribution */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">
                  Score-to-par distribution
                </div>
                <div className="mt-1 text-[12px] text-emerald-100/70 font-semibold leading-snug">
                  Each round bucketed by total{" "}
                  <span className="font-extrabold text-emerald-50">
                    {scoreMode === "gross" ? "to_par" : "net_to_par"}
                  </span>{" "}
                  (sum across holes)
                </div>

                <div className="mt-3 space-y-2">
                  {(() => {
                    const max = Math.max(1, ...distribution.map((d) => d.count));
                    return distribution.map((d) => <DistRow key={d.label} label={d.label} count={d.count} max={max} />);
                  })()}
                </div>

                <div className="pt-3 text-[10px] text-emerald-100/40 text-center font-semibold">
                  CIAGA · Scoring breakdown
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
