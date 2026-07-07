// scripts/invitational-backfill/inspect.mjs
//
// READ-ONLY inspection of "The Invitational 2026" (CIAGA MAJORS, 2026-06-07)
// on production. Prints everything needed to plan the score backfill.
//
// Usage:  node scripts/invitational-backfill/inspect.mjs
// Env:    scripts/invitational-backfill/.env.prod  (PROD_SUPABASE_URL, PROD_SUPABASE_SERVICE_ROLE_KEY)
//         EVENT_ID=<uuid>  (optional override if name search is ambiguous)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

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
const url = env.PROD_SUPABASE_URL;
const key = env.PROD_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY in .env.prod");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function section(title) {
  console.log("\n" + "═".repeat(70));
  console.log("█ " + title);
  console.log("═".repeat(70));
}

async function q(label, fn) {
  try {
    const { data, error } = await fn();
    if (error) {
      console.log(`[${label}] ERROR: ${error.message} (code=${error.code ?? "?"})`);
      return null;
    }
    return data;
  } catch (e) {
    console.log(`[${label}] THREW: ${e.message}`);
    return null;
  }
}

function pick(row, fields) {
  const out = {};
  for (const f of fields) if (row && row[f] !== undefined) out[f] = row[f];
  return out;
}

const main = async () => {
  // ── 1. Find the event ────────────────────────────────────────────────
  section("EVENT");
  let event = null;
  if (process.env.EVENT_ID) {
    const rows = await q("event-by-id", () => db.from("events").select("*").eq("id", process.env.EVENT_ID));
    event = rows?.[0] ?? null;
  } else {
    const rows = await q("event-search", () =>
      db.from("events").select("*").ilike("name", "%invitational%")
    );
    if (rows) {
      console.log(`name search matches: ${rows.length}`);
      for (const r of rows) console.log(`  - ${r.id}  "${r.name}"  date=${r.event_date}  status=${r.majors_status}`);
      event = rows.find((r) => r.event_date === "2026-06-07") ?? rows[0] ?? null;
    }
  }
  if (!event) {
    console.error("Event not found — set EVENT_ID env var.");
    process.exit(1);
  }
  console.log("\nTARGET EVENT:");
  console.log(JSON.stringify(pick(event, [
    "id", "name", "event_date", "majors_status", "scoring_model", "points_model",
    "num_rounds", "event_type", "event_structure", "group_id", "group_season_id", "season_id",
    "competition_id", "standings_contribution", "handicap_rules",
    "leaderboard_freeze_state", "leaderboard_freeze_last_holes", "leaderboard_freeze_scope",
    "leaderboard_freeze_top_x", "leaderboard_freeze_auto_reveal", "leaderboard_reveal_style",
    "leaderboard_reveal_top_x", "created_by_profile_id", "entry_fee", "currency",
  ]), null, 2));
  const eventId = event.id;

  // ── 2. Group ─────────────────────────────────────────────────────────
  if (event.group_id) {
    const g = await q("group", () => db.from("major_groups").select("*").eq("id", event.group_id));
    if (g?.[0]) console.log(`\nGROUP: "${g[0].name}" (${g[0].id})`);
  }

  // ── 3. Event rounds ──────────────────────────────────────────────────
  section("EVENT_ROUNDS");
  const eventRounds = await q("event_rounds", () =>
    db.from("event_rounds").select("*").eq("event_id", eventId).order("round_number", { ascending: true })
  );
  for (const er of eventRounds ?? []) {
    console.log(JSON.stringify(pick(er, ["id", "round_number", "status", "round_date", "course_id", "tee_box_id", "name"])));
  }

  // ── 4. Tee times + linked rounds ─────────────────────────────────────
  section("EVENT_TEE_TIMES + ROUNDS");
  const teeTimes = await q("event_tee_times", () =>
    db.from("event_tee_times").select("*").eq("event_id", eventId).order("tee_time", { ascending: true })
  );
  // Round ids come from tee-time links AND submissions (belt & braces)
  const subRows = await q("subs-for-roundids", () =>
    db.from("event_round_submissions").select("round_id").eq("event_id", eventId)
  );
  const roundIdSet = new Set();
  for (const tt of teeTimes ?? []) if (tt.round_id) roundIdSet.add(tt.round_id);
  for (const s of subRows ?? []) if (s.round_id) roundIdSet.add(s.round_id);
  const roundIds = [...roundIdSet];
  const roundsData = roundIds.length
    ? await q("rounds", () => db.from("rounds").select("*").in("id", roundIds))
    : [];
  const roundById = new Map((roundsData ?? []).map((r) => [r.id, r]));
  for (const tt of teeTimes ?? []) {
    console.log(`\ntee_time=${tt.tee_time}  slot_id=${tt.id}  event_round_id=${tt.event_round_id ?? "null"}  round_id=${tt.round_id ?? "NULL (never started)"}  max_players=${tt.max_players ?? "?"}`);
    const r = tt.round_id ? roundById.get(tt.round_id) : null;
    if (r) {
      console.log("  round: " + JSON.stringify(pick(r, [
        "id", "name", "status", "started_at", "finished_at", "number_of_holes",
        "auto_complete_at", "course_id", "created_by", "visibility", "event_tee_time_id",
      ])));
    }
  }
  for (const r of roundsData ?? []) {
    const linked = (teeTimes ?? []).some((tt) => tt.round_id === r.id);
    if (!linked) {
      console.log("\nround NOT linked from any tee time (found via submissions):");
      console.log("  round: " + JSON.stringify(pick(r, [
        "id", "name", "status", "started_at", "finished_at", "number_of_holes",
        "auto_complete_at", "course_id", "created_by", "visibility", "event_tee_time_id",
      ])));
    }
  }
  console.log(`\nlinked rounds: ${roundIds.length}`);

  if (roundIds.length === 0) {
    console.log("No linked rounds — backfill would need to create rounds from scratch.");
  }

  // ── 5. Participants ──────────────────────────────────────────────────
  section("ROUND_PARTICIPANTS");
  const participants = roundIds.length
    ? await q("participants", () =>
        db.from("round_participants")
          .select("*, profiles:profile_id(id, name)")
          .in("round_id", roundIds)
      )
    : [];
  const partById = new Map();
  for (const p of participants ?? []) {
    partById.set(p.id, p);
    console.log(JSON.stringify({
      participant_id: p.id,
      round_id: p.round_id,
      profile_id: p.profile_id,
      name: p.profiles?.name ?? p.display_name ?? "?",
      is_guest: p.is_guest,
      role: p.role,
      handicap_index: p.handicap_index,
      assigned_handicap_index: p.assigned_handicap_index,
      course_handicap_used: p.course_handicap_used,
      playing_handicap_used: p.playing_handicap_used,
      assigned_playing_handicap: p.assigned_playing_handicap,
      tee_snapshot_id: p.tee_snapshot_id,
      team_id: p.team_id ?? null,
    }));
  }

  // ── 6. Existing score events ─────────────────────────────────────────
  section("ROUND_SCORE_EVENTS (existing partials)");
  const scoreEvents = roundIds.length
    ? await q("score_events", () =>
        db.from("round_score_events").select("round_id, participant_id, hole_number, strokes, entered_by, created_at")
          .in("round_id", roundIds).order("created_at", { ascending: true })
      )
    : [];
  const byPart = new Map();
  for (const se of scoreEvents ?? []) {
    const k = se.participant_id;
    if (!byPart.has(k)) byPart.set(k, []);
    byPart.get(k).push(se);
  }
  console.log(`total score events: ${scoreEvents?.length ?? 0}`);
  for (const [pid, evts] of byPart) {
    const p = partById.get(pid);
    const holes = [...new Set(evts.map((e) => e.hole_number))].sort((a, b) => a - b);
    console.log(`  ${p?.profiles?.name ?? pid}: ${evts.length} events, holes [${holes.join(",")}], first=${evts[0]?.created_at}, last=${evts[evts.length - 1]?.created_at}`);
  }

  // ── 7. Hole states summary ───────────────────────────────────────────
  section("ROUND_HOLE_STATES (summary)");
  const holeStates = roundIds.length
    ? await q("hole_states", () =>
        db.from("round_hole_states").select("round_id, participant_id, hole_number, status").in("round_id", roundIds)
      )
    : [];
  const hsCounts = {};
  for (const hs of holeStates ?? []) hsCounts[hs.status] = (hsCounts[hs.status] ?? 0) + 1;
  console.log(`total rows: ${holeStates?.length ?? 0}  by status: ${JSON.stringify(hsCounts)}`);

  // ── 8. Handicap round results ────────────────────────────────────────
  section("HANDICAP_ROUND_RESULTS (stale, computed at auto-close)");
  const partIds = [...partById.keys()];
  const hrr = partIds.length
    ? await q("hrr", () => db.from("handicap_round_results").select("*").in("participant_id", partIds))
    : [];
  for (const h of hrr ?? []) {
    const p = partById.get(h.participant_id);
    console.log(JSON.stringify({
      name: p?.profiles?.name ?? h.participant_id,
      round_id: h.round_id,
      holes_started: h.holes_started, holes_completed: h.holes_completed,
      adjusted_gross_score: h.adjusted_gross_score, score_differential: h.score_differential,
      course_handicap_used: h.course_handicap_used, handicap_index_used: h.handicap_index_used,
      accepted: h.accepted, rejected_reason: h.rejected_reason, is_9_hole: h.is_9_hole,
    }));
  }

  // ── 9. Submissions / leaderboard / snapshots ─────────────────────────
  section("EVENT_ROUND_SUBMISSIONS");
  const subs = await q("submissions", () => db.from("event_round_submissions").select("*").eq("event_id", eventId));
  for (const s of subs ?? []) {
    console.log(JSON.stringify(pick(s, ["id", "profile_id", "round_id", "event_round_id", "score_used", "accepted", "submission_status", "submitted_at"])));
  }

  section("EVENT_LEADERBOARD_ENTRIES (current/garbage)");
  const lb = await q("leaderboard", () =>
    db.from("event_leaderboard_entries").select("*").eq("event_id", eventId).order("position", { ascending: true })
  );
  for (const e of lb ?? []) {
    console.log(JSON.stringify(pick(e, ["position", "profile_id", "gross_score", "net_score", "format_points", "points_earned", "holes_completed", "rounds_submitted", "is_live", "tied_count", "playing_handicap", "computed_at"])));
  }

  section("EVENT_PLAYER_FREEZE_SNAPSHOTS (stale?)");
  const snaps = await q("freeze_snapshots", () =>
    db.from("event_player_freeze_snapshots").select("*").eq("event_id", eventId)
  );
  console.log(`rows: ${snaps?.length ?? 0}`);
  for (const s of snaps ?? []) {
    console.log(JSON.stringify(pick(s, ["profile_id", "gross_score", "net_score", "to_par", "format_points", "holes_shown", "actual_holes_completed", "is_live", "position", "snapshotted_at"])));
  }

  // ── 10. Entries ──────────────────────────────────────────────────────
  section("EVENT_ENTRIES");
  const entries = await q("entries", () =>
    db.from("event_entries").select("*, profiles:profile_id(id, name)").eq("event_id", eventId)
  );
  for (const en of entries ?? []) {
    console.log(JSON.stringify({ profile_id: en.profile_id, name: en.profiles?.name, status: en.status ?? en.entry_status, created_at: en.created_at }));
  }

  // ── 11. Tee snapshots + holes (par / stroke index) ───────────────────
  section("TEE SNAPSHOTS + HOLES");
  const teeSnapIds = [...new Set((participants ?? []).map((p) => p.tee_snapshot_id).filter(Boolean))];
  if (teeSnapIds.length) {
    const teeSnaps = await q("tee_snaps", () => db.from("round_tee_snapshots").select("*").in("id", teeSnapIds));
    for (const ts of teeSnaps ?? []) {
      console.log(JSON.stringify(pick(ts, ["id", "name", "gender", "holes_count", "par_total", "yards_total", "rating", "slope"])));
    }
    const holeSnaps = await q("hole_snaps", () =>
      db.from("round_hole_snapshots").select("round_tee_snapshot_id, hole_number, par, yardage, stroke_index")
        .in("round_tee_snapshot_id", teeSnapIds).order("hole_number", { ascending: true })
    );
    const bySnap = new Map();
    for (const h of holeSnaps ?? []) {
      if (!bySnap.has(h.round_tee_snapshot_id)) bySnap.set(h.round_tee_snapshot_id, []);
      bySnap.get(h.round_tee_snapshot_id).push(h);
    }
    for (const [sid, holes] of bySnap) {
      console.log(`snapshot ${sid}:`);
      console.log("  hole: " + holes.map((h) => String(h.hole_number).padStart(2)).join(" "));
      console.log("  par : " + holes.map((h) => String(h.par ?? "?").padStart(2)).join(" "));
      console.log("  si  : " + holes.map((h) => String(h.stroke_index ?? "?").padStart(2)).join(" "));
    }
  } else {
    console.log("No tee_snapshot_id on participants!");
  }

  // ── 12. Feed items ───────────────────────────────────────────────────
  section("FEED_ITEMS (stale round items)");
  const groupKeys = [];
  for (const rid of roundIds) groupKeys.push(`round:${rid}`);
  for (const er of eventRounds ?? []) groupKeys.push(`competition_round:${er.id}`);
  if (groupKeys.length) {
    const feed = await q("feed_exact", () => db.from("feed_items").select("id, group_key, occurred_at, created_at").in("group_key", groupKeys));
    for (const f of feed ?? []) console.log(JSON.stringify(f));
    for (const rid of roundIds) {
      const fh = await q("feed_like", () =>
        db.from("feed_items").select("id, group_key, occurred_at").like("group_key", `hole_event:${rid}%`)
      );
      for (const f of fh ?? []) console.log(JSON.stringify(f));
    }
  }

  // ── 13. Later rounds by same players (June 8+) ───────────────────────
  section("LATER ROUNDS (June 8+) BY EVENT PLAYERS — handicap knock-on");
  const profileIds = [...new Set((participants ?? []).map((p) => p.profile_id).filter(Boolean))];
  if (profileIds.length) {
    const later = await q("later_rounds", () =>
      db.from("round_participants")
        .select("profile_id, profiles:profile_id(name), rounds!inner(id, name, status, started_at)")
        .in("profile_id", profileIds)
        .gte("rounds.started_at", "2026-06-08T00:00:00Z")
    );
    if ((later ?? []).length === 0) console.log("none — no knock-on rounds to worry about");
    for (const lr of later ?? []) {
      console.log(JSON.stringify({ name: lr.profiles?.name, round_id: lr.rounds?.id, round: lr.rounds?.name, status: lr.rounds?.status, started_at: lr.rounds?.started_at }));
    }
  }

  // ── 14. Playoffs + audit log ─────────────────────────────────────────
  section("EVENT_PLAYOFFS + AUDIT LOG");
  const po = await q("playoffs", () => db.from("event_playoffs").select("*").eq("event_id", eventId));
  console.log(`playoffs: ${po?.length ?? 0}`);
  const audit = await q("audit", () =>
    db.from("event_audit_log").select("action_type, actor_profile_id, payload, created_at").eq("event_id", eventId).order("created_at", { ascending: false }).limit(20)
  );
  for (const a of audit ?? []) console.log(JSON.stringify(a));

  // ── 15. James's profile (entered_by for the replay) ──────────────────
  section("ADMIN PROFILE");
  const admin = await q("admin_profile", () =>
    db.from("profiles").select("id, name, is_admin, owner_user_id").eq("is_admin", true)
  );
  for (const a of admin ?? []) console.log(JSON.stringify(a));

  console.log("\nDONE (read-only — nothing was modified)");
};

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
