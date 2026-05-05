# Theme D (p7d) Kickoff Prep

**Date staged:** 2026-05-05
**Status:** Waiting for Theme C to merge before launching Theme D parallel session
**Source plan:** `docs/plans/2026-05-03-p7-implementation.md` Tasks D.1-D.15 (lines 814-1010)
**Source design:** `docs/plans/2026-05-03-p7-design.md` Section 4.5 (lines 518-799)

This document captures gaps in the master plan that the Theme D executor must
handle, and provides a copy-paste kickoff prompt for a parallel Claude session.

## Significant gaps in the master plan

### Gap 1: pg-boss is not actually installed

**Master plan claim** (Task D.9, line 938):

> Cron registration: uses pg-boss (existing dependency) `boss.schedule('rif-daily-scrape', '0 3 * * *', 'Australia/Sydney')`.

**Reality** (verified 2026-05-05): `pg-boss` is referenced throughout
`apps/api/src/jobs/*.d.ts` as **future** wiring — every Agent A/B/C job file
contains comments like:

> "the pg-boss subscriber wiring lands later in the swimlane — for v1 the
> [foo] is what runs synchronously"

> "pg-boss server itself isn't bootstrapped in this codebase yet"

`grep "pg-boss" packages/*/package.json apps/*/package.json` returns nothing.
The package is **not installed**.

**Mitigation**: Insert a new Task D.0 before D.1.

#### Task D.0: Bootstrap pg-boss

**Effort:** ~2-3 hours.

**Files:**

- Modify: `apps/api/package.json` — add `pg-boss` dependency (latest stable)
- Modify: `apps/api/src/app.ts` — wire `boss.start()` after DB pool setup
- Modify: `apps/api/src/server.ts` (or shutdown hooks) — wire `boss.stop()`
- Create: `apps/api/src/lib/pg-boss-client.ts` — singleton boss instance + start/stop helpers
- Create: `apps/api/src/lib/pg-boss-client.test.ts` — smoke test (send + work)

**Steps:**

1. Add dependency:

   ```bash
   pnpm --filter @cpa/api add pg-boss
   ```

   Verify lockfile updated; check resolved version is current stable (10.x as of 2026).

2. Create singleton client:

   ```ts
   // apps/api/src/lib/pg-boss-client.ts
   import PgBoss from 'pg-boss';

   let bossInstance: PgBoss | null = null;

   export async function getBoss(): Promise<PgBoss> {
     if (bossInstance) return bossInstance;
     const connectionString =
       process.env.DATABASE_URL_BOSS ?? process.env.DATABASE_URL;
     if (!connectionString) throw new Error('DATABASE_URL not set for pg-boss');
     bossInstance = new PgBoss(connectionString);
     bossInstance.on('error', (err) => {
       // Route to Sentry if installed (T1.2 from P8 work)
       console.error('[pg-boss] error', err);
     });
     await bossInstance.start();
     return bossInstance;
   }

   export async function stopBoss(): Promise<void> {
     if (!bossInstance) return;
     await bossInstance.stop({ graceful: true });
     bossInstance = null;
   }
   ```

3. Wire into app boot in `apps/api/src/app.ts` (after DB pool setup):

   ```ts
   if (process.env.NODE_ENV !== 'test') {
     await getBoss();
   }
   ```

4. Wire shutdown in server signal handlers:

   ```ts
   process.on('SIGTERM', async () => {
     await stopBoss();
     await app.close();
   });
   ```

5. Smoke test:

   ```ts
   // apps/api/src/lib/pg-boss-client.test.ts
   import { test } from 'node:test';
   import assert from 'node:assert/strict';
   import { getBoss, stopBoss } from './pg-boss-client.js';

   test('pg-boss: send + work round-trip', async () => {
     const boss = await getBoss();
     try {
       const received = new Promise<{ payload: { hello: string } }>((resolve) => {
         boss.work('test-roundtrip', async ([job]) => {
           resolve({ payload: job.data as { hello: string } });
         });
       });
       await boss.send('test-roundtrip', { hello: 'world' });
       const result = await Promise.race([
         received,
         new Promise<never>((_, reject) =>
           setTimeout(() => reject(new Error('timeout')), 5000),
         ),
       ]);
       assert.equal(result.payload.hello, 'world');
     } finally {
       await stopBoss();
     }
   });
   ```

6. Verify pg-boss schema initialized (it creates a `pgboss` schema with its own tables on first `start()`):

   ```bash
   psql $DATABASE_URL -c "\\dt pgboss.*" | head -20
   ```

   Expected: at least `pgboss.job`, `pgboss.archive`, `pgboss.schedule`, `pgboss.version` tables exist.

7. Commit:

   ```bash
   git add apps/api/package.json apps/api/src/lib/pg-boss-client.ts \
           apps/api/src/lib/pg-boss-client.test.ts \
           apps/api/src/app.ts apps/api/src/server.ts pnpm-lock.yaml
   git commit -m "feat(api): bootstrap pg-boss for scheduled jobs (D.0)"
   ```

After D.0, Task D.9 can use `boss.schedule(...)` as the master plan describes.

### Gap 2: Migration index hole at 0039

**Master plan reservation** (P7 design doc lines 95-99):

```
0037_multi_cycle_narrative.sql       — Theme A
0038_prompt_suggestion_queue.sql     — Theme B
0039_audit_timeline_indices.sql      — Theme C: read-side indices
                                       (only if needed; mostly read-only)
0040a_compliance_capture.sql         — Theme D core
0040b_regulatory_intelligence.sql    — Theme D / RIF
```

**Reality**: Theme C task list (lines 722-810) does **not** include any
migration task. The C.1 timeline endpoint is read-only over existing tables;
no new indices declared mandatory. So `0039` will likely not be created.

**Mitigation**: Theme D executor must verify the Drizzle journal handles a
gap before picking migration numbers. Run before D.1:

```bash
cat packages/db/migrations/meta/_journal.json | tail -20
```

Inspect whether the journal entries are strictly sequential (forces a
renumber) or allow gaps (proceed with 0040a/0040b as the master plan
specifies). Document the choice in D.1's commit message.

If renumbering is required: use `0039a_compliance_capture.sql` and
`0039b_regulatory_intelligence.sql` instead. Update the master plan's
reservation table in a follow-up commit (or note in the D.15 PR body).

### Cross-theme dependencies (informational, not gaps)

- **Theme C ↔ Theme D**: Theme C's audit-timeline endpoint joins `multi_entity_similarity_score` via `to_regclass()` (returns empty until p7d lands per Theme C task description). When D.1 merges, the Theme C panel goes live. No code change required in Theme C.
- **Theme B ↔ Theme D**: Theme B's `prompt_suggestion` table is the target for D.11's webhook dispatch (insert with `source_kind='rif_event'`).
- **Theme D internal**: D.3's similarity scorer's corpus loader reads `regulatory_event` rows where `classification_kind IN ('aat_decision','art_decision')`. The `regulatory_event` table is created in D.8 (migration 0040b). The master plan only lists D.1 as D.3's dependency, but the test for `vs_historical_rejection` similarity_kind requires both schemas. Sequence: **D.1 → D.8 → D.3**.

## Pre-staged kickoff prompt

When Theme C's PR merges, copy this block into a fresh Claude session running
`gstack` or equivalent:

```
You are executing Theme D of the P7 plan: Compliance capture + Regulatory
Intelligence Feed. Use the superpowers:executing-plans skill.

WORKTREE
- Path: C:\Users\Aaron\cpa-platform-worktrees\p7d
- Branch: p7d/compliance-capture (CREATE this when starting; not yet exists)
- Base: latest origin/main (post-Theme-C-merge)

SETUP COMMANDS (run first)
  cd C:/Users/Aaron/cpa-platform
  git fetch origin main
  git worktree add C:/Users/Aaron/cpa-platform-worktrees/p7d \
    -b p7d/compliance-capture origin/main
  cd C:/Users/Aaron/cpa-platform-worktrees/p7d
  pnpm install
  pnpm -r typecheck   # verify clean baseline; no DB needed

PLAN
The implementation plan lives in the main repo at:
  C:\Users\Aaron\cpa-platform\docs\plans\2026-05-03-p7-implementation.md

Execute Tasks D.1 through D.15 in order (lines 814-1010 of that file).
Section 4.5 of docs\plans\2026-05-03-p7-design.md is the source of truth
for SQL/schema/prompt details — read in conjunction with each task.

PRE-FLIGHT CLARIFICATIONS — READ THIS FILE FIRST
  docs/plans/2026-05-05-p7d-kickoff-prep.md

Two significant gaps in the master plan that the Theme D executor must
handle:

(a) pg-boss is NOT installed — add Task D.0 before D.1 to bootstrap it.
    Detailed steps + smoke test in the kickoff-prep doc above.

(b) Migration numbering: Theme C didn't add migration 0039 (per Theme C's
    "no new tables" design). Theme D plan says 0040a/0040b. Verify the
    Drizzle journal handles the gap before picking — see kickoff-prep doc.

CRITICAL TASK NOTES (extracted from kickoff-prep doc)

- D.1 (compliance schema): GENERATED stored columns for ta_2023_4_flag and
  ta_2023_5_flag are non-trivial to test — verify the GENERATED expression
  behaves correctly under UPDATE.
- D.3 (similarity scorer): depends on D.8 too (corpus loader reads
  regulatory_event rows); the master plan only lists D.1 as dep but the
  test for "vs_historical_rejection similarity_kind" requires both schemas.
  Sequence D.1 → D.8 → D.3.
- D.7 (form-completeness contract test): the 15 Aug 2025 form fixture
  doesn't exist yet — capture it manually as part of this task and commit
  alongside.
- D.13 (source connectors): each connector needs a captured fixture
  (RSS XML / HTML snapshot) committed alongside. Capture once, commit,
  reuse in tests.

CONTEXT YOU MIGHT NEED

- Theme C's audit-timeline endpoint joins multi_entity_similarity_score
  via to_regclass() — D.1's migration activates that join. After D.1
  merges, Theme C's currently-empty similarity panel goes live.
- Theme B's prompt_suggestion table is the target for D.11's webhook
  dispatch (insert source_kind='rif_event' rows).
- Anthropic SDK is at packages/agents/src/anthropic-client.ts — see how
  Theme B's evaluator uses it as a reference for D.3 and D.10 agents.

PR
Open with title: feat(p7d): compliance capture + Regulatory Intelligence Feed
Body should note: "Multi-entity similarity scans run nightly via pg-boss
cron; Theme C's panel becomes live on merge."

ESTIMATED EFFORT: ~73-74 hours total (master plan said 71h; +2-3h for D.0
pg-boss bootstrap).

START
1. Run setup commands above
2. Read this kickoff-prep doc + Tasks D.0 (above), then D.1-D.15 from the
   plan file + Section 4.5 of the design doc
3. Begin Task D.0
```

## How to use this doc

1. **Wait** for Theme C's PR to merge into `main`
2. **Open** a fresh Claude session (the gstack browse tool is the user's
   preferred path; whatever Claude harness is fine)
3. **Copy** the "Pre-staged kickoff prompt" block above into the session as
   the first message
4. The session creates the `p7d` worktree, follows D.0 → D.1 → … → D.15,
   opens a PR

## Out of scope for this prep doc

This doc is a **kickoff helper**, not a redesign. It does not:

- Modify the master P7 implementation plan (Tasks D.1-D.15 stay as
  described). The plan itself is fine; only D.9's pg-boss assumption needs
  the D.0 prerequisite.
- Add any code or infrastructure (the executor does that).
- Spawn the parallel session itself (the user does that when ready).

If the gaps documented here turn out to be more substantial during
execution (e.g., pg-boss has changed API significantly in newer versions),
the executor should pause and discuss with the user rather than improvise.
