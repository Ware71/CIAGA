#!/usr/bin/env node
/**
 * Where does each migration stand?
 *
 * There are 231 migrations and no record of what is applied where. Answering
 * "is this staging-only?" meant linking staging, listing, linking production,
 * listing, then re-linking staging — four network round trips and a chance to
 * leave the CLI pointed at production. That question recurs in nearly every
 * piece of work in this repo's history.
 *
 * Most of it is answerable offline. Production tracks `main` and staging tracks
 * `develop`, so git already knows which migrations have reached production:
 * anything in `main..HEAD` has not. That needs no credentials and no link.
 *
 * `--remote` additionally asks the *currently linked* project what it has
 * actually applied (`npx supabase migration list`). It never changes the link.
 *
 * Usage:
 *   node scripts/migration-status.mjs
 *   node scripts/migration-status.mjs --remote
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function migrationsIn(range) {
  const out = git([
    "log",
    range,
    "--name-only",
    "--pretty=format:",
    "--diff-filter=A",
    "--",
    "supabase/migrations",
  ]);
  return [
    ...new Set(
      out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.endsWith(".sql"))
        .map((l) => path.basename(l))
    ),
  ].sort();
}

function linkedProject() {
  try {
    const ref = readFileSync(
      path.join(REPO_ROOT, "supabase", ".temp", "project-ref"),
      "utf8"
    ).trim();
    const envs = JSON.parse(
      readFileSync(path.join(REPO_ROOT, ".claude", "db-environments.json"), "utf8")
    ).supabase;
    for (const [name, cfg] of Object.entries(envs ?? {})) {
      if (cfg.project_ref === ref) return { name, ref };
    }
    return { name: "unrecognised", ref };
  } catch {
    return { name: "not linked", ref: null };
  }
}

function main() {
  const remote = process.argv.includes("--remote");
  const linked = linkedProject();
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);

  console.log(`Linked project : ${linked.name}${linked.ref ? ` (${linked.ref})` : ""}`);
  console.log(`Branch         : ${branch || "unknown"}`);

  const uncommitted = git(["status", "--porcelain", "--", "supabase/migrations"])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Production deploys from main, so anything added on this branch but absent
  // from main has not reached production.
  const notOnMain = migrationsIn("main..HEAD");

  console.log("");
  if (notOnMain.length) {
    console.log(`Not yet on main (=> not on production): ${notOnMain.length}`);
    for (const m of notOnMain) console.log(`  ${m}`);
  } else {
    console.log("Not yet on main (=> not on production): none");
  }

  if (uncommitted.length) {
    console.log("");
    console.log(`Uncommitted migration files: ${uncommitted.length}`);
    for (const l of uncommitted) console.log(`  ${l}`);
    console.log("  (uncommitted migrations cannot deploy — commit them first)");
  }

  if (!remote) {
    console.log("");
    console.log(`Pass --remote to ask ${linked.name} what it has actually applied.`);
    return 0;
  }

  console.log("");
  console.log(`Querying ${linked.name} (link unchanged)...`);
  try {
    const out = execFileSync("npx", ["supabase", "migration", "list"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    console.log(out.trim());
  } catch (err) {
    console.log("Could not reach the remote:");
    console.log(`  ${String(err.stderr || err.message).trim().split("\n")[0]}`);
    console.log("  (needs `npx supabase link` and network access)");
    return 0;
  }

  return 0;
}

process.exit(main());
