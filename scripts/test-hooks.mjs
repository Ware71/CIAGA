#!/usr/bin/env node
/**
 * Tests for the Claude Code hooks in .claude/hooks/.
 *
 * These hooks can block a turn, so a false positive is worse than no hook at
 * all — the first version of guard-push blocked a `git commit` whose message
 * merely *described* the rule, because it scanned the whole command string
 * including the heredoc body. That is the kind of bug this file exists to catch.
 *
 * Run: node scripts/test-hooks.mjs   (also part of `npm run check`)
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = (name) => path.join(REPO_ROOT, ".claude", "hooks", name);

function run(hookPath, payload, env = {}) {
  try {
    execFileSync("node", [hookPath], {
      input: JSON.stringify(payload),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
}

const results = [];
function expect(desc, actual, want) {
  const ok = actual === want;
  results.push({ ok, desc, actual, want });
}

// ── guard-push ───────────────────────────────────────────────────────────────
const push = (command, env) =>
  run(hook("guard-push.mjs"), { tool_name: "Bash", tool_input: { command } }, env);

// Must block: anything landing on main.
expect("blocks develop:main", push("git push origin develop:main"), 2);
expect("blocks +HEAD:refs/heads/main", push("git push -f origin +HEAD:refs/heads/main"), 2);
expect("blocks develop:refs/heads/main", push("git push origin develop:refs/heads/main"), 2);
expect("blocks when chained after cd", push("cd /repo && git push origin develop:main"), 2);

// Must allow: the deploy flow itself, and ordinary pushes.
expect("allows plain `git push` (deploy does this on main)", push("git push"), 0);
expect("allows pushing develop", push("git push origin develop"), 0);
expect("allows a feature branch", push("git push -u origin chore/x"), 0);
expect("does not confuse dev:maintenance for main", push("git push origin dev:maintenance"), 0);

// Must allow: text that merely mentions the forbidden form.
expect(
  "allows a commit message describing the rule",
  push("git commit -F - <<'MSG'\nPushing develop:main skips the merge.\nMSG"),
  0
);
expect("allows echoing it", push('echo "never run git push origin develop:main"'), 0);
expect("allows grepping for it", push('git log --oneline | grep "develop:main"'), 0);

// Override.
expect(
  "override lets a real one through",
  push("git push origin develop:main", { CIAGA_ALLOW_DIRECT_PUSH: "1" }),
  0
);

// Non-Bash tools are none of its business.
expect(
  "ignores non-Bash tools",
  run(hook("guard-push.mjs"), { tool_name: "Edit", tool_input: { file_path: "x" } }),
  0
);

// ── guard-staging-link ───────────────────────────────────────────────────────
// The repo is expected to be linked to staging; if it is not, that is itself the
// finding, so assert on the override and loop-guard paths which hold either way.
expect(
  "staging-link: loop guard always allows",
  run(hook("guard-staging-link.mjs"), { stop_hook_active: true }),
  0
);
expect(
  "staging-link: override always allows",
  run(hook("guard-staging-link.mjs"), {}, { CIAGA_ALLOW_PROD_LINK: "1" }),
  0
);

// ── lint-touched-migration ───────────────────────────────────────────────────
const touched = (file_path) =>
  run(hook("lint-touched-migration.mjs"), { tool_name: "Write", tool_input: { file_path } });

expect("migration hook ignores ordinary files", touched("c:/x/apps/app/lib/foo.ts"), 0);
expect("migration hook ignores a missing payload field", touched(undefined), 0);
expect(
  "migration hook passes a committed, compliant migration",
  touched("supabase/migrations/20260904000001_course_favourites_lock_grants.sql"),
  0
);

// ── session-status ───────────────────────────────────────────────────────────
expect("session-status never fails a session", run(hook("session-status.mjs"), {}), 0);

// ── report ───────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.desc}${r.ok ? "" : ` (want ${r.want}, got ${r.actual})`}`);
}
console.log(
  failed === 0
    ? `\nhooks: ${results.length} passed`
    : `\nhooks: ${failed} of ${results.length} FAILED`
);
process.exit(failed === 0 ? 0 : 1);
