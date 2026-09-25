#!/usr/bin/env node
/**
 * Lint Supabase migrations for the defect classes that prose has failed to stop.
 *
 * Three rules in this repo were each written down — in CLAUDE.md, in the deploy
 * skill, in the 2026-07 security audit — and each was broken anyway:
 *
 *   - DROP FUNCTION resets EXECUTE grants. 12 of 19 migrations that drop a
 *     function never re-grant, so any role that called it via PostgREST silently
 *     lost access.
 *   - A schema-wide ALTER DEFAULT PRIVILEGES gives anon + authenticated every
 *     right on a new table, including TRUNCATE, which is not subject to RLS. A
 *     migration that only adds grants changes nothing; it has to revoke first.
 *     44 migrations create tables; 2 contain a revoke.
 *   - The YYYYMMDD0000NN prefix does real ordering work (13 migrations landed on
 *     2026-08-25), so a duplicate prefix is a silent ordering bug.
 *
 * A rule you can run is worth more than a rule you can read.
 *
 * Usage:
 *   node scripts/lint-migrations.mjs                  # lint all, vs the baseline
 *   node scripts/lint-migrations.mjs <file> [...]     # lint specific files
 *   node scripts/lint-migrations.mjs --all            # ignore the baseline
 *   node scripts/lint-migrations.mjs --update-baseline
 *
 * Exits non-zero when a violation is found that is not in the baseline.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const BASELINE_PATH = path.join(__dirname, "lint-migrations-baseline.json");

/** Strip SQL comments so prose in a header can't be mistaken for a statement. */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

// Both `public.thing` and the pg_dump form `"public"."thing"` appear in this repo.
const ident = String.raw`(?:"?public"?\s*\.\s*)?"?([a-z0-9_]+)"?`;

function matchAll(sql, re) {
  return [...sql.matchAll(re)].map((m) => m[1].toLowerCase());
}

function analyse(file, sql) {
  const s = stripComments(sql);
  const findings = [];

  const created = new Set(
    matchAll(s, new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${ident}`, "gi"))
  );
  const rlsEnabled = new Set(
    matchAll(
      s,
      new RegExp(
        String.raw`alter\s+table\s+(?:only\s+)?${ident}\s+enable\s+row\s+level\s+security`,
        "gi"
      )
    )
  );
  const revoked = new Set(
    matchAll(s, new RegExp(String.raw`revoke\s+[\s\S]*?\s+on\s+(?:table\s+)?${ident}`, "gi"))
  );

  for (const table of created) {
    if (!rlsEnabled.has(table)) {
      findings.push({ code: "no-rls", detail: table });
    }
    if (!revoked.has(table)) {
      findings.push({ code: "no-revoke", detail: table });
    }
  }

  // A migration that only drops a function needs no grant. One that drops and
  // recreates does — that is the case the warning is about.
  const dropped = new Set(
    matchAll(s, new RegExp(String.raw`drop\s+function\s+(?:if\s+exists\s+)?${ident}`, "gi"))
  );
  const createdFns = new Set(
    matchAll(s, new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+${ident}`, "gi"))
  );
  const grantedExec = new Set(
    matchAll(s, new RegExp(String.raw`grant\s+execute\s+on\s+function\s+${ident}`, "gi"))
  );

  for (const fn of dropped) {
    if (createdFns.has(fn) && !grantedExec.has(fn)) {
      findings.push({ code: "no-execute-grant", detail: fn });
    }
  }

  return findings.map((f) => ({ ...f, file }));
}

const MESSAGES = {
  "no-rls": (d) => `table "${d}" created without "alter table ... enable row level security"`,
  "no-revoke": (d) =>
    `table "${d}" created without "revoke all ... from anon, authenticated" — ` +
    `schema default privileges leave it fully open, TRUNCATE included`,
  "no-execute-grant": (d) =>
    `function "${d}" dropped and recreated without "grant execute" — ` +
    `DROP FUNCTION resets EXECUTE grants`,
  "duplicate-prefix": (d) => `migration prefix ${d} is used by more than one file`,
};

function key(f) {
  return `${f.file}::${f.code}::${f.detail}`;
}

function main() {
  const argv = process.argv.slice(2);
  const updateBaseline = argv.includes("--update-baseline");
  const ignoreBaseline = argv.includes("--all") || updateBaseline;
  const explicit = argv.filter((a) => !a.startsWith("--"));

  const allFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const targets = explicit.length
    ? explicit.map((p) => path.basename(p)).filter((f) => allFiles.includes(f))
    : allFiles;

  const findings = [];

  for (const file of targets) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    findings.push(...analyse(file, sql));
  }

  // Prefix collisions are only meaningful across the whole directory.
  if (!explicit.length) {
    const byPrefix = new Map();
    for (const f of allFiles) {
      const prefix = f.slice(0, 14);
      if (!/^\d{14}$/.test(prefix)) continue;
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), f]);
    }
    for (const [prefix, files] of byPrefix) {
      if (files.length > 1) {
        for (const file of files) {
          findings.push({ file, code: "duplicate-prefix", detail: prefix });
        }
      }
    }
  }

  if (updateBaseline) {
    const keys = findings.map(key).sort();
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({ known: keys }, null, 2)}\n`);
    console.log(`Baseline written: ${keys.length} known findings.`);
    return 0;
  }

  let baseline = new Set();
  if (!ignoreBaseline && fs.existsSync(BASELINE_PATH)) {
    baseline = new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).known ?? []);
  }

  const fresh = findings.filter((f) => !baseline.has(key(f)));

  if (fresh.length === 0) {
    const suffix = baseline.size ? ` (${baseline.size} pre-existing, baselined)` : "";
    console.log(`migrations: clean${suffix}`);
    return 0;
  }

  console.error(`\nmigration lint: ${fresh.length} new violation(s)\n`);
  for (const f of fresh) {
    console.error(`  ${f.file}`);
    console.error(`    ${MESSAGES[f.code](f.detail)}\n`);
  }
  console.error("See .claude/rules/supabase-migrations.md for the required shape.");
  console.error("If a finding is genuinely not applicable, explain why rather than");
  console.error("baselining it — the baseline is for pre-existing debt only.\n");
  return 1;
}

process.exit(main());
