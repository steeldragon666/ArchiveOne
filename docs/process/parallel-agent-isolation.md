# Parallel Agent Isolation — Lessons Learned

**Context:** captured during the 2026-05-12/13 Claim Wizard build session, where
multiple parallel sub-agents (implementer + reviewer + fix specialists) ran
concurrently against the same repo. Two failure modes surfaced that the
`superpowers:dispatching-parallel-agents` skill's red-flags list doesn't yet
cover.

## TL;DR

> **File lanes alone are not sufficient isolation.** Two agents can own
> non-overlapping files and still collide via shared mutable state —
> particularly a running dev server, a shared DB connection pool, or a
> shared `tsx watch` process.

If a dispatched agent's correctness depends on a running process that
_another_ agent could perturb, those agents are NOT independent. Either
serialize them or freeze the shared resource for the test window.

---

## Failure mode 1 — `tsx watch` restarts during e2e

**Setup.** Two agents in parallel:

- **Agent B** — editing `apps/api/src/jobs/*.ts` for codebase-wide pg-boss
  hardening (3 separate commits, multiple edit passes per commit).
- **Agent C** — running Playwright e2e tests in `apps/web/e2e/wizard.spec.ts`
  against the live dev server.

**File lanes.** Zero overlap. Agent B owns `apps/api/src/**`; Agent C owns
`apps/web/e2e/**`.

**What broke.** Every time Agent B saved a `.ts` file in `apps/api/src/jobs/`,
the API's `tsx watch` process restarted. Each restart took ~10–20 seconds
(re-instantiating pg-boss, re-registering 6 job queues, re-listening on :3000).
During that window, every in-flight Playwright request 500'd or
ECONNRESET'd, and any in-flight `privilegedSql` cleanup query failed with
`AggregateError`.

Agent C reported:

> _"Across my test attempts the API server log shows:_
> _`1:41:24 pm [tsx] change in ./src\jobs\claim-evidence-binding.ts Restarting...`_
> _...followed by `pg-boss start failed: Connection terminated`."_

Agent C never reached a green test run.

**Root cause.** Agent C's correctness depended on the _process_ at `:3000` being
stable. Agent B's edits triggered that process to restart. The shared state
wasn't a file — it was a running watcher.

**Lesson.** When dispatching parallel agents:

- If one agent runs e2e (or any test that exercises a long-lived server),
  no other agent may modify any file that triggers `tsx watch` / `nodemon` /
  `next dev` HMR for that server.
- File lanes must include the watcher's scope, not just direct edits.

---

## Failure mode 2 — Shared DB connection pool

**Setup.** The Supabase Free tier session-mode pooler has a hard cap of **15
concurrent clients**. The dev server consumes:

- API `sql` (app role): pool of 3
- API `privilegedSql` (postgres role): pool of 5 (hardcoded)
- pg-boss: pool of 5 (default)

Total dev-server-resident: ~13. Headroom: 2 connections.

**What broke.** When the test runner (Playwright + `@cpa/db/client`) also opens
its own `privilegedSql` pool (default max 5), the total budget is 18. Under
real test load, the Supabase pooler returns `EMAXCONNSESSION` or drops
connections mid-query, surfacing as `AggregateError` with no detail at the
postgres-js layer.

**Lesson.** Connection pool sizing across all processes (dev server + test
runner + any background tooling) must fit under the DB's connection cap.
For Supabase Free's 15-client cap, options include:

- Reduce `privilegedSql`'s pool size to 2 under `NODE_ENV=test`
- Stop the dev server before running e2e tests
- Use a separate Supabase project (or local Postgres) for e2e

---

## Refined red-flags list

These are additions to the `dispatching-parallel-agents` skill's existing
"Don't use when" section:

| New red flag                                                                                        | Mitigation                                                             |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| One agent runs e2e or integration tests against a live dev server                                   | Freeze the dev server (no edits to api/web source) for the test window |
| Agents share a connection pool to a remote DB with a hard client cap                                | Verify total pool footprint < cap; reduce pool sizes for test mode     |
| Agents touch source watched by `tsx watch`, `nodemon`, or HMR for a server another agent depends on | Treat the watcher's scope as a shared lane                             |
| Agents share state through a long-lived background process                                          | The process counts as shared state — treat as such                     |

## Practical heuristic

Before dispatching parallel agents, ask:

1. **Do any agents need a running process to validate their work?**
   (e2e tests, smoke tests, dev-server-dependent verification)
2. **Could any other agent perturb that process?**
   (source edits triggering reload, pg-boss queue collisions, DB pool starvation)

If both answers are yes, those agents are NOT parallel-safe. Either:

- **Serialize them** — finish the source-modifying agent first, then run the
  test-verifying agent
- **Freeze the shared resource** — explicitly tell the source-modifying agent
  not to touch source that triggers watcher reload, and tell the
  test-verifying agent to assume the server is stable

The cost of getting this wrong is the test-verifying agent burning time on
failures that aren't real bugs in its own code — they're interference from
the parallel partner.

---

## Where this lesson lives

This doc is in the repo (`docs/process/parallel-agent-isolation.md`) so the
team and future Claude sessions can reference it. Upstreaming to the
`superpowers:dispatching-parallel-agents` skill itself would be a separate
contribution to the plugin author.
