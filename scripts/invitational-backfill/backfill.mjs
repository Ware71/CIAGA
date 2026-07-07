// scripts/invitational-backfill/backfill.mjs
//
// One-off backfill of "The Invitational 2026" (CIAGA MAJORS, played 2026-06-07)
// on PRODUCTION. Replays paper scores through the real scoring pipeline so the
// end state is exactly "everyone just finished, leaderboard frozen, awaiting reveal".
//
// Usage:
//   node scripts/invitational-backfill/backfill.mjs preview   (read-only sanity check of scores.json)
//   node scripts/invitational-backfill/backfill.mjs reset     (wipe stale state, reopen rounds)
//   node scripts/invitational-backfill/backfill.mjs replay    (insert 108 score events hole-by-hole)
//   node scripts/invitational-backfill/backfill.mjs finish    (finish rounds, submissions, event completed)
//   node scripts/invitational-backfill/backfill.mjs refresh   (ciaga_refresh_handicaps_from 2026-06-07)
//   node scripts/invitational-backfill/backfill.mjs verify    (read-only final state report)
//
// Scores come from scores.json next to this file:
//   { "Jack Wilson": [5,4,...18 ints...], "Harper": [...], ... }
//
// All facts below were captured from prod by inspect.mjs on 2026-06-10.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// ── Fixed production identifiers (from inspect.mjs) ─────────────────────────

const EVENT_ID = "f9aaa51e-24f0-4b0c-83c4-467993b9ac33";
const EVENT_ROUND_ID = "3a64051c-f90b-4e6c-b4b8-110520ba2284";
const ENTERED_BY = "c6cf1d65-516c-46ca-8800-4914a0c0531b"; // Ware (admin, scorer of record)
const FREEZE_THRESHOLD = 12; // num_rounds(1) * 18 - leaderboard_freeze_last_holes(6)

// Hole pars / stroke indexes (Blythe/Somers - Yellow), for preview NDB estimates
const PARS = [5, 4, 3, 4, 4, 3, 4, 3, 4, 4, 4, 5, 3, 5, 5, 5, 3, 4];
const SIS = [17, 11, 9, 7, 13, 3, 5, 15, 1, 4, 8, 14, 12, 2, 10, 6, 18, 16];

const ROUNDS = [
  {
    id: "64ba1760-8bcc-4b42-850d-dcafe9b03ecf",
    label: "Tee time 14:08",
    teeTime: "2026-06-07T14:08:00Z",
    players: [
      { name: "Jack Wilson", participantId: "d0b407c5-199a-43b6-b8bb-08356b934b1e", profileId: "195e5884-79b7-4fec-8823-20ada9f6c946", courseHcp: 7,  playingHcp: 7  },
      { name: "Harper",      participantId: "4802f3f5-c76f-4760-bdbe-a710fe61f274", profileId: "34cd70b1-9523-46d1-bb90-f553469a998b", courseHcp: 51, playingHcp: 48 },
      { name: "Ciaran",      participantId: "91a32442-5d12-4e3f-b43f-ea7c3e3e8fce", profileId: "32013806-c774-413c-816b-5483124f4848", courseHcp: 48, playingHcp: 46 },
    ],
  },
  {
    id: "2c36fdd8-8225-4a45-ab86-71d69421d9f6",
    label: "Tee time 14:16",
    teeTime: "2026-06-07T14:16:00Z",
    players: [
      { name: "Ware",    participantId: "ba8cd6ed-ceca-4cb3-8501-1e7e5a0372ac", profileId: "c6cf1d65-516c-46ca-8800-4914a0c0531b", courseHcp: 23, playingHcp: 22 },
      { name: "Linehan", participantId: "4f8cfda2-d6e1-4684-af2a-32924708f5ad", profileId: "00dc22e9-8020-4aed-ab97-8e4cf6d3fc53", courseHcp: 33, playingHcp: 31 },
      { name: "Liaga",   participantId: "9830606e-38cc-49f2-9c3c-d16f85cabea3", profileId: "c693a1a8-7827-4af0-b303-c33d99f97076", courseHcp: 58, playingHcp: 55 },
    ],
  },
];
const ROUND_IDS = ROUNDS.map((r) => r.id);
const ALL_PLAYERS = ROUNDS.flatMap((r) => r.players);

// Backdated timing: hole h scored at teeTime + 12min + 13min*(h-1), +25s per player slot.
// Round finished_at = hole-18 wave + 4 min.
function holeTime(round, holeNumber, playerIdx) {
  const t = new Date(round.teeTime).getTime();
  return new Date(t + (12 + 13 * (holeNumber - 1)) * 60_000 + playerIdx * 25_000);
}
function roundFinishTime(round) {
  return new Date(holeTime(round, 18, 2).getTime() + 4 * 60_000);
}

// ── Env / client ─────────────────────────────────────────────────────────────

function loadEnv() {
  const raw = readFileSync(join(here, ".env.prod"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
const env = loadEnv();
const db = createClient(env.PROD_SUPABASE_URL, env.PROD_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function fail(msg) {
  console.error("ABORT: " + msg);
  process.exit(1);
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) fail(`${label}: ${error.message} (code=${error.code ?? "?"})`);
  return data;
}

// ── Scores ───────────────────────────────────────────────────────────────────

function loadScores() {
  let raw;
  try {
    raw = readFileSync(join(here, "scores.json"), "utf8");
  } catch {
    fail("scores.json not found next to backfill.mjs — create it first (see file header).");
  }
  const scores = JSON.parse(raw);
  for (const p of ALL_PLAYERS) {
    const arr = scores[p.name];
    if (!Array.isArray(arr) || arr.length !== 18) fail(`scores.json: "${p.name}" must be an array of 18 gross scores`);
    for (const [i, s] of arr.entries()) {
      if (!Number.isInteger(s) || s < 1 || s > 20) fail(`scores.json: "${p.name}" hole ${i + 1} invalid: ${s}`);
    }
  }
  const extra = Object.keys(scores).filter((k) => !ALL_PLAYERS.some((p) => p.name === k));
  if (extra.length) fail(`scores.json has unknown player names: ${extra.join(", ")}`);
  return scores;
}

// strokes received on a hole from course handicap (WHS allocation)
function strokesReceived(courseHcp, si) {
  const base = Math.floor(courseHcp / 18);
  const rem = courseHcp % 18;
  return base + (si <= rem ? 1 : 0);
}

// ── Subcommands ──────────────────────────────────────────────────────────────

async function preview() {
  const scores = loadScores();
  console.log("PREVIEW — no writes. Net = gross − playing handicap (95% allowance).\n");
  const rows = [];
  for (const p of ALL_PLAYERS) {
    const arr = scores[p.name];
    const gross = arr.reduce((a, b) => a + b, 0);
    // estimate WHS adjusted gross (net double bogey cap, using course handicap)
    let ags = 0;
    const capped = [];
    for (let i = 0; i < 18; i++) {
      const ndb = PARS[i] + 2 + strokesReceived(p.courseHcp, SIS[i]);
      ags += Math.min(arr[i], ndb);
      if (arr[i] > ndb) capped.push(`h${i + 1}:${arr[i]}→${ndb}`);
    }
    rows.push({ name: p.name, gross, net: gross - p.playingHcp, agsEst: ags, capped });
  }
  rows.sort((a, b) => a.net - b.net);
  let pos = 0, prevNet = null, shown = 0;
  for (const r of rows) {
    shown++;
    if (r.net !== prevNet) { pos = shown; prevNet = r.net; }
    console.log(
      `${String(pos).padStart(2)}. ${r.name.padEnd(12)} gross=${String(r.gross).padStart(3)}  net=${String(r.net).padStart(3)}` +
      `  (est. WHS adjusted gross=${r.agsEst}${r.capped.length ? "; NDB-capped " + r.capped.join(", ") : ""})`
    );
  }
  console.log("\nHole-by-hole echo (verify against the paper cards):");
  for (const round of ROUNDS) {
    console.log(`\n${round.label}`);
    console.log("  hole: " + Array.from({ length: 18 }, (_, i) => String(i + 1).padStart(2)).join(" "));
    console.log("  par : " + PARS.map((p) => String(p).padStart(2)).join(" "));
    for (const p of round.players) {
      console.log(`  ${p.name.padEnd(11, " ").slice(0, 11)}: ` + scores[p.name].map((s) => String(s).padStart(2)).join(" "));
    }
  }
  console.log("\nIf this matches the paper cards, run: reset → replay → finish → refresh → verify");
}

async function reset() {
  console.log("RESET — wiping stale state and reopening rounds…");

  const evt = await must("fetch event", db.from("events").select("leaderboard_freeze_state, majors_status, leaderboard_freeze_auto_reveal").eq("id", EVENT_ID).single());
  console.log(`  event: freeze_state=${evt.leaderboard_freeze_state} majors_status=${evt.majors_status} auto_reveal=${evt.leaderboard_freeze_auto_reveal}`);

  // 1. freeze state back to live (snapshot trigger only fires on live→frozen, so this is safe)
  await must("unfreeze", db.from("events").update({ leaderboard_freeze_state: "live" }).eq("id", EVENT_ID));
  console.log("  ✓ events.leaderboard_freeze_state = 'live'");

  // 2. stale freeze snapshots
  const snaps = await must("delete snapshots", db.from("event_player_freeze_snapshots").delete().eq("event_id", EVENT_ID).select("id"));
  console.log(`  ✓ deleted ${snaps.length} freeze snapshots`);

  // 3. stale submissions (must go — accepted submissions exclude players from live scoring)
  const subs = await must("delete submissions", db.from("event_round_submissions").delete().eq("event_id", EVENT_ID).select("id"));
  console.log(`  ✓ deleted ${subs.length} event_round_submissions`);

  // 4. stale score events + handicap results; reset hole states (before rounds go live,
  //    so the hole-state trigger no-ops on non-live rounds)
  const se = await must("delete score events", db.from("round_score_events").delete().in("round_id", ROUND_IDS).select("id"));
  console.log(`  ✓ deleted ${se.length} round_score_events`);
  const hrr = await must("delete hrr", db.from("handicap_round_results").delete().in("round_id", ROUND_IDS).select("participant_id"));
  console.log(`  ✓ deleted ${hrr.length} handicap_round_results`);
  const hs = await must("reset hole states", db.from("round_hole_states").update({ status: "not_started" }).in("round_id", ROUND_IDS).neq("status", "not_started").select("round_id"));
  console.log(`  ✓ reset ${hs.length} round_hole_states to not_started`);

  // 5. reopen rounds (keeps started_at = June 7; trigger sets a fresh 24h auto_complete_at)
  await must("reopen rounds", db.from("rounds").update({ status: "live", finished_at: null }).in("id", ROUND_IDS));
  console.log("  ✓ rounds reopened (status='live', finished_at=null)");

  // 6. recompute leaderboard so the stale garbage rows disappear immediately
  await must("recompute leaderboard", db.rpc("ciaga_compute_event_leaderboard", { p_event_id: EVENT_ID }));
  console.log("  ✓ leaderboard recomputed (now empty until scores arrive)");

  console.log("RESET done.");
}

async function replay() {
  const scores = loadScores();

  // Guards: rounds must be live, event must be unfrozen, no leftover score events
  const evt = await must("fetch event", db.from("events").select("leaderboard_freeze_state").eq("id", EVENT_ID).single());
  if (evt.leaderboard_freeze_state !== "live") fail(`event freeze_state is '${evt.leaderboard_freeze_state}' — run reset first`);
  const rds = await must("fetch rounds", db.from("rounds").select("id, status").in("id", ROUND_IDS));
  for (const r of rds) if (r.status !== "live") fail(`round ${r.id} status '${r.status}' — run reset first`);
  const existing = await must("check score events", db.from("round_score_events").select("id").in("round_id", ROUND_IDS).limit(1));
  if (existing.length) fail("score events already exist for these rounds — run reset first");

  // Build all 108 events, globally ordered by backdated timestamp (mimics parallel play)
  const inserts = [];
  for (const round of ROUNDS) {
    round.players.forEach((p, idx) => {
      for (let h = 1; h <= 18; h++) {
        inserts.push({
          round_id: round.id,
          participant_id: p.participantId,
          hole_number: h,
          strokes: scores[p.name][h - 1],
          entered_by: ENTERED_BY,
          created_at: holeTime(round, h, idx).toISOString(),
          _label: `${p.name} h${h}`,
        });
      }
    });
  }
  inserts.sort((a, b) => a.created_at.localeCompare(b.created_at));

  console.log(`REPLAY — inserting ${inserts.length} score events one-by-one (each fires the live leaderboard recompute)…`);
  let frozenAnnounced = false;
  for (const [i, ins] of inserts.entries()) {
    const { _label, ...row } = ins;
    await must(`insert ${_label}`, db.from("round_score_events").insert(row));
    process.stdout.write(`  [${String(i + 1).padStart(3)}/${inserts.length}] ${_label} = ${row.strokes} @ ${row.created_at}\n`);

    // announce the auto-freeze the first time it happens (expected on the hole-12 wave)
    if (!frozenAnnounced && ins.hole_number >= FREEZE_THRESHOLD) {
      const e = await must("freeze check", db.from("events").select("leaderboard_freeze_state").eq("id", EVENT_ID).single());
      if (e.leaderboard_freeze_state === "frozen") {
        frozenAnnounced = true;
        console.log(`  ❄ AUTO-FREEZE fired after ${_label} — leaderboard now frozen (last 6 holes hidden)`);
      }
    }
  }

  const e = await must("final freeze check", db.from("events").select("leaderboard_freeze_state").eq("id", EVENT_ID).single());
  console.log(`REPLAY done. freeze_state=${e.leaderboard_freeze_state} (expected: frozen)`);
}

async function finish() {
  console.log("FINISH — closing rounds with backdated timestamps…");

  for (const round of ROUNDS) {
    const finishedAt = roundFinishTime(round).toISOString();

    // status flip fires: HRR compute, HI recalc, leaderboard recompute (all DB triggers)
    await must(`finish round ${round.label}`,
      db.from("rounds").update({ status: "finished", finished_at: finishedAt }).eq("id", round.id).eq("status", "live"));
    console.log(`  ✓ ${round.label} finished at ${finishedAt}`);

    // replicate autoSubmitEventRound (JS-only step in the app): one submission per player
    const hrr = await must("fetch hrr", db.from("handicap_round_results")
      .select("participant_id, adjusted_gross_score, course_handicap_used")
      .in("participant_id", round.players.map((p) => p.participantId)));
    const hrrByPart = new Map(hrr.map((h) => [h.participant_id, h]));

    const submissions = round.players.map((p) => {
      const h = hrrByPart.get(p.participantId);
      const gross = h?.adjusted_gross_score ?? null;
      const ch = h?.course_handicap_used ?? p.courseHcp;
      return {
        event_id: EVENT_ID,
        event_round_id: EVENT_ROUND_ID,
        round_id: round.id,
        profile_id: p.profileId,
        score_used: gross != null ? gross - ch : null,
        accepted: true,
        submitted_at: finishedAt,
      };
    });
    if (submissions.some((s) => s.score_used == null)) fail(`missing handicap_round_results for ${round.label} — finish trigger did not run?`);

    await must("upsert submissions",
      db.from("event_round_submissions").upsert(submissions, { onConflict: "event_id,round_id,profile_id" }));
    console.log(`  ✓ ${round.label}: ${submissions.length} submissions (score_used = ${submissions.map((s) => s.score_used).join(", ")})`);
  }

  // recompute once more (mirrors the app), then complete the event
  await must("recompute leaderboard", db.rpc("ciaga_compute_event_leaderboard", { p_event_id: EVENT_ID }));
  console.log("  ✓ leaderboard recomputed");

  await must("event_rounds completed", db.from("event_rounds").update({ status: "completed" }).eq("event_id", EVENT_ID).neq("status", "cancelled"));
  await must("event completed", db.from("events").update({ majors_status: "completed" }).eq("id", EVENT_ID));
  console.log("  ✓ event_rounds + event marked completed (standings cascade fires via trigger)");

  console.log("FINISH done.");
}

async function refresh() {
  console.log("REFRESH — replaying handicap pipeline from 2026-06-07…");
  await must("refresh handicaps", db.rpc("ciaga_refresh_handicaps_from", { p_from_date: "2026-06-07" }));
  console.log("  ✓ ciaga_refresh_handicaps_from('2026-06-07') complete");
}

async function verify() {
  console.log("VERIFY — final state report\n");

  const evt = await must("event", db.from("events")
    .select("majors_status, leaderboard_freeze_state, leaderboard_freeze_auto_reveal, leaderboard_reveal_style")
    .eq("id", EVENT_ID).single());
  console.log(`event: majors_status=${evt.majors_status}  freeze_state=${evt.leaderboard_freeze_state}  auto_reveal=${evt.leaderboard_freeze_auto_reveal}  reveal_style=${evt.leaderboard_reveal_style}`);
  console.log(`  expected: completed / frozen / false / podium\n`);

  const rounds = await must("rounds", db.from("rounds").select("id, status, started_at, finished_at").in("id", ROUND_IDS));
  for (const r of rounds) console.log(`round ${r.id.slice(0, 8)}: ${r.status}  started=${r.started_at}  finished=${r.finished_at}`);

  const se = await must("score events", db.from("round_score_events").select("round_id").in("round_id", ROUND_IDS));
  console.log(`score events: ${se.length} (expected 108)`);

  const nameByProfile = new Map(ALL_PLAYERS.map((p) => [p.profileId, p.name]));

  console.log("\nhandicap_round_results:");
  const hrr = await must("hrr", db.from("handicap_round_results").select("*").in("round_id", ROUND_IDS));
  for (const h of hrr) {
    console.log(`  ${(nameByProfile.get(h.profile_id) ?? h.profile_id).padEnd(12)} AGS=${h.adjusted_gross_score}  SD=${h.score_differential}  accepted=${h.accepted}${h.rejected_reason ? " reason=" + h.rejected_reason : ""}`);
  }

  console.log("\nleaderboard (final, hidden until reveal):");
  const lb = await must("leaderboard", db.from("event_leaderboard_entries").select("*").eq("event_id", EVENT_ID).order("position"));
  for (const e of lb) {
    console.log(`  #${e.position} ${(nameByProfile.get(e.profile_id) ?? "?").padEnd(12)} gross=${e.gross_score} net=${e.net_score} pts=${e.points_earned} holes=${e.holes_completed} live=${e.is_live} tied=${e.tied_count ?? "-"}`);
  }

  console.log("\nfreeze snapshots (what the frozen leaderboard shows):");
  const snaps = await must("snapshots", db.from("event_player_freeze_snapshots").select("*").eq("event_id", EVENT_ID).order("position"));
  for (const s of snaps) {
    console.log(`  #${s.position} ${(nameByProfile.get(s.profile_id) ?? "?").padEnd(12)} thru ${s.holes_shown}: gross=${s.gross_score} net=${s.net_score} to_par=${s.to_par}  (actual holes at snap: ${s.actual_holes_completed})`);
  }
  console.log(`  rows: ${snaps.length} (expected 6, holes_shown=${FREEZE_THRESHOLD})`);

  const subs = await must("submissions", db.from("event_round_submissions").select("profile_id, score_used, accepted, submitted_at").eq("event_id", EVENT_ID));
  console.log(`\nsubmissions: ${subs.length} (expected 6)`);
  for (const s of subs) console.log(`  ${(nameByProfile.get(s.profile_id) ?? "?").padEnd(12)} score_used=${s.score_used} accepted=${s.accepted} at=${s.submitted_at}`);

  // later rounds by these players (handicap knock-on check) — two-step to avoid FK ambiguity
  const profileIds = ALL_PLAYERS.map((p) => p.profileId);
  const rp = await must("rp", db.from("round_participants").select("profile_id, round_id").in("profile_id", profileIds));
  const otherRoundIds = [...new Set(rp.map((r) => r.round_id))].filter((id) => !ROUND_IDS.includes(id));
  let later = [];
  if (otherRoundIds.length) {
    later = await must("later rounds", db.from("rounds").select("id, name, status, started_at").in("id", otherRoundIds).gte("started_at", "2026-06-08T00:00:00Z"));
  }
  console.log(`\nrounds after June 8 by these players: ${later.length}`);
  for (const r of later) console.log(`  ${r.id.slice(0, 8)} ${r.name} ${r.status} ${r.started_at}`);

  console.log("\ncurrent handicap indexes (post-refresh):");
  const { data: profs, error: profErr } = await db.from("profiles").select("*").in("id", profileIds);
  if (profErr) {
    console.log(`  (could not read profiles: ${profErr.message})`);
  } else {
    for (const p of profs ?? []) {
      const hiFields = Object.entries(p).filter(([k]) => k.toLowerCase().includes("handicap"));
      console.log(`  ${String(p.name).padEnd(12)} ${hiFields.map(([k, v]) => `${k}=${v}`).join("  ") || "(no handicap fields on profiles)"}`);
    }
  }

  console.log("\nVERIFY done (read-only).");
}

// ── Main ─────────────────────────────────────────────────────────────────────

const cmd = process.argv[2];
const commands = { preview, reset, replay, finish, refresh, verify };
if (!commands[cmd]) {
  console.error("Usage: node backfill.mjs <preview|reset|replay|finish|refresh|verify>");
  process.exit(1);
}
commands[cmd]().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
