# Running Claude Code as a dev team, driven from Linear

A proposal. Nothing in this document is implemented yet — every config block is a thing to
approve, not a thing that exists.

Status: **proposal**, written 2026-07-28. Verified against Claude Code and Linear docs as of that
date. Both products move fast; re-check the capability table before building.

---

## 1. Can this actually work?

Yes. Most of the machinery is first-party and shipping. The one piece you'd most expect to exist —
"assign a Linear issue to @claude" — is the piece that doesn't.

| Capability | Status | What it gives you |
|---|---|---|
| [Linear MCP server](https://linear.app/docs/mcp) | **Official, live** | `https://mcp.linear.app/mcp` (read-write) or `/mcp/readonly`. OAuth 2.1 with dynamic client registration. Claude Code reads and writes your issues, projects and comments directly. |
| [Linear as a claude.ai connector](https://code.claude.com/docs/en/mcp) | **Live** | Same server, registered on your claude.ai account instead of locally. Required for cloud routines — they can't see local `claude mcp add` servers. |
| [Claude Code Routines](https://code.claude.com/docs/en/routines) | **Research preview** | A saved prompt + repos + connectors that runs unattended on Anthropic infra. Triggers: schedule, HTTP API, GitHub event. Pro/Max/Team/Enterprise with Claude Code on the web. |
| [Routine `/fire` API](https://platform.claude.com/docs/en/api/claude-code/routines-fire) | **Experimental** | `POST https://api.anthropic.com/v1/claude_code/routines/{trig_…}/fire`. Per-routine bearer token. This is how an external system (Linear) starts a session. |
| [`anthropics/claude-code-action@v1`](https://code.claude.com/docs/en/github-actions) | **GA** | `@claude` in a GitHub issue or PR comment, or automation mode with an explicit prompt on any event. |
| [Linear agent platform](https://linear.app/developers/agents) | **Official** | OAuth `actor=app`, scopes `app:assignable` / `app:mentionable`, `AgentSession` + `AgentActivity`, `AgentSessionEvent` webhooks. This is what Cursor and Devin are built on. |
| **Claude Code as a first-party Linear agent** | ❌ **Doesn't exist** | [anthropics/claude-code#12925](https://github.com/anthropics/claude-code/issues/12925), open since Dec 2025, no Anthropic response. Linear's [agent directory](https://linear.app/integrations/agents) lists Codex, Cursor, Copilot, Devin, Charlie — and **[Cyrus](https://github.com/ceedaragents/cyrus)** (Apache-2.0, ~729★) as the community bridge that runs Claude Code as a Linear agent. |

So the honest framing: **you can absolutely instruct Claude Code from Linear today.** Phases 1 and 2
below use nothing but supported product. Phase 3 — the "@claude" assignee badge in your issue list —
needs either a third-party tool or an app you write.

---

## 2. The one idea that matters: an issue is a prompt

Everything else here is plumbing. This is the part that decides whether the output is any good.

A Linear issue written as a *ticket* — "Fantasy cash-out button feels laggy" — produces a session
that guesses. A Linear issue written as a *prompt contract* produces a session that behaves like
someone who read the code first.

Adopt this as the issue template on the CIAGA team:

```markdown
## Goal
<One sentence. The user-visible outcome, not the implementation.>

## Context
<Files, routes, tables. Paths not prose. e.g. apps/app/lib/fantasy/pricing.ts,
 the fantasy_score_pmfs table, /events/[id]/picks>

## Acceptance
- [ ] <Checkable statement 1>
- [ ] <Checkable statement 2>

## Out of scope
<What NOT to touch. This is the highest-value section and the one people skip.>

## Verification
<Which flow to drive in a browser — or "logic only, unit tests are sufficient".>
```

This isn't an arbitrary format. It's a transcription of how the good commits in this repo are
already written — root cause explained, then an explicit verification claim
("Browser-verified end to end in portrait and landscape" / "Not browser-verified; verified via tsc,
eslint, both builds"). The template just moves that discipline to the *front* of the work instead
of the end.

**Out of scope earns its place.** Agents are eager. An issue about a cash-out button with no
boundary will come back having also refactored the pricing model.

---

## 3. The team

Four roles, defined as committed agent files so they exist locally, in CI, and in cloud sessions
alike.

| Agent | Job | Tools | When it runs |
|---|---|---|---|
| `spec-writer` | Turns a one-line issue into the contract above. Asks questions as Linear comments rather than guessing. | Read, Grep, Glob, Linear MCP | Issue labelled `agent:spec` |
| `implementer` | Branches, builds, gates, opens the PR. | All | Issue labelled `agent:build` |
| `reviewer` | Reads the diff against CLAUDE.md rules and repo conventions. | Read, Grep, Glob, Bash(git diff) | PR opened against `develop` |
| `verifier` | Drives the changed flow in a browser per the existing `/verify` skill. | Playwright MCP, Bash | Local only — see §7 |

> ⚠️ **`.gitignore` blocks this today.** The current rule is `.claude/*` with only `skills/`,
> `settings.json` and `db-environments.json` un-ignored. Agent and command files would be invisible
> to git, and therefore invisible to every cloud session and CI run. Fix first:
>
> ```gitignore
> # AI assistant files: track CLAUDE.md + shared skills, ignore local/session files
> .claude/*
> !.claude/skills/
> !.claude/agents/
> !.claude/commands/
> !.claude/settings.json
> !.claude/db-environments.json
> ```

### `.claude/agents/implementer.md`

```markdown
---
name: implementer
description: Implements a specified CIAGA change end to end — branch, code, gates, PR. Use when a Linear issue has a filled-in Goal/Context/Acceptance contract and is labelled agent:build.
model: opus
---

You are implementing one Linear issue in the CIAGA monorepo. You are not exploring, and you are
not redesigning.

## Boundaries
- Work only within the issue's Context. Anything under "Out of scope" is off limits, including
  "while I was here" cleanups.
- Never deploy. Never run `npx supabase db push` or `npx supabase link`. You may WRITE a migration
  file under `supabase/migrations/` — applying it is a human step via the `/deploy` skill.
- Never modify `.env*`. Never add a dependency. If the issue cannot be done without one, stop and
  say so in the PR body.
- If the issue is ambiguous enough that two reasonable readings give different code, stop and ask
  as a Linear comment rather than picking one.

## Procedure
1. `git fetch origin && git checkout develop && git pull` — `develop` is the base branch, NOT the
   repo default branch.
2. `git checkout -b claude/<ISSUE-KEY>-<short-slug>`
3. Read before writing. Find the existing helper before adding a new one; this codebase has a lot
   of them under `apps/app/lib/`.
4. Implement.
5. Gates, all of them, from the repo root:
   - `npm --workspace apps/app run typecheck`
   - `npm --workspace apps/web run typecheck`
   - `npm --workspace apps/app run test`
   - `npm run build`
6. Commit using this repo's convention: Conventional Commits with a scope
   (`feat(fantasy):`, `fix(feed):`, `perf(app):`), a body that explains root cause rather than
   restating the diff, and a final line stating exactly what verification was and was not done.
7. Push the branch and open a PR against `develop`.

## PR body must contain
- The Linear issue key and link.
- The Acceptance checklist, ticked or explicitly not ticked with a reason.
- Gate results, pasted, not summarised.
- **A verification claim that is honest.** "Typecheck and build pass; NOT browser-verified" is a
  correct and acceptable answer. Claiming browser verification you did not do is not.
- A `⚠️ MIGRATION` line if you added anything under `supabase/migrations/`.
```

### `.claude/agents/reviewer.md`

```markdown
---
name: reviewer
description: Reviews a CIAGA diff against repo conventions and the project's hard rules. Use on PRs targeting develop.
tools: Read, Grep, Glob, Bash
model: opus
---

Review the diff. Report findings ranked by severity; if there are none, say so plainly rather than
inventing something.

## Hard rules — flag any violation as blocking
- Any `.env*` change.
- Any new dependency in a package.json.
- Any migration that does `DROP FUNCTION` and recreates without re-granting EXECUTE. This reset
  grants and broke production once already (2026-07 security audit).
- Any migration applied rather than merely written.
- Any change to `main`-related deploy machinery.

## Conventions
- Reuse over reinvention: does an equivalent helper already exist under `apps/app/lib/`?
- API routes under `apps/app/app/api/` that take external input: is authorization checked, and is
  any secret comparison constant-time (`lib/auth/safeCompare.ts`)?
- Does the commit message match the repo's Conventional-Commits-with-scope style, with an honest
  verification line?

## Coverage reality check
Tests cover pure logic under `apps/app/lib/**/__tests__/` only — 22 files, ~313 cases, heavily
concentrated in `lib/fantasy/`. Nothing exercises the API routes or components. If this diff
touches a route or a component, say explicitly that CI passing is weak evidence here.
```

`spec-writer.md` and `verifier.md` follow the same shape; `verifier` should delegate to the
existing `/verify` skill rather than restating its procedure.

---

## 4. The state machine

Linear workflow states, and what moves an issue between them:

```
   Triage
     │  human adds label agent:spec
     ▼
   Spec Ready ────────────────────────┐
     │  human adds label agent:build  │ spec-writer fills in the contract
     ▼                                │
   In Progress ──── agent has a question ────▶ Needs Input ──┘
     │  PR opened, CI green
     ▼
   In Review
     │  human (or local /verify) drives the flow in a browser
     ▼
   Ready to Deploy
     │  human runs /deploy
     ▼
   Done
```

Labels are the control surface:

| Label | Meaning |
|---|---|
| `agent:spec` | Turn this into a proper contract |
| `agent:build` | Contract is good, go build it |
| `human-only` | **Kill switch.** No agent touches this, ever. Checked at every entry point. |
| `needs-verify` | Code is in, browser check outstanding |
| `has-migration` | PR contains a migration; deploy needs the staging→prod ritual |

Two states carry weight and shouldn't be collapsed away:

- **Needs Input** is what stops an ambiguous issue turning into confident wrong code. An agent that
  asks a question and stops is behaving correctly.
- **Ready to Deploy** stays human. `/deploy` is never automated. See §9.

---

## 5. Phase 0 — PRs and CI (prerequisite)

This repo has **never had a pull request** (there is no `Merge pull request` commit in the history)
and has **no CI at all** (no `.github/` directory). Today, every gate is run by whoever is at the
keyboard.

That's workable when the author is you. It stops being workable the moment an agent is the author,
because you'd be reviewing code that nothing independent has checked. So: PRs against `develop`,
with a CI check that has to be green.

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [develop, main]
  push:
    branches: [develop]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      - name: Typecheck app
        run: npm --workspace apps/app run typecheck
      - name: Typecheck web
        run: npm --workspace apps/web run typecheck
      - name: Lint web
        run: npm --workspace apps/web run lint

      - name: Unit tests
        run: npm --workspace apps/app run test

      - name: Build both apps
        run: npm run build
```

`npm run build` runs `next build` for both apps and is the slowest step, but it is also the one
that actually catches the class of breakage this codebase produces. Keep it.

### `.github/workflows/claude.yml`

Lets you type `@claude` on a PR to ask for a fix without leaving GitHub.

```yaml
name: Claude

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  claude:
    if: contains(github.event.comment.body, '@claude')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          claude_args: |
            --max-turns 15
            --model claude-opus-5
```

### Supporting changes

**Add uniform script names** so CI, agents and you all invoke the same thing. Today typechecking is
the bare `npx tsc --noEmit` run from inside a workspace, which is easy to get wrong from the root.

`apps/app/package.json`:
```json
"scripts": {
  "dev": "next dev --webpack",
  "build": "next build --webpack",
  "start": "next start",
  "test": "vitest run",
  "typecheck": "tsc --noEmit",
  "lint": "eslint"
}
```

`apps/web/package.json`: add `"typecheck": "tsc --noEmit"`.

**Move agent-safe permissions into the tracked settings file.** `.claude/settings.json` currently
has five allow entries; the ~47 that make an autonomous session usable live in
`.claude/settings.local.json`, which is gitignored — so cloud sessions and CI see almost nothing
and would prompt constantly. There is also **no deny list anywhere**, which is the bigger problem.

`.claude/settings.json`:
```json
{
  "permissions": {
    "allow": [
      "Bash(npm run:*)",
      "Bash(npm --workspace:*)",
      "Bash(npx tsc --noEmit)",
      "Bash(npx vitest run *)",
      "Bash(node scripts/check-db-env.js)",
      "Bash(npx supabase projects list)",
      "Bash(npx supabase migration list *)",
      "Bash(git status:*)",
      "Bash(git log:*)",
      "Bash(git diff:*)",
      "Bash(git add:*)",
      "Bash(git checkout:*)",
      "Bash(git commit:*)"
    ],
    "deny": [
      "Bash(npx supabase db push:*)",
      "Bash(npx supabase link:*)",
      "Bash(git push origin develop:*)",
      "Bash(git push origin main:*)",
      "Bash(git push origin develop:main)",
      "Read(./.env*)",
      "Edit(./.env*)"
    ]
  }
}
```

**Branch protection**: require the CI check on `develop`. Leave `main` alone — `/deploy` merges to
it locally and protection would break that ritual.

---

## 6. Phase 1 — Linear as the prompt source, you drive

Works today. No infrastructure. Start here.

### Setup

```bash
claude mcp add --transport http linear-server https://mcp.linear.app/mcp
```

Then `/mcp` inside a session to complete the OAuth flow.

### `.claude/commands/work.md`

```markdown
---
description: Implement a Linear issue end to end and open a PR
argument-hint: <ISSUE-KEY>  e.g. CIA-42
---

Implement Linear issue **$1**.

1. Fetch the issue via the Linear MCP server: title, description, labels, comments.
2. **If it carries the `human-only` label, stop immediately** and tell me. Do nothing else.
3. If Goal / Context / Acceptance are missing or empty, stop and run `/spec $1` instead — do not
   guess at the contract.
4. Move the issue to **In Progress** and comment that you've started.
5. Hand off to the `implementer` agent with the full issue body as the task.
6. When the PR is open, comment the PR link on the issue and move it to **In Review**. Add the
   `needs-verify` label unless the issue's Verification section says "logic only".
7. If you got blocked or had to ask something, move it to **Needs Input**, comment the question,
   and stop. Do not proceed on an assumption.

Report back: branch name, PR link, gate results, and whether browser verification is outstanding.
```

### `.claude/commands/spec.md`

```markdown
---
description: Turn a thin Linear issue into a proper prompt contract
argument-hint: <ISSUE-KEY>
---

Read Linear issue **$1** and the code it refers to, then rewrite its description into the CIAGA
issue contract: Goal, Context (real file paths), Acceptance (checkable items), Out of scope,
Verification.

Ground it in the actual codebase — open the files, don't paraphrase the title. If something can't
be settled from the code, list it as an open question in a comment and move the issue to
**Needs Input** rather than inventing an answer.

Update the description via Linear MCP, then move to **Spec Ready**.
```

### What this gets you

Linear becomes the queue and the memory. You type `/work CIA-42`, the session pulls full context
without you re-explaining anything, and the trail lives on the issue rather than in a terminal
scrollback you'll lose.

**Limit, stated plainly:** nothing happens while your laptop is shut.

---

## 7. Phase 2 — unattended cloud routines

[Routines](https://code.claude.com/docs/en/routines) run on Anthropic's infra, so work continues
without you. Create at [claude.ai/code/routines](https://claude.ai/code/routines).

First, add Linear as a connector at [claude.ai/customize/connectors](https://claude.ai/customize/connectors)
— routines can't see the local MCP server you added in Phase 1. (Alternatively, declare it in the
committed `.mcp.json`, which currently holds only Playwright.)

### Routine A — "CIAGA · build queued issues"

**Repositories:** `Ware71/CIAGA` · **Triggers:** schedule (hourly) + API · **Connectors:** Linear only

```
You are picking up queued development work for the CIAGA golf society app.

If the routine-fire-payload block contains a Linear issue key, work that issue. Otherwise, query
Linear for issues on the CIAGA team in state "Spec Ready" with label `agent:build`, and take the
single highest-priority one. If there are none, stop and do nothing — this is a normal outcome,
not a failure.

Skip any issue labelled `human-only`.

BEFORE ANY WORK: the repository default branch is `main`, but all development happens on `develop`.
Run `git fetch origin && git checkout develop` first. Building on `main` produces a stale, wrong
diff.

Then follow the `implementer` agent definition in `.claude/agents/implementer.md` exactly. It
carries the branch naming, the gates, the commit convention and the hard prohibitions.

You cannot browser-verify in this environment — there is no dev server, no staging credentials, and
`.claude/test-credentials.local.json` is gitignored so it is not in this clone. Do not claim
verification you did not perform. State in the PR body that browser verification is outstanding,
and set the Linear issue to "In Review" with the `needs-verify` label.

If the issue is ambiguous, do NOT pick an interpretation. Move it to "Needs Input", comment your
question on the issue, and stop.
```

### Routine B — "CIAGA · review PRs"

**Trigger:** GitHub event, `pull_request.opened`, filtered to base branch `develop`.

```
Review the pull request that triggered this run against `.claude/agents/reviewer.md`.

Post findings as a single PR review comment, ranked by severity, most severe first. If nothing is
wrong, say so in one line — do not manufacture findings to look useful.

If the PR references a Linear issue key, mirror a one-line verdict onto the Linear issue.
```

### Five things that will silently break these runs

These are specific to this repo. Each one produces a run that reports green while doing the wrong
thing.

1. **Routines clone the default branch — which is `main` here, not `develop`.** Every prompt must
   check out `develop` explicitly. Miss this and agents build against whatever last shipped.
2. **Routines may only push `claude/`-prefixed branches** unless *Allow unrestricted branch pushes*
   is enabled. Leave it **off**. The restriction doubles as protection for `develop` and `main`, and
   the branch naming in `implementer.md` already complies.
3. **Fire text is treated as untrusted data.** The `text` you POST arrives wrapped in a
   `<routine-fire-payload>` block explicitly labelled as not-instructions. The saved prompt has to
   opt in by referring to it — which the prompt above does. Without that sentence, the payload is
   inert and the routine ignores your issue key.
4. **There is no secrets store.** Cloud environment variables are visible to anyone who can edit the
   environment. So no Supabase service role key, no `SUPABASE_ACCESS_TOKEN`, no staging login. This
   is a hard constraint, not a caution — agents in the cloud cannot touch your database at all,
   which is the correct outcome anyway.
5. **A green routine status means the session exited cleanly, not that the task succeeded.** Blocked
   network calls and task-level failures both show green. Read the transcript.

### The browser-verification handoff

`/verify` cannot run in the cloud, for the reasons in (4). This isn't a gap to paper over — it's the
line between what a cloud agent can assert and what it can't.

So the workflow deliberately ends the automated portion at **In Review + `needs-verify`**. Closing
that out is a local step: `/verify`, or you clicking through it. Given the standing note that
several shipped features are still not browser-tested, an explicit label for it is arguably worth
more than the automation is.

### Optional: instant triggering via a Linear webhook

The hourly schedule means up to an hour of latency. If that bothers you, add an API trigger to
Routine A and bridge Linear to it. Linear webhooks are configured in workspace API settings, sign
with `Linear-Signature` (HMAC-SHA256 over the raw body), and retry 3× at 1min / 1hr / 6hr.

`apps/app/app/api/webhooks/linear/route.ts` — modelled on the existing cron routes, which already
do a constant-time shared-secret check:

```ts
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/linear
 *
 * Bridges Linear issue events to a Claude Code routine. When an issue enters
 * "Spec Ready" carrying the agent:build label, fire the routine with the issue key.
 *
 * Env: LINEAR_WEBHOOK_SECRET, CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN
 */
export async function POST(req: Request) {
  const secret = process.env.LINEAR_WEBHOOK_SECRET;
  const fireUrl = process.env.CLAUDE_ROUTINE_FIRE_URL;
  const fireToken = process.env.CLAUDE_ROUTINE_TOKEN;

  if (!secret || !fireUrl || !fireToken) {
    console.error("[linear-webhook] not configured");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const raw = await req.text();
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const got = req.headers.get("linear-signature") ?? "";
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = JSON.parse(raw);
  const labels: string[] = (payload?.data?.labels ?? []).map(
    (l: { name: string }) => l.name
  );
  const state: string | undefined = payload?.data?.state?.name;

  if (labels.includes("human-only")) return NextResponse.json({ skipped: "human-only" });
  if (state !== "Spec Ready" || !labels.includes("agent:build")) {
    return NextResponse.json({ skipped: "not queued" });
  }

  const key = payload?.data?.identifier; // e.g. "CIA-42"

  // Note: /fire has no idempotency key. A Linear retry creates a second session.
  const res = await fetch(fireUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fireToken}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: `Work Linear issue ${key}.` }),
  });

  if (!res.ok) {
    console.error("[linear-webhook] fire failed", res.status, await res.text());
    return NextResponse.json({ error: "Fire failed" }, { status: 502 });
  }

  const { claude_code_session_url } = await res.json();
  return NextResponse.json({ fired: key, session: claude_code_session_url });
}
```

Two caveats worth knowing before you build this: `/fire` has **no idempotency key**, so a Linear
retry starts a second session on the same issue — dedupe on your side if that matters. And the
whole bridge is optional; the hourly poll needs no code and no secrets.

---

## 8. Phase 3 — "assign it to @claude"

The badge in the assignee column. Two routes, neither first-party.

**Option A — [Cyrus](https://github.com/ceedaragents/cyrus)** (Apache-2.0, ~729★, active). Claude
Code runs in a per-issue git worktree on a machine you control; issues map to branches and PRs.
Gives the real assignee UX now. Cost: a process you must keep alive (tmux, pm2 or systemd) and your
own keys. Sensible if you'd run it on an always-on box; less so on a laptop, where it degrades to
Phase 1 with extra steps.

**Option B — build a Linear app.** OAuth with `actor=app`, request `app:assignable`, subscribe to
`AgentSessionEvent`, emit a `thought` activity **within 10 seconds** to acknowledge, then drive the
work (via `/fire` or the Agent SDK) and stream `AgentActivity` back as it progresses. Perhaps a
day's work for a decent first version, plus something always-on to host it.

**Recommendation: don't.** Phase 2 already gets you unattended agents that read Linear, write code
and open PRs. Phase 3 buys presentation — a nicer surface on the same capability — at the cost of
infrastructure you'd have to keep running. And if
[#12925](https://github.com/anthropics/claude-code/issues/12925) ships, whatever you build here is
immediately obsolete. Revisit if the assignee UX turns out to matter to how you actually work.

---

## 9. Guardrails

The rules already in `CLAUDE.md` are *requests*. Once agents run unattended they need to be
*enforcement*.

| Rule | How it's enforced |
|---|---|
| Agents never deploy | `/deploy` is human-invoked only. `git push origin develop:main` denied in settings — it was already the loudest rule in the deploy skill. |
| Agents never apply migrations | `Bash(npx supabase db push:*)` and `Bash(npx supabase link:*)` in the deny list. Writing a migration file is fine; the PR flags it with `has-migration`. |
| The CLI stays linked to staging | Follows from the above — an agent that can't run `supabase link` can't leave it linked to prod. |
| No `.env` access | `Read(./.env*)` / `Edit(./.env*)` denied. Cloud sessions have no secrets anyway. |
| No new dependencies | Reviewer treats any package.json dependency change as blocking. |
| `human-only` respected | Checked at every entry point: `/work`, both routines, the webhook bridge. |

Optionally, a `PreToolUse` hook in `.claude/settings.json` (there are no hooks today) as a
belt-and-braces block on `supabase db push` regardless of how it's spelled.

**The `DROP FUNCTION` gotcha stays in the reviewer's checklist.** Dropping and recreating a Postgres
function resets EXECUTE grants; it broke production once already. It's exactly the kind of thing a
diff review catches and a typecheck never will.

---

## 10. Costs, limits, and where this is weakest

**Money and quota.** Routine runs draw down your Claude Code subscription and have a per-account
daily run cap; over the cap you either stop or run on metered overage if usage credits are on. One-off
runs are exempt from the daily cap. GitHub Actions minutes are consumed by CI and by
`claude-code-action`, and `npm run build` on two Next apps is not a cheap job to run on every push.

**Cloud session ceilings.** ~4 vCPU, 16 GB RAM, 30 GB disk. Fine for this repo.

**The weakest link is test coverage.** There are 22 test files and ~313 cases, all under
`apps/app/lib/**/__tests__/`, heavily concentrated in `lib/fantasy/`. Nothing exercises the ~191 API
routes, and nothing exercises components. So "CI is green" means *the pure logic still works and it
compiles* — a genuinely useful signal for the fantasy pricing code, and close to no signal for a
route change.

Two consequences worth acting on:

- **Point the first agent-run issues at `lib/`-shaped work** — scoring, pricing, stats,
  handicap logic — where the tests actually bite and a green CI run means something.
- For route and UI work, `needs-verify` is doing the real gating, not CI. Treat it that way.

**And the honest failure mode:** a routine that reports green having built the wrong thing on the
wrong branch. The mitigations are in §7, but the habit that catches it is opening the transcript.

---

## 11. What to do first

Sequenced so each step earns the next, and you can stop at any point:

1. **This week — Phase 1.** Add the Linear MCP server, write `/work` and `/spec`, fix the
   `.gitignore` rule, and run three real issues through it by hand. This is an hour of setup and it
   tells you whether the issue-as-contract format actually produces good sessions on *your* codebase.
   If it doesn't, nothing further is worth building.
2. **Then — Phase 0.** Add the two workflows, the `typecheck`/`lint` scripts, the tracked permissions
   with a deny list, and branch protection on `develop`. Do this once you've decided the workflow is
   worth keeping, because it's the step that changes how *you* work too.
3. **Then — one routine.** Routine A on an hourly schedule only. Live with it for a fortnight before
   adding the review routine or the webhook bridge.
4. **Reassess Phase 3** only if the missing assignee badge is genuinely getting in your way.

The step that most determines whether any of this works is step 1, and it has nothing to do with
automation — it's whether issues get written as contracts. The plumbing is easy. That habit is the
whole thing.
