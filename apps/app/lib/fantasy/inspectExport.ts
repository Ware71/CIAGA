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
import {
  BIRDIE_PRIOR_STRENGTH,
  EAGLE_PRIOR_STRENGTH,
  buildHoleDistributionsDetailed,
  holeMu,
  holeSigmaDetailed,
  OUTCOME_OFFSET,
} from "@/lib/fantasy/simulation/holeModel";
import { DIFFERENTIAL_HALFLIFE_ROUNDS } from "@/lib/fantasy/simulation/differentials";
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
  outright_winner: "Event-wide: per-player winProb — share of iterations finishing 1st, ties SPLIT evenly (settlement reads the tie-resolved leaderboard). Round variant: recomputed from that round's joint totals with ties at FULL credit (round winners settle 'ties all win').",
  top_n: "Per-player topNProb[n] — share of iterations finishing in position ≤ n (ties count in full).",
  finish_position: "positionHistogram[pos-1] — share of iterations finishing exactly that place under 1224 competition ranking (every tied player carries the tied position in full).",
  finish_range: "Sum of positionHistogram across the range (Wooden Spoon = lastProb).",
  h2h: "1-X-2 match odds: P(a) / P(draw) / P(b) from the joint totals — every unique pairing, both bases. Draw is a real, backable outcome (not a void).",
  score_band: "Share of iterations with the gross/net total inside the band.",
  score_total: "Per score value: share of iterations under / equal to / over that value (gross or net total).",
  birdies: "Tail of the birdie-count distribution: P(birdies ≥ count).",
  eagle_count: "Tail of the eagle-count distribution (per-hole eagle-bin convolution): P(eagles ≥ count).",
  hole_score: "Per-hole outcome bins: birdie-or-better = k≤1, bogey-or-worse = k≥3, divided by sims.",
  field_special: "Empirical base-rate exposure (HIO/albatross) or 1 − Π(no eagle) across the whole field.",
};

const GUIDE: [string, string][] = [
  ["What this workbook is", "A complete audit of the Monte Carlo pricing for one event, re-run with the same seed that priced the live board — so every number here matches what players saw."],
  ["One refresh", "A single simulation run prices every market. Each market type reads the shared SimulationResult and counts outcomes into a probability; that probability is clamped and inverted into decimal odds."],
  ["Model paths", "Differential (WHS) path when the tee carries rating/slope AND the player has score differentials; otherwise the gross-average fallback path. The 'Model path' column on Player inputs shows which was used."],
  ["Handicap anchor", "Handicap is a PRIOR, not a driver: per-hole μ blends the player's own scoring toward a handicap-derived anchor, weighted by effective sample size (thin samples lean on the anchor)."],
  ["Per-hole μ / σ", "Each hole is a discretized normal over strokes-vs-par. μ (latent) combines observed shape + stroke-index tilt + form; σ comes from differential/round stddev, widened by a confidence factor and clamped per hole. The sim draws from the DISCRETIZED + CALIBRATED bins, whose expected score E is shown alongside μ — a mean-preservation loop keeps E ≈ μ, so Σ(E)+par reconciles with the simulated mean gross."],
  ["Rare-event calibration", "Birdie-or-better mass is calibrated EXACTLY to a Bayesian target: the observed rate over the shape sample, shrunk toward a handicap-based prior (Gamma-Poisson, prior strength in rounds — see Assumptions). Eagle mass is then set WITHIN the birdie mass. The Calibration sheet reconciles observed → prior → target → simulated."],
  ["Attendance", "Provisional (not-yet-entered) members are sampled present/absent each iteration by an attendance probability; only present players are ranked, so confirmed players' odds rise when a provisional is absent."],
  ["Ranking", "Each iteration ranks the field on the event's basis (gross / net / stableford) with standard '1224' competition ranking. Two first-place quantities exist: Win% splits ties evenly (prices the outright, which settles on the tie-resolved leaderboard); P(1st incl ties) counts every tied leader in full (prices finish-position, which settles on the shared position). Positions are retained per iteration for correlated accumulators."],
  ["Cell legend", "'—' = value missing from the profile (the model then uses the documented fallback for that field — never a hidden numeric default). Numbers are calculated values; the Error column on Refresh jobs is the job's stored error text."],
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

  // Full-round calibrated model per player, shared across the audit sheets.
  // (The live sim builds only each player's REMAINING holes; for in-play
  // events this block is the prospective full-round model.)
  const dash = "—";
  const detailedByProfile = new Map(
    ctx.players.map((p) => [
      p.profileId,
      buildHoleDistributionsDetailed(p.profile, ctx.holes, p.playingHandicap),
    ])
  );
  const sigmaByProfile = new Map(
    ctx.players.map((p) => [p.profileId, holeSigmaDetailed(p.profile, repHole)])
  );
  const distMean = (d: number[]) => d.reduce((s, prob, k) => s + (k - OUTCOME_OFFSET) * prob, 0);
  const parTotal = ctx.holes.reduce((s, h) => s + h.par, 0);
  const stddevOf = (totals: Int16Array): number => {
    let sum = 0;
    for (let i = 0; i < totals.length; i++) sum += totals[i];
    const m = sum / totals.length;
    let acc = 0;
    for (let i = 0; i < totals.length; i++) acc += (totals[i] - m) * (totals[i] - m);
    return Math.sqrt(acc / Math.max(1, totals.length - 1));
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "Ciaga Fantasy Picks — Odds Inspector";
  wb.created = new Date();

  // 1. Guide
  addSheet(wb, "Guide", ["Topic", "Explanation"], GUIDE);

  // 1b. Assumptions — every model constant the audit relies on.
  addSheet(wb, "Assumptions", ["Constant", "Value", "Why"], [
    ["Handicap anchor", "PH + 4 over par", "Net-consistency prior for thin data: no-signal players net ≈ par + 4 whatever their handicap (4 ≈ typical amateur gap between average and best-8 rounds)."],
    ["Anchor full-sample", "10 rounds (gross) / 12 effective (differential)", "Sample size at which observed history fully overrides the anchor."],
    ["Differential half-life", `${DIFFERENTIAL_HALFLIFE_ROUNDS} rounds`, "Recency weighting of the FULL differential history; effective N asymptotes ≈ 57.7 however long the history — that is the 'cap' Neff shows, by construction, not truncation."],
    ["Shape sample cap", "20 rounds (30 candidates)", "Per-hole shape, birdie/eagle rates and form come from the most recent ≤20 rounds — freshness cap on SHAPE only; ability (differentials) is uncapped."],
    ["Birdie prior", "λ0 = clamp(2.2·e^(−0.115·HI), 0.03, 3.0), K = " + BIRDIE_PRIOR_STRENGTH, "Gamma-Poisson shrinkage of the observed birdies/round toward published amateur rates (scratch ≈ 2.2, HI 10 ≈ 0.70, HI 20 ≈ 0.22); K in rounds — 20 observed rounds get 71% data weight."],
    ["Eagle prior", "λ0 = clamp(0.06·e^(−0.18·HI), 0.001, 0.15), K = " + EAGLE_PRIOR_STRENGTH, "Eagles ≈ 1 per 15–25 rounds even for scratch; heavy shrinkage because the event is rare. Eagle target never exceeds the birdie target."],
    ["Calibration exactness", "Σ P(birdie) = target, per hole sums = 1", "Single global factor on the birdie bins, non-birdie bins rescaled per hole — no clipping toward the raw normal tail (the old [0.5,2] clip floor bound for whole fields)."],
    ["Mean preservation", "≤ 6 fixed-point passes, tol 0.01 strokes/hole", "Calibration alone would shift the expected score; the latent means are re-targeted so the post-calibration E[score] still equals holeMu (the differential level already includes real birdies)."],
    ["Per-hole σ clamp", "[0.5, 2.6]", "Round σ ≈ 2.1–11; flagged on the Sim aggregates sheet when it binds."],
    ["Confidence σ widening", "high ×1.0 / medium ×1.1 / low ×1.3", "Thin profiles simulate wider."],
    ["Probability clamp", "[0.005, 0.995] → odds ≤ 200", "Book protection on every priced selection."],
    ["Simulation count", "10,000 (5,000 for fields > 60)", "Seeded per event version — re-runs reproduce the board exactly."],
  ]);

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

  // 4. Player inputs — '—' marks a MISSING profile value (see Guide legend);
  // the "σ source" / "Form status" columns say which fallback then applies.
  addSheet(
    wb,
    "Player inputs",
    ["Player", "PH", "PH source", "Model path", "σ source", "HI", "Avg diff", "σ diff", "Neff", "Diff sample",
     "Avg gross", "σ round", "Form", "Form status", "Birdies/rd", "Eagles/rd", "Sample", "Confidence", "Built at"],
    ctx.players.map((p) => {
      const prof = storedByProfile.get(p.profileId);
      const modelPath = p.profile.avgDifferential != null && teeHasRating ? "differential" : "gross";
      return [
        p.displayName,
        p.playingHandicap,
        phDetails.get(p.profileId)?.source ?? "no_data",
        modelPath,
        sigmaByProfile.get(p.profileId)?.source ?? dash,
        prof?.handicap_index ?? dash,
        prof?.avg_differential ?? dash,
        prof?.differential_stddev ?? dash,
        prof?.differential_effective_n ?? dash,
        prof?.differential_sample_size ?? 0,
        prof?.avg_gross ?? dash,
        prof?.score_stddev ?? dash,
        prof?.recent_form ?? dash,
        prof?.recent_form != null ? "observed" : "missing → 0 drift",
        prof?.birdies_per_round ?? dash,
        prof?.eagles_per_round ?? dash,
        prof?.sample_size ?? 0,
        prof?.confidence ?? dash,
        prof?.computed_at ?? dash,
      ];
    })
  );

  // 4b. Calibration — observed → prior → target → simulated, per player.
  addSheet(
    wb,
    "Calibration",
    ["Player", "Obs brd/rd", "n rounds", "Prior mean", "Prior K", "Target λ* (shrunk)",
     "Model mass (pre-cal)", "Mass after cal", "Factor", "Factor capped?",
     "Sim E[birdies]", "Obs eag/rd", "Eagle prior", "Eagle target", "Eagle mass post", "Eagle capped?",
     "Mean residual (strokes/hole)", "Passes"],
    ctx.players.map((p) => {
      const meta = detailedByProfile.get(p.profileId)!.meta;
      const res = sim.players[sim.playerIndex[p.profileId]];
      const simBirdies =
        res.birdieHistogram.reduce((s, count, i) => s + i * count, 0) / sim.simulationCount;
      return [
        p.displayName,
        meta.birdie.observedRate ?? dash,
        meta.birdie.sampleRounds,
        r3(meta.birdie.priorMean),
        meta.birdie.priorStrength,
        r3(meta.birdie.targetRate),
        r3(meta.birdie.preMass),
        r3(meta.birdie.postMass),
        r3(meta.birdie.factor),
        meta.birdie.capped ? "YES" : "no",
        r3(simBirdies),
        meta.eagle.observedRate ?? dash,
        r3(meta.eagle.priorMean),
        r3(meta.eagle.targetRate),
        r3(meta.eagle.postMass),
        meta.eagle.capped ? "YES" : "no",
        r3(meta.meanResidual),
        meta.iterations,
      ];
    })
  );

  // 5. Per-hole μ / σ — one row pair per player: the latent normal mean and
  // the expected score of the discretized+calibrated bins the sim draws from.
  // Reconciliation: Σ E + par ≈ sim mean gross (exact up to completed-hole
  // fixing and MC noise); |Σ E − Σ μ| ≤ mean residual × holes.
  const perHoleRows: (string | number)[][] = [];
  for (const p of ctx.players) {
    const detail = detailedByProfile.get(p.profileId)!;
    const sig = sigmaByProfile.get(p.profileId)!;
    const res = sim.players[sim.playerIndex[p.profileId]];
    const mus = ctx.holes.map((h) => holeMu(p.profile, h, p.playingHandicap));
    const es = detail.dists.map(distMean);
    const muSum = mus.reduce((s, m) => s + m, 0);
    const eSum = es.reduce((s, m) => s + m, 0);
    perHoleRows.push([
      p.displayName, "μ (latent)", r3(sig.sigma), r3(muSum + parTotal), r3(res.meanGross),
      ...mus.map(r3),
    ]);
    perHoleRows.push([
      p.displayName, "E (calibrated)", sig.clamped ? "σ clamped" : "", r3(eSum + parTotal), r3(res.meanGross),
      ...es.map(r3),
    ]);
  }
  addSheet(
    wb,
    "Per-hole mu-sigma",
    ["Player", "Row", "σ/hole", "Σ + par", "Sim mean gross", ...ctx.holes.map(holeLabel)],
    perHoleRows
  );

  // 6. Sim aggregates. Win% splits ties; P1st counts shared firsts in full —
  // both are correct, for different markets (see Guide → Ranking). σ target is
  // the round-level sigma the model wants; σ implied is what the per-hole
  // clamp actually allows (× √18); Sim gross SD is what the draws produced
  // (multi-round events scale ≈ √rounds above the per-round figure).
  addSheet(
    wb,
    "Sim aggregates",
    ["Player", "Mean gross", "Mean net", "Win% (ties split)", "P1st incl ties", "Top3%", "Top5%", "Top10%", "Last%",
     "σ round target", "σ round implied", "σ clamped?", "Sim gross SD",
     "Gross p5", "p25", "p50", "p75", "p95", "Net p5", "p50", "p95"],
    ctx.players.map((p) => {
      const res = sim.players[sim.playerIndex[p.profileId]];
      const sig = sigmaByProfile.get(p.profileId)!;
      const g = percentiles(res.grossTotals);
      const n = percentiles(res.netTotals);
      return [
        p.displayName, r3(res.meanGross), r3(res.meanNet),
        r3(res.winProb), r3(res.positionHistogram[0] ?? 0),
        r3(res.topNProb[3] ?? 0), r3(res.topNProb[5] ?? 0), r3(res.topNProb[10] ?? 0), r3(res.lastProb),
        r3(sig.sigmaRound), r3(sig.sigma * Math.sqrt(18)), sig.clamped ? "YES" : "no", r3(stddevOf(res.grossTotals)),
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
    }[]).map((j) => [j.status, j.reason, j.attempts, j.updated_at, j.last_error ?? dash])
  );

  const slug = ctx.event.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "event";
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, filename: `fantasy-inspect-${slug}-v${version}.xlsx` };
}
