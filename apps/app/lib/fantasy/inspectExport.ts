import ExcelJS from "exceljs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  ACTIVE_ENTRY_STATUSES,
  allowancePct,
  loadSimInputs,
  resolvePlayingHandicapDetails,
  simulateEvent,
  type EntryRow,
} from "@/lib/fantasy/odds";
import { hashSeed } from "@/lib/fantasy/simulation/rng";
import { holeMu, holeSigma } from "@/lib/fantasy/simulation/holeModel";
import { getMarketDefinition } from "@/lib/fantasy/markets/registry";
import { clampProbability, probabilityToDecimalOdds } from "@/lib/fantasy/simulation/types";
import type { FantasyMarket } from "@/lib/fantasy/markets/types";
import type { StoredFantasyProfile } from "@/lib/fantasy/profiles";

/**
 * Inspector Excel export — a full offline audit of one event's pricing. Mirrors
 * `inspectEvent` (re-runs the live-seed simulation so numbers match the board)
 * but retains the whole SimulationResult so it can document the raw per-hole
 * distributions, every market's selection → probability → odds derivation, and
 * every individual simulated iteration. Sandbox/admin-gated at the route.
 */

const GREEN_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF92D050" } };

/** How each market type turns sim output into a selection probability. */
const DERIVATION: Record<string, string> = {
  outright_winner: "Per-player winProb — share of iterations finishing 1st (round variant: recomputed from that round's joint totals).",
  top_n: "Per-player topNProb[n] — share of iterations finishing in position ≤ n.",
  finish_position: "positionHistogram[pos-1] — share of iterations finishing exactly that place.",
  finish_range: "Sum of positionHistogram across the range (Wooden Spoon = lastProb).",
  h2h: "Share of iterations where the side's basis total beats the other, plus half of the ties.",
  gross_ou: "Share of iterations with the player's gross total under the line (Over = 1 − Under).",
  net_ou: "Share of iterations with the player's net total under the line (Over = 1 − Under).",
  score_band: "Share of iterations with the gross total inside the band.",
  score_exact: "Share of iterations with the gross total equal to the value.",
  birdies: "Tail of the birdie-count distribution: P(birdies ≥ count).",
  eagle_count: "1 − Π(1 − per-hole eagle probability) across the player's holes (holes independent).",
  hole_score: "Per-hole outcome bins: birdie-or-better = k≤1, bogey-or-worse = k≥3, divided by sims.",
  field_special: "Empirical base-rate exposure (HIO/albatross) or 1 − Π(no eagle) across the whole field.",
};

const GUIDE: [string, string][] = [
  ["What this workbook is", "A complete audit of the Monte Carlo pricing for one event, re-run with the same seed that priced the live board — so every number here matches what players saw."],
  ["One refresh", "A single simulation run prices every market. Each market type reads the shared SimulationResult and counts outcomes into a probability; that probability is clamped and inverted into decimal odds."],
  ["Model paths", "Differential (WHS) path when the tee carries rating/slope AND the player has score differentials; otherwise the gross-average fallback path. The 'Model path' column on Player inputs shows which was used."],
  ["Handicap anchor", "Handicap is a PRIOR, not a driver: per-hole μ blends the player's own scoring toward a handicap-derived anchor, weighted by effective sample size (thin samples lean on the anchor)."],
  ["Per-hole μ / σ", "Each hole is a discretized normal over strokes-vs-par. μ combines observed shape + stroke-index tilt + form; σ comes from differential/round stddev, widened by a confidence factor and clamped per hole."],
  ["Rare-event calibration", "Birdie-or-better and eagle bins are scaled so the modelled birdies/eagles per round match the player's observed rates — the normal tail alone would overstate these."],
  ["Attendance", "Provisional (not-yet-entered) members are sampled present/absent each iteration by an attendance probability; only present players are ranked, so confirmed players' odds rise when a provisional is absent."],
  ["Ranking", "Each iteration ranks the field on the event's basis (gross / net / stableford) with standard '1224' competition ranking; ties split evenly. Positions are retained per iteration for correlated accumulators."],
  ["Odds conversion", "probability is clamped to [0.005, 0.995] then decimal odds = round(1 / p, 2), capped at 200.00 — see the Markets sheet for each selection's raw → clamped → odds."],
];

function percentiles(totals: Int16Array): Record<string, number> {
  const sorted = Array.from(totals).sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q))];
  return { p5: at(0.05), p25: at(0.25), p50: at(0.5), p75: at(0.75), p95: at(0.95) };
}

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: (string | number | null)[][]
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name);
  const head = ws.addRow(headers);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = GREEN_FILL;
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (rows.length > 0) ws.addRows(rows);
  ws.columns.forEach((col) => {
    col.width = Math.max(10, Math.min(40, (col.values ?? []).reduce((m: number, v) => Math.max(m, String(v ?? "").length + 2), 8)));
  });
  return ws;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export async function buildInspectWorkbook(
  eventId: string
): Promise<{ buffer: ExcelJS.Buffer; filename: string }> {
  const ctx = await loadSimInputs(eventId);

  const [stateRes, jobsRes, entriesRes, storedRes, marketsRes] = await Promise.all([
    supabaseAdmin.from("fantasy_event_state").select("*").eq("event_id", eventId).maybeSingle(),
    supabaseAdmin
      .from("fantasy_refresh_jobs")
      .select("status, reason, attempts, locked_at, last_error, created_at, updated_at")
      .eq("event_id", eventId)
      .order("updated_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("event_entries")
      .select("profile_id, entry_status, assigned_handicap_index, assigned_course_handicap, assigned_playing_handicap")
      .eq("event_id", eventId)
      .in("entry_status", ACTIVE_ENTRY_STATUSES),
    supabaseAdmin
      .from("fantasy_player_profiles")
      .select("*")
      .eq("group_id", ctx.groupId)
      .in("profile_id", ctx.players.map((p) => p.profileId)),
    supabaseAdmin.from("fantasy_markets").select("*").eq("event_id", eventId),
  ]);

  const state = (stateRes.data as { version?: number } | null) ?? null;
  const version = state?.version ?? 0;
  const entries = (entriesRes.data ?? []) as EntryRow[];
  const stored = (storedRes.data ?? []) as StoredFantasyProfile[];
  const storedByProfile = new Map(stored.map((r) => [r.profile_id, r]));

  const profileHi = new Map<string, number | null>();
  for (const r of stored) profileHi.set(r.profile_id, r.handicap_index);
  const phDetails = resolvePlayingHandicapDetails(ctx.event, entries, profileHi);

  const sim = simulateEvent(ctx, version);
  const seed = hashSeed(ctx.event.id, version);

  const teeHasRating = ctx.holes.some(
    (h) => h.rating != null && h.slope != null && h.slope > 0 && h.parTotal != null && (h.holesInRound ?? 0) >= 14
  );
  const repHole = ctx.holes[0];
  const holeLabel = (h: { round?: number | null; holeNumber: number }) =>
    `${(h.round ?? 1) > 1 ? `R${h.round} ` : ""}H${h.holeNumber}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Ciaga Fantasy Picks — Odds Inspector";
  wb.created = new Date();

  // 1. Guide
  addSheet(wb, "Guide", ["Topic", "Explanation"], GUIDE);

  // 2. Event & sim meta
  addSheet(wb, "Event & Sim", ["Field", "Value"], [
    ["Event", ctx.event.name],
    ["Event ID", ctx.event.id],
    ["Status", ctx.event.majors_status],
    ["Event date", ctx.event.event_date ?? ""],
    ["Rounds", ctx.event.num_rounds ?? 1],
    ["Scoring model", ctx.event.scoring_model ?? ""],
    ["Ranking basis", ctx.rankingBasis],
    ["Allowance %", allowancePct(ctx.event)],
    ["Odds version", version],
    ["Simulation count", sim.simulationCount],
    ["Seed", seed],
    ["Field size", ctx.players.length],
    ["Generated at", new Date().toISOString()],
  ]);

  // 3. Holes
  addSheet(
    wb,
    "Holes",
    ["Round", "Hole", "Par", "Stroke index", "Yardage", "Tee rating", "Tee slope"],
    ctx.holes.map((h) => [h.round ?? 1, h.holeNumber, h.par, h.strokeIndex, h.yardage ?? "", h.rating ?? "", h.slope ?? ""])
  );

  // 4. Player inputs
  addSheet(
    wb,
    "Player inputs",
    ["Player", "PH", "PH source", "Model path", "HI", "Avg diff", "σ diff", "Neff", "Diff sample",
     "Avg gross", "σ round", "Form", "Birdies/rd", "Eagles/rd", "Sample", "Confidence", "Built at"],
    ctx.players.map((p) => {
      const prof = storedByProfile.get(p.profileId);
      const modelPath = p.profile.avgDifferential != null && teeHasRating ? "differential" : "gross";
      return [
        p.displayName,
        p.playingHandicap,
        phDetails.get(p.profileId)?.source ?? "no_data",
        modelPath,
        prof?.handicap_index ?? "",
        prof?.avg_differential ?? "",
        prof?.differential_stddev ?? "",
        prof?.differential_effective_n ?? "",
        prof?.differential_sample_size ?? 0,
        prof?.avg_gross ?? "",
        prof?.score_stddev ?? "",
        prof?.recent_form ?? "",
        prof?.birdies_per_round ?? "",
        prof?.eagles_per_round ?? "",
        prof?.sample_size ?? 0,
        prof?.confidence ?? "",
        prof?.computed_at ?? "",
      ];
    })
  );

  // 5. Per-hole μ / σ
  addSheet(
    wb,
    "Per-hole mu-sigma",
    ["Player", "σ/hole", ...ctx.holes.map(holeLabel)],
    ctx.players.map((p) => [
      p.displayName,
      r3(holeSigma(p.profile, repHole)),
      ...ctx.holes.map((h) => r3(holeMu(p.profile, h, p.playingHandicap))),
    ])
  );

  // 6. Sim aggregates
  addSheet(
    wb,
    "Sim aggregates",
    ["Player", "Mean gross", "Mean net", "Win%", "Top3%", "Top5%", "Top10%", "Last%",
     "Gross p5", "p25", "p50", "p75", "p95", "Net p5", "p50", "p95"],
    ctx.players.map((p) => {
      const res = sim.players[sim.playerIndex[p.profileId]];
      const g = percentiles(res.grossTotals);
      const n = percentiles(res.netTotals);
      return [
        p.displayName, r3(res.meanGross), r3(res.meanNet),
        r3(res.winProb), r3(res.topNProb[3] ?? 0), r3(res.topNProb[5] ?? 0), r3(res.topNProb[10] ?? 0), r3(res.lastProb),
        g.p5, g.p25, g.p50, g.p75, g.p95, n.p5, n.p50, n.p95,
      ];
    })
  );

  // 7a. Position distribution
  const maxPos = sim.players.reduce((m, r) => Math.max(m, r.positionHistogram.length), 0);
  addSheet(
    wb,
    "Position dist",
    ["Player", ...Array.from({ length: maxPos }, (_, i) => `Pos ${i + 1}`)],
    ctx.players.map((p) => {
      const res = sim.players[sim.playerIndex[p.profileId]];
      return [p.displayName, ...Array.from({ length: maxPos }, (_, i) => r3(res.positionHistogram[i] ?? 0))];
    })
  );

  // 7b. Birdie-count distribution (probabilities)
  const maxBirdies = sim.players.reduce((m, r) => Math.max(m, r.birdieHistogram.length), 0);
  addSheet(
    wb,
    "Birdie dist",
    ["Player", ...Array.from({ length: maxBirdies }, (_, i) => `${i} brd`)],
    ctx.players.map((p) => {
      const res = sim.players[sim.playerIndex[p.profileId]];
      return [
        p.displayName,
        ...Array.from({ length: maxBirdies }, (_, i) => r3((res.birdieHistogram[i] ?? 0) / sim.simulationCount)),
      ];
    })
  );

  // 7c. Per-hole outcome bins (probabilities). k → strokes = par + (k-2).
  const binLabel = (k: number) => {
    if (k === 0) return "≤par-2";
    const d = k - 2;
    if (d === 0) return "par";
    return `par${d > 0 ? "+" : ""}${d}`;
  };
  const maxBins = sim.players.reduce(
    (m, r) => Math.max(m, r.holeOutcomes.reduce((mm, bins) => Math.max(mm, bins.length), 0)),
    0
  );
  const holeOutcomeRows: (string | number)[][] = [];
  for (const p of ctx.players) {
    const res = sim.players[sim.playerIndex[p.profileId]];
    sim.holes.forEach((h, hi) => {
      const bins = res.holeOutcomes[hi] ?? [];
      holeOutcomeRows.push([
        p.displayName,
        holeLabel(h),
        h.par,
        ...Array.from({ length: maxBins }, (_, k) => r3((bins[k] ?? 0) / sim.simulationCount)),
      ]);
    });
  }
  addSheet(
    wb,
    "Hole outcomes",
    ["Player", "Hole", "Par", ...Array.from({ length: maxBins }, (_, k) => binLabel(k))],
    holeOutcomeRows
  );

  // 8. Markets derivation
  const markets = (marketsRes.data ?? []) as FantasyMarket[];
  const marketRows: (string | number)[][] = [];
  for (const m of markets) {
    const def = getMarketDefinition(m.market_type);
    if (!def) continue;
    const probs = def.simulate(sim, m);
    const entriesArr = [...probs.entries()].sort((a, b) => b[1] - a[1]);
    for (const [key, raw] of entriesArr) {
      const clamped = clampProbability(raw);
      marketRows.push([
        def.displayName(m, ctx.names),
        m.market_type,
        JSON.stringify(m.params ?? {}),
        def.selectionLabel(m, key, ctx.names),
        r3(raw),
        r3(clamped),
        probabilityToDecimalOdds(raw),
        DERIVATION[m.market_type] ?? "",
      ]);
    }
  }
  addSheet(
    wb,
    "Markets",
    ["Market", "Type", "Params", "Selection", "Raw prob", "Clamped prob", "Decimal odds", "How it's derived"],
    marketRows
  );

  // 9. Raw per-iteration samples — gross, net, finishing position per player.
  const playerNames = ctx.players.map((p) => p.displayName);
  const grossRows: number[][] = [];
  const netRows: number[][] = [];
  const posRows: number[][] = [];
  const n = sim.simulationCount;
  const positions = sim.positions;
  for (let iter = 0; iter < n; iter++) {
    const g: number[] = [iter + 1];
    const nt: number[] = [iter + 1];
    const ps: number[] = [iter + 1];
    for (const p of ctx.players) {
      const idx = sim.playerIndex[p.profileId];
      const res = sim.players[idx];
      g.push(res.grossTotals[iter]);
      nt.push(res.netTotals[iter]);
      ps.push(positions ? positions[idx * n + iter] : 0);
    }
    grossRows.push(g);
    netRows.push(nt);
    posRows.push(ps);
  }
  addSheet(wb, "Raw gross", ["Iteration", ...playerNames], grossRows);
  addSheet(wb, "Raw net", ["Iteration", ...playerNames], netRows);
  addSheet(wb, "Raw positions", ["Iteration", ...playerNames], posRows);

  // 10. Refresh jobs
  addSheet(
    wb,
    "Refresh jobs",
    ["Status", "Reason", "Attempts", "Updated", "Error"],
    ((jobsRes.data ?? []) as {
      status: string; reason: string; attempts: number; updated_at: string; last_error: string | null;
    }[]).map((j) => [j.status, j.reason, j.attempts, j.updated_at, j.last_error ?? ""])
  );

  const slug = ctx.event.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "event";
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, filename: `fantasy-inspect-${slug}-v${version}.xlsx` };
}
