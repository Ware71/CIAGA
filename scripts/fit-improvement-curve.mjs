// scripts/fit-improvement-curve.mjs
//
// READ-ONLY. Fits the population improvement curve used by the projection
// engine (apps/app/lib/stats/projection/improvement.ts).
//
// measure-improvement.mjs established the shape: a player's own recent slope
// barely persists (coefficient 0.13 over 20 rounds), but scoring level falls
// substantially as a function of WHERE they are and HOW MANY rounds they have
// played. This fits that relationship.
//
// Model, per round:
//
//     dL/dround  =  -a · max(0, L - F) · exp(-n / N0)
//
//   L  current scoring level (recency-weighted mean differential)
//   F  population floor — the level below which improvement stops
//   n  rounds played so far
//   a  improvement rate per stroke of headroom, for a brand-new player
//   N0 experience scale: how quickly improvement slows as rounds accumulate
//
// Fitted against observed change in level over a 20-round window, by grid
// search then local refinement. Prints the parameters, the residual spread
// (which becomes the model's per-path uncertainty) and a bootstrap on the
// parameters (which becomes the spread of the per-path floor).
//
// Usage:  node scripts/fit-improvement-curve.mjs
// Env:    apps/app/.env.local

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = 1000;
const W = 20; // observation window, in rounds

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv(join(here, "..", "apps", "app", ".env.local"));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
console.log("Target:", env.NEXT_PUBLIC_SUPABASE_URL, "\n");

const rows = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from("ciaga_scoring_record_stream")
    .select("profile_id, played_at, differential")
    .not("differential", "is", null)
    .order("played_at", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw error;
  rows.push(...(data ?? []));
  if (!data || data.length < PAGE) break;
}

const byProfile = new Map();
for (const r of rows) {
  if (!byProfile.has(r.profile_id)) byProfile.set(r.profile_id, []);
  byProfile.get(r.profile_id).push(Number(r.differential));
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/** Observations: { L, n, dPerRound, profile } */
const obs = [];
let pi = 0;
for (const [, vals] of byProfile) {
  pi++;
  for (let i = W; i + W <= vals.length; i++) {
    const L = mean(vals.slice(i - W, i));
    const next = mean(vals.slice(i, i + W));
    obs.push({ L, n: i, dPerRound: (next - L) / W, profile: pi });
  }
}
console.log(`${obs.length} observations from ${byProfile.size} profiles`);
console.log(`level range: ${Math.min(...obs.map((o) => o.L)).toFixed(1)} – ${Math.max(...obs.map((o) => o.L)).toFixed(1)}`);
console.log(`rounds range: ${Math.min(...obs.map((o) => o.n))} – ${Math.max(...obs.map((o) => o.n))}\n`);

// --- fit -------------------------------------------------------------------

function sse(a, F, N0, sample = obs) {
  let s = 0;
  for (const o of sample) {
    const pred = -a * Math.max(0, o.L - F) * Math.exp(-o.n / N0);
    const e = o.dPerRound - pred;
    s += e * e;
  }
  return s;
}

function fit(sample = obs) {
  let best = { a: 0, F: 0, N0: 100, sse: Infinity };
  for (let a = 0.001; a <= 0.06; a += 0.001) {
    for (let F = -2; F <= 14; F += 0.5) {
      for (let N0 = 20; N0 <= 600; N0 += 20) {
        const s = sse(a, F, N0, sample);
        if (s < best.sse) best = { a, F, N0, sse: s };
      }
    }
  }
  // local refinement
  for (let iter = 0; iter < 200; iter++) {
    const step = { a: 0.0002, F: 0.1, N0: 5 };
    let improved = false;
    for (const k of ["a", "F", "N0"]) {
      for (const dir of [1, -1]) {
        const cand = { ...best, [k]: best[k] + dir * step[k] };
        if (cand.a <= 0 || cand.N0 <= 1) continue;
        const s = sse(cand.a, cand.F, cand.N0, sample);
        if (s < best.sse) { best = { ...cand, sse: s }; improved = true; }
      }
    }
    if (!improved) break;
  }
  return best;
}

const f = fit();
const resid = obs.map((o) => o.dPerRound - -f.a * Math.max(0, o.L - f.F) * Math.exp(-o.n / f.N0));
const rmse = Math.sqrt(mean(resid.map((e) => e * e)));

// Null model: constant improvement rate.
const constRate = mean(obs.map((o) => o.dPerRound));
const nullRmse = Math.sqrt(mean(obs.map((o) => (o.dPerRound - constRate) ** 2)));

console.log("=== FITTED CURVE ===");
console.log(`  dL/dround = -${f.a.toFixed(4)} × max(0, L - ${f.F.toFixed(2)}) × exp(-n / ${f.N0.toFixed(0)})`);
console.log(`  a  (rate per stroke of headroom) : ${f.a.toFixed(4)}`);
console.log(`  F  (population floor)            : ${f.F.toFixed(2)}`);
console.log(`  N0 (experience scale, rounds)    : ${f.N0.toFixed(0)}`);
console.log(`  residual RMSE : ${rmse.toFixed(4)} per round`);
console.log(`  null  RMSE    : ${nullRmse.toFixed(4)} (constant rate)`);
console.log(`  variance explained vs null: ${(100 * (1 - (rmse / nullRmse) ** 2)).toFixed(1)}%`);

// --- leave-one-profile-out: does this generalise across players? -----------

console.log("\n=== LEAVE-ONE-PROFILE-OUT ===");
const profiles = [...new Set(obs.map((o) => o.profile))];
for (const p of profiles) {
  const train = obs.filter((o) => o.profile !== p);
  const test = obs.filter((o) => o.profile === p);
  if (train.length < 30 || test.length < 10) continue;
  const ff = fit(train);
  const te = test.map((o) => o.dPerRound - -ff.a * Math.max(0, o.L - ff.F) * Math.exp(-o.n / ff.N0));
  const teRmse = Math.sqrt(mean(te.map((e) => e * e)));
  const teNull = Math.sqrt(mean(test.map((o) => (o.dPerRound - constRate) ** 2)));
  console.log(
    `  held out profile ${p} (n=${test.length}): fit RMSE ${teRmse.toFixed(4)} vs null ${teNull.toFixed(4)}` +
      `  ${teRmse < teNull ? "BETTER" : "WORSE"}`
  );
}

// --- bootstrap the parameters (by profile, to respect clustering) ----------

console.log("\n=== BOOTSTRAP (resampling profiles) ===");
const boots = [];
for (let b = 0; b < 40; b++) {
  const picked = profiles.map(() => profiles[Math.floor(Math.random() * profiles.length)]);
  const sample = picked.flatMap((p) => obs.filter((o) => o.profile === p));
  if (sample.length < 40) continue;
  boots.push(fit(sample));
}
const pct = (arr, q) => arr.slice().sort((x, y) => x - y)[Math.floor(q * (arr.length - 1))];
for (const k of ["a", "F", "N0"]) {
  const v = boots.map((x) => x[k]);
  console.log(`  ${k}: p10=${pct(v, 0.1).toFixed(3)}  p50=${pct(v, 0.5).toFixed(3)}  p90=${pct(v, 0.9).toFixed(3)}`);
}

// --- what it implies -------------------------------------------------------

console.log("\n=== IMPLIED TRAJECTORIES (rounds to reach a level) ===");
for (const [L0, n0] of [[25, 20], [18, 40], [12, 100], [8, 200]]) {
  let L = L0;
  let n = n0;
  const marks = [];
  for (let r = 1; r <= 1000; r++) {
    L += -f.a * Math.max(0, L - f.F) * Math.exp(-n / f.N0);
    n++;
    for (const t of [15, 10, 5, 2, 0]) {
      if (L <= t && !marks.some((m) => m.t === t)) marks.push({ t, r });
    }
  }
  const s = marks.map((m) => `${m.t}→${m.r}r`).join("  ");
  console.log(`  from level ${L0} at ${n0} rounds: ${s || "(no further milestones)"}  [settles ≈ ${L.toFixed(1)}]`);
}
