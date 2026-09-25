#!/usr/bin/env node
/**
 * SessionStart: one line of state that is otherwise a manual check every session.
 *
 * Which Supabase project is linked, how many migrations are waiting to reach
 * main, and whether the tree is carrying uncommitted work. Cheap and offline —
 * git plus two small files, no network, so it can never delay a session start.
 *
 * Plain stdout on exit 0 is added to the session context on SessionStart.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function git(args) {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
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
      if (cfg.project_ref === ref) {
        return name === "production" ? "PRODUCTION  <-- re-link staging" : name;
      }
    }
    return `unrecognised ref ${ref}`;
  } catch {
    return "not linked";
  }
}

function main() {
  const bits = [];

  bits.push(`Supabase: ${linkedProject()}`);

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch) bits.push(`branch: ${branch}`);

  const pending = git(["log", "main..HEAD", "--name-only", "--pretty=format:", "--", "supabase/migrations"])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const uniquePending = new Set(pending).size;
  if (uniquePending) bits.push(`${uniquePending} migration(s) not yet on main`);

  const dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean).length;
  if (dirty) bits.push(`${dirty} uncommitted path(s)`);

  process.stdout.write(`[ciaga] ${bits.join(" | ")}\n`);
  return 0;
}

process.exit(main());
