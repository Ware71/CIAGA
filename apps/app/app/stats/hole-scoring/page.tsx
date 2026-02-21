// src/app/stats/hole-scoring/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";
import {
  round1, pct, safeNum, parseYMD, daysAgo, monthsAgo,
  normalizeTeeName, normalizeHoleNumberForNine,
} from "@/lib/stats/helpers";
import { fetchAllHoleScoringSource } from "@/lib/stats/queries";

// -----------------------------
// Helpers (page-specific)
// -----------------------------
function siBucket(si: number | null) {
  if (!si || !Number.isFinite(si)) return "Unknown";
  if (si <= 3) return "01–03";
  if (si <= 6) return "04–06";
  if (si <= 9) return "07–09";
  if (si <= 12) return "10–12";
  if (si <= 15) return "13–15";
  return "16–18";
}

// Buckets per par (final ranges)
function lengthBucketByPar(par: number | null, yardage: number | null) {
  const p = par == null ? null : Math.round(par);
  const y = yardage == null ? null : Number(yardage);
  if (!p || y == null || !Number.isFinite(y)) return "Other";

  // Par 3 (typically ~90–240y)
  if (p === 3) {
    if (y < 140) return "<140";
    if (y < 170) return "140–169";
    if (y < 200) return "170–199";
    return "200+";
  }

  // Par 4 (typically ~260–520y)
  if (p === 4) {
    if (y < 330) return "<330";
    if (y < 380) return "330–379";
    if (y < 430) return "380–429";
    if (y < 480) return "430–479";
    return "480+";
  }

  // Par 5 (data-driven)
  if (p === 5) {
    if (y < 460) return "<460";
    if (y < 490) return "460–489";
    if (y < 520) return "490–519";
    if (y < 550) return "520–549";
    return "550+";
  }

  return "Other";
}


type HoleRow = {
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

type Option = { id: string; name: string };

type TimePreset = "all" | "12m" | "6m" | "30d" | "40r" | "20r" | "10r" | "5r";

export default function HoleScoringPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [blowupMode, setBlowupMode] = useState<"double" | "triple">("double");
  const [scoreMode, setScoreMode] = useState<"gross" | "net">("gross");

  // Presets
  const [preset, setPreset] = useState<TimePreset>("6m");

  // Data (we fetch once; filter in-memory via preset)
  const [rows, setRows] = useState<HoleRow[]>([]);

  const [courseId, setCourseId] = useState<string>(""); // empty = all
  const [teeBoxId, setTeeBoxId] = useState<string>(""); // empty = all

  // Filters container expands/collapses when tapped
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
        const got = ((data as any) ?? []) as HoleRow[];

        if (!alive) return;
        setRows(got);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load hole scoring.");
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

  const getStrokes = (r: HoleRow) => (scoreMode === "net" ? safeNum(r.net_strokes) : safeNum(r.strokes));
  const getToPar = (r: HoleRow) => (scoreMode === "net" ? safeNum(r.net_to_par) : safeNum(r.to_par));

  const blowupFlag = (r: HoleRow) => {
    // Use to-par threshold for both gross and net so it behaves consistently.
    const tp = getToPar(r);
    if (tp == null) return false;
    return blowupMode === "double" ? tp >= 2 : tp >= 3;
  };

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

  // -----------------------------
  // Shared stats helper for "By X" blocks
  // -----------------------------
  function computeDetail(rs: HoleRow[]) {
    const attempts = rs.length;
    const avgStrokes = rs.reduce((a, r) => a + (getStrokes(r) ?? 0), 0) / attempts;
    const avgToPar = rs.reduce((a, r) => a + (getToPar(r) ?? 0), 0) / attempts;
    const blow = rs.reduce((a, r) => a + (blowupFlag(r) ? 1 : 0), 0) / attempts;

    const birdieOrBetter = rs.reduce((a, r) => a + ((getToPar(r) ?? 999) <= -1 ? 1 : 0), 0) / attempts;
    const parRate = rs.reduce((a, r) => a + ((getToPar(r) ?? 999) === 0 ? 1 : 0), 0) / attempts;
    const bogey = rs.reduce((a, r) => a + ((getToPar(r) ?? 999) === 1 ? 1 : 0), 0) / attempts;

    return { attempts, avgStrokes, avgToPar, blow, birdieOrBetter, parRate, bogey };
  }

  // -----------------------------
  // Aggregations
  // -----------------------------
  const summary = useMemo(() => {
    const n = filtered.length;
    if (!n) return null;

    let sumToPar = 0;
    let sumStrokes = 0;
    let blowups = 0;

    for (const r of filtered) {
      const tp = getToPar(r);
      const st = getStrokes(r);
      if (tp != null) sumToPar += tp;
      if (st != null) sumStrokes += st;
      if (blowupFlag(r)) blowups += 1;
    }

    return {
      holes: n,
      avgToPar: sumToPar / n,
      avgStrokes: sumStrokes / n,
      blowupRate: blowups / n,
    };
  }, [filtered, blowupMode, scoreMode]);

  const byPar = useMemo(() => {
    const m = new Map<number, HoleRow[]>();
    for (const r of filtered) {
      const p = safeNum(r.par);
      if (p == null) continue;
      const key = Math.round(p);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }

    return Array.from(m.entries())
      .map(([par, rs]) => ({ par, ...computeDetail(rs) }))
      .sort((a, b) => a.par - b.par);
  }, [filtered, blowupMode, scoreMode]);

  // By length — now buckets per-par and label includes Par for clarity
  const byLength = useMemo(() => {
    const m = new Map<string, HoleRow[]>();

    for (const r of filtered) {
      const p = safeNum(r.par);
      const y = safeNum(r.yardage);
      if (p == null) continue;

      const bucket = lengthBucketByPar(p, y);
      if (bucket === "Other") continue;

      const key = `P${Math.round(p)} · ${bucket}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }

    const orderKeys = [
      // Par 3
      "P3 · <140",
      "P3 · 140–169",
      "P3 · 170–199",
      "P3 · 200+",
      // Par 4
      "P4 · <330",
      "P4 · 330–379",
      "P4 · 380–429",
      "P4 · 430–479",
      "P4 · 480+",
      // Par 5
      "P5 · <460",
      "P5 · 460–489",
      "P5 · 490–519",
      "P5 · 520–549",
      "P5 · 550+",
    ];

    return Array.from(m.entries())
      .map(([bucket, rs]) => ({ bucket, ...computeDetail(rs) }))
      .sort((a, b) => orderKeys.indexOf(a.bucket) - orderKeys.indexOf(b.bucket));
  }, [filtered, blowupMode, scoreMode]);

  const bySI = useMemo(() => {
    const m = new Map<string, HoleRow[]>();
    for (const r of filtered) {
      const b = siBucket(safeNum(r.stroke_index));
      if (!m.has(b)) m.set(b, []);
      m.get(b)!.push(r);
    }

    const order = ["01–03", "04–06", "07–09", "10–12", "13–15", "16–18", "Unknown"];

    return Array.from(m.entries())
      .map(([bucket, rs]) => ({ bucket, ...computeDetail(rs) }))
      .sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket));
  }, [filtered, blowupMode, scoreMode]);

  // Blow-up after previous hole (within same round)
  const blowupAfterPrev = useMemo(() => {
    const byRound = new Map<string, HoleRow[]>();
    for (const r of filtered) {
      if (!r.round_id) continue;
      if (!byRound.has(r.round_id)) byRound.set(r.round_id, []);
      byRound.get(r.round_id)!.push(r);
    }

    // Replace "after_par_or_better" with "after_birdie_or_better"
    type Ctx = "after_birdie_or_better" | "after_par" | "after_bogeyplus" | "after_doubleplus" | "unknown";
    const buckets: Record<Ctx, { attempts: number; blow: number }> = {
      after_birdie_or_better: { attempts: 0, blow: 0 },
      after_par: { attempts: 0, blow: 0 },
      after_bogeyplus: { attempts: 0, blow: 0 },
      after_doubleplus: { attempts: 0, blow: 0 },
      unknown: { attempts: 0, blow: 0 },
    };

    for (const rs of byRound.values()) {
      const sorted = rs.slice().sort((a, b) => {
        const ha = normalizeHoleNumberForNine(a.tee_name, safeNum(a.hole_number)) ?? 0;
        const hb = normalizeHoleNumberForNine(b.tee_name, safeNum(b.hole_number)) ?? 0;
        return ha - hb;
      });

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];

        let ctx: Ctx = "unknown";
        const prevToPar = getToPar(prev);

        if (prevToPar != null && prevToPar <= -1) ctx = "after_birdie_or_better";
        else if (prevToPar != null && prevToPar === 0) ctx = "after_par";
        else if (blowupFlag(prev)) ctx = "after_doubleplus";
        else if (prevToPar != null && prevToPar >= 1) ctx = "after_bogeyplus";

        buckets[ctx].attempts += 1;
        buckets[ctx].blow += blowupFlag(cur) ? 1 : 0;
      }
    }

    const order: Ctx[] = ["after_birdie_or_better", "after_par", "after_bogeyplus", "after_doubleplus", "unknown"];

    return order.map((k) => ({
      context: k,
      attempts: buckets[k].attempts,
      rate: buckets[k].attempts ? buckets[k].blow / buckets[k].attempts : 0,
    }));
  }, [filtered, blowupMode, scoreMode]);

  // Worst holes — weighted by attempts
  const worstHoles = useMemo(() => {
    const m = new Map<string, HoleRow[]>();

    for (const r of filtered) {
      const p = safeNum(r.par);
      const normHole = normalizeHoleNumberForNine(r.tee_name, safeNum(r.hole_number));
      if (p == null || normHole == null) continue;

      const teeNorm = normalizeTeeName(r.tee_name).base;
      const key = `${r.course_id ?? "?"}::${teeNorm}::${normHole}`;

      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }

    const out = Array.from(m.entries()).map(([key, rs]) => {
      const attempts = rs.length;

      const avgToPar = rs.reduce((a, r) => a + (getToPar(r) ?? 0), 0) / attempts;
      const blow = rs.reduce((a, r) => a + (blowupFlag(r) ? 1 : 0), 0) / attempts;

      const severity = Math.max(0, avgToPar) * Math.sqrt(attempts);

      const sample = rs[0];
      const teeNorm = normalizeTeeName(sample.tee_name).base;
      const holeNorm = normalizeHoleNumberForNine(sample.tee_name, safeNum(sample.hole_number));

      return {
        key,
        attempts,
        avgToPar,
        blow,
        severity,
        course: sample.course_name ?? sample.course_id ?? "Course",
        tee: teeNorm,
        hole: holeNorm ?? 0,
        par: Math.round(safeNum(sample.par) ?? 0),
        yardage: safeNum(sample.yardage),
        si: safeNum(sample.stroke_index),
      };
    });

    return out.sort((a, b) => b.severity - a.severity).slice(0, 8);
  }, [filtered, blowupMode, scoreMode]);

  const prettyCtx = (c: string) => {
    if (c === "after_birdie_or_better") return "After birdie or better";
    if (c === "after_par") return "After par";
    if (c === "after_bogeyplus") return "After bogey+";
    if (c === "after_doubleplus") return "After double+";
    return "Unknown";
  };

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

  function StatRow(props: {
    title: string;
    attempts: number;
    avgStrokes: number;
    avgToPar: number;
    blow: number;
    birdieOrBetter: number;
    parRate: number;
    bogey: number;
  }) {
    const { title, attempts, avgStrokes, avgToPar, blow, birdieOrBetter, parRate, bogey } = props;

    return (
      <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-emerald-50 truncate">{title}</div>
          </div>
          <div className="text-[11px] text-emerald-100/70 font-semibold shrink-0">attempts: {attempts}</div>
        </div>

        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div className="text-[11px] text-emerald-100/70 font-bold">Avg strokes</div>
            <div className="text-base sm:text-sm font-extrabold tabular-nums text-emerald-50">{round1(avgStrokes)}</div>
          </div>
          <div>
            <div className="text-[11px] text-emerald-100/70 font-bold">Avg to par</div>
            <div className="text-base sm:text-sm font-extrabold tabular-nums text-[#f5e6b0]">{round1(avgToPar)}</div>
          </div>
          <div>
            <div className="text-[11px] text-emerald-100/70 font-bold">{blowupMode === "double" ? "Double+" : "Triple+"}</div>
            <div className="text-base sm:text-sm font-extrabold tabular-nums text-emerald-50">{pct(blow)}</div>
          </div>
          <div>
            <div className="text-[11px] text-emerald-100/70 font-bold">Birdie+ / Par / Bogey</div>
            <div className="text-[12px] sm:text-[11px] font-extrabold tabular-nums text-emerald-50 whitespace-nowrap">
              {pct(birdieOrBetter)} / {pct(parRate)} / {pct(bogey)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -----------------------------
  // UI
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
                Hole scoring
              </div>
              <div className="text-[11px] sm:text-[10px] uppercase tracking-[0.14em] text-emerald-200/70 truncate">
                {presetLabel(preset)} · {scoreMode === "gross" ? "Gross" : "Net"} · By par · length · SI · blow-ups
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
                  <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">
                    Filters
                  </div>
                  <div className="mt-1 text-[12px] text-emerald-50/90 font-extrabold leading-tight">
                    {presetLabel(preset)}
                    {" · "}
                    {courseId ? courseOptions.find((c) => c.id === courseId)?.name ?? "Course" : "All courses"}
                    {" · "}
                    {teeBoxId ? teeOptions.find((t) => t.id === teeBoxId)?.name ?? "Tee" : "All tees"}
                  </div>
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

                      {/* Separate toggles: Net + Blow-up */}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (scoreMode === "net" && !netAvailable) return;
                            setScoreMode(scoreMode === "gross" ? "net" : "gross");
                          }}
                          className={[
                            "flex-1 rounded-xl border px-3 py-2 text-[13px] font-extrabold",
                            scoreMode === "gross"
                              ? "bg-[#042713]/70 border-[#f5e6b0]/30 text-emerald-50"
                              : "bg-[#042713]/70 border-[#f5e6b0]/60 text-[#f5e6b0]",
                          ].join(" ")}
                          title="Toggle gross vs net"
                        >
                          {scoreMode === "gross" ? "Gross" : "Net"}
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBlowupMode(blowupMode === "double" ? "triple" : "double");
                          }}
                          className={[
                            "flex-1 rounded-xl border px-3 py-2 text-[13px] font-extrabold",
                            "bg-[#042713]/70",
                            blowupMode === "double"
                              ? "border-[#f5e6b0]/30 text-emerald-50"
                              : "border-[#f5e6b0]/60 text-[#f5e6b0]",
                          ].join(" ")}
                          title="Toggle blow-up threshold"
                        >
                          {blowupMode === "double" ? "Double+" : "Triple+"}
                        </button>
                      </div>

                      <div className="mt-2 text-[12px] font-semibold text-emerald-100/80 leading-snug">
                        <span className="font-extrabold text-emerald-50">
                          {scoreMode === "gross" ? "Gross scoring" : "Net scoring"}
                        </span>
                        {" · "}
                        {blowupMode === "double" ? "Double+ means ≥ +2" : "Triple+ means ≥ +3"}
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
          ) : (
            <div className="space-y-4">
              {/* Summary */}
              {summary ? (
                <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Summary</div>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <div className="text-[11px] text-emerald-100/70 font-bold">Holes</div>
                      <div className="text-lg font-extrabold tabular-nums text-emerald-50">{summary.holes}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-emerald-100/70 font-bold">Avg to par</div>
                      <div className="text-lg font-extrabold tabular-nums text-[#f5e6b0]">{round1(summary.avgToPar)}</div>
                    </div>
                    <div className="sm:block hidden">
                      <div className="text-[11px] text-emerald-100/70 font-bold">
                        {blowupMode === "double" ? "Double+" : "Triple+"} rate
                      </div>
                      <div className="text-lg font-extrabold tabular-nums text-emerald-50">{pct(summary.blowupRate)}</div>
                    </div>
                  </div>

                  <div className="mt-2 sm:hidden">
                    <div className="text-[11px] text-emerald-100/70 font-bold">
                      {blowupMode === "double" ? "Double+" : "Triple+"} rate
                    </div>
                    <div className="text-lg font-extrabold tabular-nums text-emerald-50">{pct(summary.blowupRate)}</div>
                  </div>
                </div>
              ) : null}

              {/* By Par */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">
                  Avg scoring by Par
                </div>
                <div className="mt-1 text-[12px] text-emerald-100/70 font-semibold">
                  {scoreMode === "gross" ? "Gross scoring" : "Net scoring"}
                </div>

                <div className="mt-3 space-y-2">
                  {byPar.map((r) => (
                    <StatRow
                      key={r.par}
                      title={`Par ${r.par}`}
                      attempts={r.attempts}
                      avgStrokes={r.avgStrokes}
                      avgToPar={r.avgToPar}
                      blow={r.blow}
                      birdieOrBetter={r.birdieOrBetter}
                      parRate={r.parRate}
                      bogey={r.bogey}
                    />
                  ))}
                </div>
              </div>

              {/* By Length */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">
                  Avg scoring by Length (by par)
                </div>
                <div className="mt-1 text-[12px] text-emerald-100/70 font-semibold">
                  {scoreMode === "gross" ? "Gross scoring" : "Net scoring"}
                </div>

                <div className="mt-3 space-y-2">
                  {byLength.map((r) => (
                    <StatRow
                      key={r.bucket}
                      title={r.bucket}
                      attempts={r.attempts}
                      avgStrokes={r.avgStrokes}
                      avgToPar={r.avgToPar}
                      blow={r.blow}
                      birdieOrBetter={r.birdieOrBetter}
                      parRate={r.parRate}
                      bogey={r.bogey}
                    />
                  ))}
                </div>
              </div>

              {/* By SI */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">
                  Avg scoring by SI (stroke index)
                </div>
                <div className="mt-1 text-[12px] text-emerald-100/70 font-semibold">
                  {scoreMode === "gross" ? "Gross scoring" : "Net scoring"}
                </div>

                <div className="mt-3 space-y-2">
                  {bySI.map((r) => (
                    <StatRow
                      key={r.bucket}
                      title={`SI ${r.bucket}`}
                      attempts={r.attempts}
                      avgStrokes={r.avgStrokes}
                      avgToPar={r.avgToPar}
                      blow={r.blow}
                      birdieOrBetter={r.birdieOrBetter}
                      parRate={r.parRate}
                      bogey={r.bogey}
                    />
                  ))}
                </div>
              </div>

              {/* Blow-up patterns */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">
                  Blow-up patterns
                </div>
                <div className="text-[12px] text-emerald-100/70 font-semibold mt-1 leading-snug">
                  {blowupMode === "double" ? "Double+" : "Triple+"} rate on the next hole, grouped by the previous result
                  {" · "}
                  {scoreMode === "gross" ? "Gross" : "Net"}
                </div>

                <div className="mt-3 space-y-2">
                  {blowupAfterPrev.map((r) => (
                    <div key={r.context} className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-extrabold text-emerald-50">{prettyCtx(r.context)}</div>
                        <div className="text-[11px] text-emerald-100/70 font-semibold">attempts: {r.attempts}</div>
                      </div>
                      <div className="mt-2">
                        <div className="text-[11px] text-emerald-100/70 font-bold">Rate</div>
                        <div className="text-base font-extrabold tabular-nums text-[#f5e6b0]">{pct(r.rate)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Worst holes */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">
                  Worst holes
                </div>
                <div className="text-[12px] text-emerald-100/70 font-semibold leading-snug">
                  Ranked by sustained damage: <span className="font-extrabold text-emerald-50">avg to-par × √attempts</span>
                  {" · "}
                  {scoreMode === "gross" ? "Gross" : "Net"}
                </div>

                <div className="mt-3 space-y-2">
                  {worstHoles.map((h) => (
                    <div key={h.key} className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[14px] font-extrabold text-emerald-50 leading-tight break-words">
                            {h.course} · {h.tee} · Hole {h.hole}
                          </div>

                          <div className="mt-1 text-[12px] text-emerald-100/75 font-semibold leading-snug break-words">
                            <span className="whitespace-nowrap">Par {h.par}</span>
                            {" · "}
                            <span className="whitespace-nowrap">{h.yardage != null ? `${h.yardage}y` : "—"}</span>
                            {" · "}
                            <span className="whitespace-nowrap">SI {h.si ?? "—"}</span>
                            {" · "}
                            <span className="whitespace-nowrap">attempts: {h.attempts}</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="text-[11px] text-emerald-100/70 font-bold">Avg to par</div>
                          <div className="text-lg font-extrabold tabular-nums text-[#f5e6b0]">{round1(h.avgToPar)}</div>
                          <div className="text-[11px] text-emerald-100/70 font-bold">Weighted</div>
                          <div className="text-[13px] font-extrabold tabular-nums text-emerald-50">{round1(h.severity)}</div>
                          <div className="mt-1 text-[11px] text-emerald-100/70 font-bold">
                            {blowupMode === "double" ? "Double+" : "Triple+"}: {pct(h.blow)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-1 text-[10px] text-emerald-100/40 text-center font-semibold">CIAGA · Hole scoring</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
