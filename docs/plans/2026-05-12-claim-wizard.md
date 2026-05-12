# Claim Preparation Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a 5-step guided wizard at `/claims/[claim_id]` for newly-created claims, composing existing evidence-upload, activity-proposal, attribution, narrative, and document-generation features into a sequential flow.

**Architecture:** Approach 3 (hybrid) — `claim.workflow_state` jsonb stores audit timestamps; `canAdvance` is a pure function computed live from data. Each step transition enqueues a pg-boss AI job. Legacy claims (NULL workflow_state) keep their existing tabbed page; wizard is opt-in via claim creation. See `docs/plans/2026-05-12-claim-wizard-design.md` for full rationale.

**Tech Stack:** Postgres + drizzle migrations, Fastify (API), pg-boss (job queue), React + Next.js 15 App Router, @tanstack/react-query, Zod for schema, node:test for unit tests, nock for HTTP mocking.

---

## Phase 0 — Pre-flight

### Task 0.1: Confirm clean working tree

**Step 1:** Run `git status` — expected: clean (only `bash.exe.stackdump` untracked).
**Step 2:** Run `git log -1 --oneline` — expected: `2420da2 docs(plans): claim preparation wizard — design`.
**Step 3:** If dirty, stash or commit before starting.

No commit.

---

## Phase 1 — Foundation (migration + Zod + pure logic)

The core state model + the pure functions that gate everything. TDD throughout.

### Task 1.1: Migration 0081 — `claim.workflow_state` column

**Files:**
- Create: `packages/db/migrations/0081_claim_workflow_state.sql`
- Modify: `packages/db/migrations/meta/_journal.json` (append entry idx=54)
- Modify: `packages/db/src/schema/claim.ts` (add `workflowState` jsonb column)

**Step 1:** Create the SQL:

```sql
-- Migration 0081: workflow_state jsonb on claim for wizard state.
--
-- Nullable: NULL = legacy claim (renders existing tabbed UI). Non-null = new
-- wizard claim. Shape validated at application layer by Zod (no jsonb_check).
--
-- Entry shape:
--   {
--     "initialized_at": "ISO-8601",
--     "steps": {
--       "1": null | { "agreed_at": "ISO", "agreed_by": "<user_uuid>" },
--       "2": null | { ... },
--       "3": null | { ... },
--       "4": null | { ... },
--       "5": null | { ... }
--     }
--   }
ALTER TABLE claim
  ADD COLUMN workflow_state jsonb;
```

**Step 2:** Append journal entry — read current `_journal.json` (last idx was 53 for `0080_portal_fields_history`). Add idx=54 for `0081_claim_workflow_state`. Use `Date.now()` from a temporary script or pick an ISO timestamp > the prior entry.

**Step 3:** Update drizzle schema — in `packages/db/src/schema/claim.ts`, add after the existing portal-fields-related columns:

```typescript
// Wizard workflow state (migration 0081). NULL = legacy claim (renders the
// existing tabbed UI); non-null = wizard claim. See
// docs/plans/2026-05-12-claim-wizard-design.md for shape.
workflowState: jsonb('workflow_state'),
```

**Step 4:** Verify build:

Run: `pnpm --filter @cpa/db build`
Expected: PASS

**Step 5:** Commit.

```bash
git add packages/db/migrations/0081_claim_workflow_state.sql \
        packages/db/migrations/meta/_journal.json \
        packages/db/src/schema/claim.ts
git commit -m "feat(db): migration 0081 — workflow_state jsonb on claim"
```

---

### Task 1.2: Zod `WorkflowState` schema

**Files:**
- Create: `packages/schemas/src/claim-workflow.ts`
- Create: `packages/schemas/src/claim-workflow.test.ts`
- Modify: `packages/schemas/src/index.ts` (re-export)

**Step 1:** Write failing test at `packages/schemas/src/claim-workflow.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowState, WorkflowStepNumber } from './claim-workflow.js';

test('WorkflowState accepts a fresh wizard state', () => {
  const r = WorkflowState.safeParse({
    initialized_at: '2026-05-12T00:00:00Z',
    steps: { '1': null, '2': null, '3': null, '4': null, '5': null },
  });
  assert.equal(r.success, true);
});

test('WorkflowState accepts a populated step', () => {
  const r = WorkflowState.safeParse({
    initialized_at: '2026-05-12T00:00:00Z',
    steps: {
      '1': { agreed_at: '2026-05-12T01:00:00Z', agreed_by: '00000000-0000-4000-8000-000000000001' },
      '2': null,
      '3': null,
      '4': null,
      '5': null,
    },
  });
  assert.equal(r.success, true);
});

test('WorkflowState rejects missing step keys', () => {
  const r = WorkflowState.safeParse({
    initialized_at: '2026-05-12T00:00:00Z',
    steps: { '1': null, '2': null }, // missing 3,4,5
  });
  assert.equal(r.success, false);
});

test('WorkflowStepNumber accepts 1..5 only', () => {
  for (const n of [1, 2, 3, 4, 5]) assert.equal(WorkflowStepNumber.safeParse(n).success, true);
  assert.equal(WorkflowStepNumber.safeParse(0).success, false);
  assert.equal(WorkflowStepNumber.safeParse(6).success, false);
});
```

**Step 2:** Run: `pnpm --filter @cpa/schemas test --grep claim-workflow`
Expected: FAIL — module not found.

**Step 3:** Write minimal implementation at `packages/schemas/src/claim-workflow.ts`:

```typescript
import { z } from 'zod';

export const WorkflowStepNumber = z.number().int().min(1).max(5);
export type WorkflowStepNumber = z.infer<typeof WorkflowStepNumber>;

export const WorkflowStepEntry = z.object({
  agreed_at: z.string(),
  agreed_by: z.string().uuid(),
});
export type WorkflowStepEntry = z.infer<typeof WorkflowStepEntry>;

export const WorkflowState = z.object({
  initialized_at: z.string(),
  steps: z.object({
    '1': WorkflowStepEntry.nullable(),
    '2': WorkflowStepEntry.nullable(),
    '3': WorkflowStepEntry.nullable(),
    '4': WorkflowStepEntry.nullable(),
    '5': WorkflowStepEntry.nullable(),
  }),
});
export type WorkflowState = z.infer<typeof WorkflowState>;
```

**Step 4:** Re-export from `packages/schemas/src/index.ts`: add `export * from './claim-workflow.js';`.

**Step 5:** Run: `pnpm --filter @cpa/schemas test --grep claim-workflow`
Expected: PASS (4 tests).

**Step 6:** Commit.

```bash
git add packages/schemas/src/claim-workflow.ts packages/schemas/src/claim-workflow.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): WorkflowState Zod schema for claim wizard"
```

---

### Task 1.3: `canAdvance` pure function — happy path tests

**Files:**
- Create: `apps/api/src/lib/workflow.ts`
- Create: `apps/api/src/lib/workflow.test.ts`

**Step 1:** Write failing tests at `apps/api/src/lib/workflow.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAdvance, type WorkflowSnapshot } from './workflow.js';

const empty: WorkflowSnapshot = {
  eventsClassified: 0,
  proposedActivitiesPending: 0,
  proposedActivitiesTotal: 0,
  agreedActivitiesTotal: 0,
  agreedActivitiesWithoutBinding: 0,
  narrativeSectionsApproved: 0,
};

test('canAdvance step 1 requires at least one classified event', () => {
  assert.equal(canAdvance(1, empty).ok, false);
  assert.equal(canAdvance(1, { ...empty, eventsClassified: 1 }).ok, true);
});

test('canAdvance step 2 requires all proposed activities resolved', () => {
  // some pending → blocked
  const r1 = canAdvance(2, { ...empty, proposedActivitiesTotal: 4, proposedActivitiesPending: 2 });
  assert.equal(r1.ok, false);
  // all resolved → allowed (even if zero proposed)
  const r2 = canAdvance(2, { ...empty, proposedActivitiesTotal: 4, proposedActivitiesPending: 0 });
  assert.equal(r2.ok, true);
});

test('canAdvance step 3 requires every agreed activity bound to evidence', () => {
  const r1 = canAdvance(3, { ...empty, agreedActivitiesTotal: 3, agreedActivitiesWithoutBinding: 1 });
  assert.equal(r1.ok, false);
  const r2 = canAdvance(3, { ...empty, agreedActivitiesTotal: 3, agreedActivitiesWithoutBinding: 0 });
  assert.equal(r2.ok, true);
});

test('canAdvance step 4 requires 4 approved narrative sections', () => {
  assert.equal(canAdvance(4, { ...empty, narrativeSectionsApproved: 3 }).ok, false);
  assert.equal(canAdvance(4, { ...empty, narrativeSectionsApproved: 4 }).ok, true);
});

test('canAdvance step 5 is terminal — always returns ok=false with terminal reason', () => {
  const r = canAdvance(5, empty);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /terminal/i);
});
```

**Step 2:** Run: `pnpm --filter @cpa/api test --test "src/lib/workflow.test.ts"` (or whatever the project's test invocation is)
Expected: FAIL — module not found.

**Step 3:** Write implementation at `apps/api/src/lib/workflow.ts`:

```typescript
/**
 * Pure-function gating logic for the claim wizard. Computes "can the
 * consultant advance from step N to N+1?" from a snapshot of underlying
 * data — no DB access here; the caller (the route handler) loads the
 * snapshot once and asks per step.
 *
 * Per Q5.b (revision flow), this is always computed live from current
 * data, so editing a prior step's data (e.g. adding new evidence) can
 * cause `canAdvance` on a later step to flip from ok=true back to
 * ok=false with a reason — the wizard surfaces this as a "data changed
 * since you last agreed" banner.
 */

export type WorkflowSnapshot = {
  eventsClassified: number;
  proposedActivitiesPending: number;
  proposedActivitiesTotal: number;
  agreedActivitiesTotal: number;
  agreedActivitiesWithoutBinding: number;
  narrativeSectionsApproved: number;
};

export type CanAdvanceResult = { ok: true } | { ok: false; reason: string };

export function canAdvance(step: 1 | 2 | 3 | 4 | 5, snap: WorkflowSnapshot): CanAdvanceResult {
  switch (step) {
    case 1:
      return snap.eventsClassified > 0
        ? { ok: true }
        : { ok: false, reason: 'Upload at least one piece of evidence to advance.' };
    case 2:
      return snap.proposedActivitiesPending === 0
        ? { ok: true }
        : {
            ok: false,
            reason: `${snap.proposedActivitiesPending} proposed activit${snap.proposedActivitiesPending === 1 ? 'y' : 'ies'} still pending — Agree or Reject each one.`,
          };
    case 3:
      return snap.agreedActivitiesWithoutBinding === 0
        ? { ok: true }
        : {
            ok: false,
            reason: `${snap.agreedActivitiesWithoutBinding} agreed activit${snap.agreedActivitiesWithoutBinding === 1 ? 'y has' : 'ies have'} no bound evidence yet.`,
          };
    case 4:
      return snap.narrativeSectionsApproved >= 4
        ? { ok: true }
        : {
            ok: false,
            reason: `Only ${snap.narrativeSectionsApproved} of 4 narrative sections approved.`,
          };
    case 5:
      return { ok: false, reason: 'Step 5 is terminal — no further advance.' };
  }
}
```

**Step 4:** Run: `pnpm --filter @cpa/api test --test "src/lib/workflow.test.ts"`
Expected: PASS (5 tests).

**Step 5:** Commit.

```bash
git add apps/api/src/lib/workflow.ts apps/api/src/lib/workflow.test.ts
git commit -m "feat(api): canAdvance pure function for claim wizard gating"
```

---

### Task 1.4: `applyAgree` / `applyReopen` reducers

**Files:**
- Modify: `apps/api/src/lib/workflow.ts`
- Modify: `apps/api/src/lib/workflow.test.ts`

**Step 1:** Append failing tests to `workflow.test.ts`:

```typescript
import { applyAgree, applyReopen, initialWorkflowState } from './workflow.js';

test('applyAgree writes timestamp + actor on the named step', () => {
  const state = initialWorkflowState('2026-05-12T00:00:00Z');
  const next = applyAgree(state, 2, '00000000-0000-4000-8000-000000000001', '2026-05-12T01:00:00Z');
  assert.equal(next.steps['2']?.agreed_at, '2026-05-12T01:00:00Z');
  assert.equal(next.steps['2']?.agreed_by, '00000000-0000-4000-8000-000000000001');
  // Untouched steps remain null
  assert.equal(next.steps['3'], null);
  // Pure: original untouched
  assert.equal(state.steps['2'], null);
});

test('applyReopen clears the named step (no cascade)', () => {
  const s0 = initialWorkflowState('2026-05-12T00:00:00Z');
  const s1 = applyAgree(s0, 2, '00000000-0000-4000-8000-000000000001', '2026-05-12T01:00:00Z');
  const s2 = applyAgree(s1, 3, '00000000-0000-4000-8000-000000000001', '2026-05-12T02:00:00Z');
  // Reopen step 2 — step 3 stays agreed (no cascade per Q5.b)
  const s3 = applyReopen(s2, 2);
  assert.equal(s3.steps['2'], null);
  assert.equal(s3.steps['3']?.agreed_at, '2026-05-12T02:00:00Z');
});

test('initialWorkflowState fills all five steps with null', () => {
  const s = initialWorkflowState('2026-05-12T00:00:00Z');
  for (const k of ['1', '2', '3', '4', '5'] as const) {
    assert.equal(s.steps[k], null);
  }
});
```

**Step 2:** Run tests — expected FAIL on import.

**Step 3:** Append to `workflow.ts`:

```typescript
import type { WorkflowState } from '@cpa/schemas';

export function initialWorkflowState(initializedAt: string): WorkflowState {
  return {
    initialized_at: initializedAt,
    steps: { '1': null, '2': null, '3': null, '4': null, '5': null },
  };
}

export function applyAgree(
  state: WorkflowState,
  step: 1 | 2 | 3 | 4 | 5,
  userId: string,
  now: string,
): WorkflowState {
  return {
    ...state,
    steps: {
      ...state.steps,
      [String(step)]: { agreed_at: now, agreed_by: userId },
    },
  };
}

export function applyReopen(state: WorkflowState, step: 1 | 2 | 3 | 4 | 5): WorkflowState {
  // No cascade per Q5.b — downstream steps keep their agreed_at; UI shows
  // a soft "data changed since" warning instead.
  return {
    ...state,
    steps: { ...state.steps, [String(step)]: null },
  };
}
```

**Step 4:** Run tests — expected PASS (8 tests total now).

**Step 5:** Commit.

```bash
git add apps/api/src/lib/workflow.ts apps/api/src/lib/workflow.test.ts
git commit -m "feat(api): applyAgree/applyReopen/initialWorkflowState reducers"
```

---

## Phase 2 — Server API

### Task 2.1: `loadWorkflowSnapshot` data loader

**Files:**
- Modify: `apps/api/src/lib/workflow.ts` (add the loader — keeps it discoverable next to canAdvance)
- Test deferred to integration in the route test (uses real SQL); skip a unit test here.

**Step 1:** Add to `workflow.ts`:

```typescript
import type postgres from 'postgres';

/**
 * Load the data points canAdvance needs for a given claim. Runs inside
 * RLS scope (caller MUST have set app.current_tenant_id first).
 *
 * One SQL round-trip via UNION ALL would be more efficient but five
 * targeted queries are clearer to debug and the wizard's GET endpoint
 * only fires on page-load + after each mutation, not in a hot path.
 */
export async function loadWorkflowSnapshot(
  sql: postgres.Sql,
  claimId: string,
): Promise<WorkflowSnapshot> {
  const [events] = await sql<[{ n: bigint }]>`
    SELECT COUNT(*)::bigint AS n FROM event
     WHERE subject_tenant_id IN (SELECT subject_tenant_id FROM claim WHERE id = ${claimId})
       AND kind IS NOT NULL
       AND kind != 'pending'
  `;
  const [proposed] = await sql<[{ total: bigint; pending: bigint }]>`
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE status = 'pending')::bigint AS pending
      FROM proposed_activity
     WHERE claim_id = ${claimId}
  `;
  const [agreed] = await sql<[{ total: bigint; without_binding: bigint }]>`
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (
             WHERE NOT EXISTS (
               SELECT 1 FROM artefact_link al
                WHERE al.activity_id = a.id AND al.artefact_kind = 'event'
             )
           )::bigint AS without_binding
      FROM activity a
     WHERE a.claim_id = ${claimId}
  `;
  const [narr] = await sql<[{ approved: bigint }]>`
    SELECT COUNT(DISTINCT section_kind)::bigint AS approved
      FROM narrative_draft
     WHERE claim_id = ${claimId}
       AND status   = 'approved'
  `;
  return {
    eventsClassified: Number(events.n),
    proposedActivitiesTotal: Number(proposed.total),
    proposedActivitiesPending: Number(proposed.pending),
    agreedActivitiesTotal: Number(agreed.total),
    agreedActivitiesWithoutBinding: Number(agreed.without_binding),
    narrativeSectionsApproved: Number(narr.approved),
  };
}
```

**Step 2:** Run `pnpm --filter @cpa/api typecheck` to confirm types resolve.
Expected: PASS (the pre-existing billing errors remain, ignore them).

**Step 3:** Commit.

```bash
git add apps/api/src/lib/workflow.ts
git commit -m "feat(api): loadWorkflowSnapshot — reads canAdvance inputs from DB"
```

---

### Task 2.2: POST `/v1/claims/:id/workflow/initialize` route

**Files:**
- Create: `apps/api/src/routes/claim-workflow.ts`
- Create: `apps/api/src/routes/claim-workflow.test.ts`
- Modify: `apps/api/src/app.ts` (register the new route module)

**Step 1:** Write the failing test:

```typescript
// apps/api/src/routes/claim-workflow.test.ts
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
// existing test harness helpers — match how narrative.test.ts wires up:
import { buildApp } from '../app.js';

beforeEach(() => {
  nock.cleanAll();
});

after(() => nock.cleanAll());

test('POST /workflow/initialize sets workflow_state on a fresh claim', async () => {
  // Use the existing test harness's tenant + claim fixture pattern.
  // The route returns the freshly-initialized state.
  // (Full fixture wiring — copy the pattern from narrative.test.ts at its top.)
  const app = buildApp({});
  // ... fixture setup omitted; mirror existing test patterns
  // expected: 200 with body.workflow_state.initialized_at being a recent ISO,
  // and steps 1..5 all null.
});
```

Note: in practice the route tests will need the existing fixture pattern; reference `apps/api/src/routes/narrative.test.ts` for the exact harness setup.

**Step 2:** Run tests — expected FAIL (test stub fails or imports break).

**Step 3:** Write the route at `apps/api/src/routes/claim-workflow.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '@cpa/db/client';
import { requireSession } from '@cpa/auth';
import { initialWorkflowState } from '../lib/workflow.js';

const Uuid = z.string().uuid();

export function registerClaimWorkflow(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>(
    '/v1/claims/:id/workflow/initialize',
    { preHandler: requireSession },
    async (req, reply) => {
      const role = req.user!.role;
      if (role !== 'admin' && role !== 'consultant') {
        return reply.status(403).send({ error: 'forbidden', requestId: req.id });
      }
      const tenantId = req.user!.tenantId!;
      const claimId = req.params.id;
      if (!Uuid.safeParse(claimId).success) {
        return reply.status(400).send({ error: 'invalid_claim_id', requestId: req.id });
      }
      const next = initialWorkflowState(new Date().toISOString());
      const rows = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return await tx<{ id: string }[]>`
          UPDATE claim
             SET workflow_state = ${JSON.stringify(next)}::text::jsonb,
                 updated_at     = NOW()
           WHERE id = ${claimId}
             AND tenant_id = ${tenantId}
             AND workflow_state IS NULL
           RETURNING id
        `;
      });
      if (rows.length === 0) {
        return reply.status(409).send({
          error: 'already_initialized_or_not_found',
          message: 'Claim already has workflow_state or does not exist in this firm.',
          requestId: req.id,
        });
      }
      return reply.status(200).send({ workflow_state: next });
    },
  );
}
```

**Step 4:** Register in `app.ts`:

```typescript
import { registerClaimWorkflow } from './routes/claim-workflow.js';
// ... in the registration block:
app.register((instance, _opts, done) => {
  registerClaimWorkflow(instance);
  done();
});
```

**Step 5:** Run tests + smoke via curl:

```bash
pnpm --filter @cpa/api test --test "src/routes/claim-workflow.test.ts"
```

Expected: PASS.

**Step 6:** Commit.

```bash
git add apps/api/src/routes/claim-workflow.ts apps/api/src/routes/claim-workflow.test.ts apps/api/src/app.ts
git commit -m "feat(api): POST /v1/claims/:id/workflow/initialize route"
```

---

### Task 2.3: POST `/workflow/step/:n/agree` route

**Files:**
- Modify: `apps/api/src/routes/claim-workflow.ts`
- Modify: `apps/api/src/routes/claim-workflow.test.ts`

**Step 1:** Add failing test — agree on step 1 requires ≥1 classified event; returns 409 if can't advance; writes timestamp on success.

**Step 2:** Append to the route file:

```typescript
import { applyAgree, loadWorkflowSnapshot, canAdvance } from '../lib/workflow.js';
import { WorkflowState, WorkflowStepNumber } from '@cpa/schemas';

const stepParam = z.coerce.number().pipe(WorkflowStepNumber);

app.post<{ Params: { id: string; n: string } }>(
  '/v1/claims/:id/workflow/step/:n/agree',
  { preHandler: requireSession },
  async (req, reply) => {
    const role = req.user!.role;
    if (role !== 'admin' && role !== 'consultant') {
      return reply.status(403).send({ error: 'forbidden', requestId: req.id });
    }
    const tenantId = req.user!.tenantId!;
    const userId = req.user!.id;
    const claimId = req.params.id;
    if (!Uuid.safeParse(claimId).success) {
      return reply.status(400).send({ error: 'invalid_claim_id', requestId: req.id });
    }
    const stepParsed = stepParam.safeParse(req.params.n);
    if (!stepParsed.success) {
      return reply.status(400).send({ error: 'invalid_step', requestId: req.id });
    }
    const step = stepParsed.data as 1 | 2 | 3 | 4 | 5;

    const result = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const rows = await tx<{ workflow_state: unknown }[]>`
        SELECT workflow_state FROM claim
         WHERE id = ${claimId} AND tenant_id = ${tenantId}
         LIMIT 1
      `;
      if (rows.length === 0) return { kind: 'not_found' as const };
      const parsed = WorkflowState.safeParse(rows[0]!.workflow_state);
      if (!parsed.success) return { kind: 'not_wizard' as const };
      const snapshot = await loadWorkflowSnapshot(tx, claimId);
      const advance = canAdvance(step, snapshot);
      if (!advance.ok) return { kind: 'cannot_advance' as const, reason: advance.reason };
      const next = applyAgree(parsed.data, step, userId, new Date().toISOString());
      await tx`
        UPDATE claim
           SET workflow_state = ${JSON.stringify(next)}::text::jsonb,
               updated_at     = NOW()
         WHERE id = ${claimId} AND tenant_id = ${tenantId}
      `;
      return { kind: 'ok' as const, state: next };
    });

    if (result.kind === 'not_found') {
      return reply.status(404).send({ error: 'claim_not_found', requestId: req.id });
    }
    if (result.kind === 'not_wizard') {
      return reply.status(400).send({
        error: 'not_a_wizard_claim',
        message: 'POST /workflow/initialize first.',
        requestId: req.id,
      });
    }
    if (result.kind === 'cannot_advance') {
      return reply.status(409).send({
        error: 'cannot_advance',
        message: result.reason,
        requestId: req.id,
      });
    }
    return reply.status(200).send({ workflow_state: result.state });
    // TODO Task 3.x — enqueue pg-boss AI job for step n+1 here.
  },
);
```

**Step 3:** Run tests — expected PASS.

**Step 4:** Commit.

```bash
git add apps/api/src/routes/claim-workflow.ts apps/api/src/routes/claim-workflow.test.ts
git commit -m "feat(api): POST /workflow/step/:n/agree with canAdvance gating"
```

---

### Task 2.4: POST `/workflow/step/:n/reopen` route

**Files:**
- Modify: `apps/api/src/routes/claim-workflow.ts`
- Modify: `apps/api/src/routes/claim-workflow.test.ts`

**Step 1:** Failing test — reopening step 2 clears its timestamp; step 3's timestamp remains.

**Step 2:** Append handler — mirrors agree but calls `applyReopen`. No `canAdvance` check; reopen is always allowed (Q5.b).

**Step 3:** PASS.

**Step 4:** Commit.

```bash
git add apps/api/src/routes/claim-workflow.ts apps/api/src/routes/claim-workflow.test.ts
git commit -m "feat(api): POST /workflow/step/:n/reopen (soft un-agree)"
```

---

### Task 2.5: GET `/workflow` route — returns state + derived canAdvance

**Files:**
- Modify: `apps/api/src/routes/claim-workflow.ts`
- Modify: `apps/api/src/routes/claim-workflow.test.ts`

**Step 1:** Failing test — GET returns `{ workflow_state, derived: { canAdvance: {1..5} } }`. Each value is `{ ok: true } | { ok: false, reason }`.

**Step 2:** Append handler — load state + snapshot, compute canAdvance for all 5 steps.

```typescript
app.get<{ Params: { id: string } }>(
  '/v1/claims/:id/workflow',
  { preHandler: requireSession },
  async (req, reply) => {
    // ... auth + uuid validation ...
    const result = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const rows = await tx<{ workflow_state: unknown }[]>`
        SELECT workflow_state FROM claim
         WHERE id = ${claimId} AND tenant_id = ${tenantId}
         LIMIT 1
      `;
      if (rows.length === 0) return { kind: 'not_found' as const };
      const parsed = WorkflowState.safeParse(rows[0]!.workflow_state);
      if (!parsed.success) return { kind: 'not_wizard' as const };
      const snap = await loadWorkflowSnapshot(tx, claimId);
      return {
        kind: 'ok' as const,
        state: parsed.data,
        derived: {
          canAdvance: {
            1: canAdvance(1, snap),
            2: canAdvance(2, snap),
            3: canAdvance(3, snap),
            4: canAdvance(4, snap),
            5: canAdvance(5, snap),
          },
        },
      };
    });
    // ... map kinds to status codes ...
    return reply.status(200).send({ workflow_state: result.state, derived: result.derived });
  },
);
```

**Step 3:** PASS.

**Step 4:** Commit.

```bash
git add apps/api/src/routes/claim-workflow.ts apps/api/src/routes/claim-workflow.test.ts
git commit -m "feat(api): GET /v1/claims/:id/workflow with derived canAdvance"
```

---

## Phase 3 — pg-boss jobs

### Task 3.1: `claim-activity-proposal` job (synthesize-register on agree of step 1)

**Files:**
- Create: `apps/api/src/jobs/claim-activity-proposal.ts`
- Modify: `apps/api/src/server.ts` (register the job)
- Modify: `apps/api/src/routes/claim-workflow.ts` (enqueue on step 1 agree)

**Step 1:** Mirror the structure of `apps/api/src/jobs/claim-finalisation.ts`. The handler:
1. Loads the claim + all classified events for its subject_tenant
2. Calls the existing `synthesize-register` agent (look at how it's used in existing routes for the exact call shape)
3. Inserts the produced `proposed_activity` rows

**Step 2:** Register cron-style at startup — actually no, this is a one-shot job per step-1 agree, NOT scheduled. Register the queue with a handler, then `boss.send('claim-activity-proposal', { claim_id })` from the route.

**Step 3:** In the step-1 agree handler from Task 2.3, after the successful update:

```typescript
const boss = await getBoss();
await boss.send('claim-activity-proposal', { claim_id: claimId, tenant_id: tenantId });
```

**Step 4:** Commit.

```bash
git add apps/api/src/jobs/claim-activity-proposal.ts \
        apps/api/src/server.ts \
        apps/api/src/routes/claim-workflow.ts
git commit -m "feat(api): claim-activity-proposal pg-boss job on step-1 agree"
```

---

### Task 3.2: `claim-evidence-binding` job (auto-allocator on agree of step 2)

**Files:**
- Create: `apps/api/src/jobs/claim-evidence-binding.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/claim-workflow.ts` (enqueue on step 2 agree)

**Step 1:** Handler: for each agreed activity in the claim, run `auto-allocator` against unbound events; insert suggested artefact_link rows with `auto_suggested = true` flag.

**Step 2:** Register + commit.

```bash
git add apps/api/src/jobs/claim-evidence-binding.ts apps/api/src/server.ts apps/api/src/routes/claim-workflow.ts
git commit -m "feat(api): claim-evidence-binding pg-boss job on step-2 agree"
```

---

## Phase 4 — Client-side API helpers

### Task 4.1: Workflow API client functions

**Files:**
- Create: `apps/web/src/app/claims/[claim_id]/_lib/workflow-client.ts`

**Step 1:** Implement:

```typescript
import { apiFetch } from '@/lib/api';
import type { WorkflowState } from '@cpa/schemas';

export type CanAdvance = { ok: true } | { ok: false; reason: string };
export type WorkflowResponse = {
  workflow_state: WorkflowState;
  derived: { canAdvance: Record<'1' | '2' | '3' | '4' | '5', CanAdvance> };
};

export async function getWorkflow(claimId: string): Promise<WorkflowResponse> {
  return apiFetch<WorkflowResponse>(`/v1/claims/${claimId}/workflow`);
}

export async function initializeWorkflow(claimId: string): Promise<{ workflow_state: WorkflowState }> {
  return apiFetch(`/v1/claims/${claimId}/workflow/initialize`, { method: 'POST' });
}

export async function agreeStep(claimId: string, step: 1 | 2 | 3 | 4 | 5): Promise<{ workflow_state: WorkflowState }> {
  return apiFetch(`/v1/claims/${claimId}/workflow/step/${step}/agree`, { method: 'POST' });
}

export async function reopenStep(claimId: string, step: 1 | 2 | 3 | 4 | 5): Promise<{ workflow_state: WorkflowState }> {
  return apiFetch(`/v1/claims/${claimId}/workflow/step/${step}/reopen`, { method: 'POST' });
}
```

**Step 2:** Commit.

```bash
git add apps/web/src/app/claims/[claim_id]/_lib/workflow-client.ts
git commit -m "feat(web): workflow API client functions"
```

---

## Phase 5 — UI vertical slice (Step 1 first)

### Task 5.1: `WizardStepper` component (the 5-dot progress strip)

**Files:**
- Create: `apps/web/src/app/claims/[claim_id]/_components/wizard-stepper.tsx`
- Create: `apps/web/src/app/claims/[claim_id]/_components/wizard-stepper.test.tsx`

**Step 1:** Failing test — renders 5 dots; the `currentStep`-indexed dot is highlighted; agreed steps have a tick.

**Step 2:** Implement:

```typescript
'use client';
import type { WorkflowState } from '@cpa/schemas';

const STEP_LABELS = [
  'Upload Evidence',
  'Review Activities',
  'Attribute Evidence',
  'Narrative & Timeline',
  'Generate Documents',
] as const;

export function WizardStepper({
  state,
  currentStep,
  onJumpTo,
}: {
  state: WorkflowState;
  currentStep: 1 | 2 | 3 | 4 | 5;
  onJumpTo?: (step: 1 | 2 | 3 | 4 | 5) => void;
}) {
  return (
    <ol className="flex items-center justify-between gap-2" data-testid="wizard-stepper">
      {STEP_LABELS.map((label, i) => {
        const stepNum = (i + 1) as 1 | 2 | 3 | 4 | 5;
        const agreed = state.steps[String(stepNum) as '1'] != null;
        const isCurrent = stepNum === currentStep;
        return (
          <li key={stepNum} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => onJumpTo?.(stepNum)}
              className={[
                'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium',
                agreed ? 'border-[hsl(var(--brand-green))] bg-[hsl(var(--brand-green))] text-white' :
                isCurrent ? 'border-[hsl(var(--brand-ink))] bg-[hsl(var(--brand-paper))]' :
                'border-[hsl(var(--brand-line))] bg-white text-[hsl(var(--brand-ink-subtle))]',
              ].join(' ')}
              data-testid={`wizard-stepper-${stepNum}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {agreed ? '✓' : stepNum}
            </button>
            <span className="text-sm">{label}</span>
            {i < 4 ? <span className="flex-1 border-t border-[hsl(var(--brand-line))]" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
```

**Step 3:** PASS.

**Step 4:** Commit.

```bash
git add apps/web/src/app/claims/[claim_id]/_components/wizard-stepper.tsx \
        apps/web/src/app/claims/[claim_id]/_components/wizard-stepper.test.tsx
git commit -m "feat(web): WizardStepper component for 5-dot progress strip"
```

---

### Task 5.2: `WizardStep1_UploadEvidence` shell

**Files:**
- Create: `apps/web/src/app/claims/[claim_id]/_components/wizard-step-1-upload.tsx`

**Step 1:** Wraps the existing `<UploadEvidenceButton />` + `<EventFeed />` from the subject-tenant components. Reads `subject_tenant_id` from the claim. Displays a "Next: Review Activities →" button enabled when `canAdvance.1.ok === true`.

**Step 2:** Implement skeleton (no test — visual smoke covers it; logic is in the lib).

**Step 3:** Commit.

```bash
git add apps/web/src/app/claims/[claim_id]/_components/wizard-step-1-upload.tsx
git commit -m "feat(web): WizardStep1 — upload evidence shell"
```

---

### Task 5.3: `ClaimWizardPage` orchestrator + URL routing

**Files:**
- Modify: `apps/web/src/app/claims/[claim_id]/page.tsx` (branch: wizard vs legacy)
- Create: `apps/web/src/app/claims/[claim_id]/_components/claim-wizard-page.tsx`

**Step 1:** Branch logic in `page.tsx`:

```typescript
const claim = useQuery({ queryKey: ['claim', claimId], queryFn: () => getClaim(claimId) });
// ...
if (claim.data?.workflow_state) {
  return <ClaimWizardPage claimId={claimId} />;
}
// else: existing tabbed view
```

**Step 2:** `ClaimWizardPage`:
- Reads `?step=N` from `useSearchParams`; defaults to lowest unagreed step
- Calls `getWorkflow(claimId)` via useQuery
- Renders `<WizardStepper />` + the active `<WizardStep[N] />`
- Provides `onJumpTo` to update `?step=N` via `router.push`

**Step 3:** Commit.

```bash
git add apps/web/src/app/claims/[claim_id]/page.tsx \
        apps/web/src/app/claims/[claim_id]/_components/claim-wizard-page.tsx
git commit -m "feat(web): ClaimWizardPage + URL routing"
```

---

## Phase 6 — UI for Steps 2-5

Each step is a separate task; pattern same as Step 1.

### Task 6.1: `WizardStep2_ReviewActivities` + `AgreeRejectButtons`

Wraps existing `<PendingNarrativePanel />` + new `<AgreeRejectButtons />` per `<ProposedActivityCard />`. "Agree all remaining" button at panel bottom calls per-card mutations in series (or with `Promise.allSettled` for parallel).

**Commit:** `feat(web): WizardStep2 — review & agree to proposed activities`

### Task 6.2: `WizardStep3_AttributeEvidence`

Per-activity panel showing bound events; "Add evidence" opens `<BindToActivityButton />`. Auto-allocator suggestions show as a "Suggested" badge that consultant clicks to accept.

**Commit:** `feat(web): WizardStep3 — attribute evidence to activities`

### Task 6.3: `WizardStep4_ReviewNarrative` split-pane

Left: `<NarrativeStream />`. Right: `<FiscalYearTimeline />`. Per-section Agree buttons that PATCH narrative_draft status to 'approved'.

**Commit:** `feat(web): WizardStep4 — narrative + timeline split-pane`

### Task 6.4: `WizardStep5_GenerateDocuments`

"Generate all" button fans out POSTs to portal-fields + claim-pdf. Status list with download links.

**Commit:** `feat(web): WizardStep5 — generate submission documents`

---

## Phase 7 — Wire-up + creation flow

### Task 7.1: Auto-initialize workflow on claim creation

**Files:**
- Modify: `apps/web/src/app/claims/_components/create-claim-button.tsx` (or wherever claims are created)

**Step 1:** After successful POST `/v1/claims`, call `initializeWorkflow(newClaim.id)` then navigate to `/claims/{id}?step=1`.

**Step 2:** Commit.

```bash
git commit -m "feat(web): auto-initialize workflow on claim creation"
```

---

### Task 7.2: Soft-warning banner for stale steps

In each step component, when `derived.canAdvance.N.ok === false` AND `workflow_state.steps[N].agreed_at !== null`, show a yellow banner: "Last agreed at {agreed_at}. Data changed since — review and re-Agree." This implements Q5.b.

**Commit:** `feat(web): stale-step soft-warning banners (Q5.b)`

---

### Task 7.3: Full happy-path manual smoke

Run the full flow: create a claim → upload 2 docs → wait classify → agree step 1 → wait synthesize-register → agree all activities → wait auto-allocator → step 3 confirm bindings → step 4 wait narrative → agree sections → step 5 generate all → download.

Document any rough edges in `docs/retros/2026-05-12-claim-wizard-smoke.md`.

**Commit:** `docs(retros): claim-wizard happy-path smoke notes`

---

## Phase 8 — Final pass

### Task 8.1: Typecheck + lint + push

```bash
pnpm --filter @cpa/api typecheck
pnpm --filter @cpa/web typecheck
pnpm --filter @cpa/schemas typecheck
pnpm --filter @cpa/api test
pnpm --filter @cpa/web test
git push origin main
```

Expected: all clean (the pre-existing `billing-*` typecheck errors remain; they are out of scope).

---

## Notes for the implementer

- **TDD discipline:** every Phase 1-2 task is test-first. Phase 5-7 UI shells can be visual-smoke only since the heavy logic lives in the route + lib layer.
- **Frequent commits:** each task ends in a commit. Don't batch.
- **Reuse existing components.** The 44 web components from the original snapshot already exist. Search for them before creating new ones (`grep -l 'export.*ComponentName' apps/web/src`).
- **The two pre-existing typecheck errors in `billing-webhook.ts` and `billing.ts` are not in scope.** Don't fix them here; they're tracked in the WIP snapshot's TODO list.
- **The `getBoss()` singleton in `apps/api/src/lib/pg-boss-client.ts`** already exists — use it for the two new job queues; don't construct a new PgBoss instance.
- **RLS:** every SQL query inside `sql.begin()` MUST set `app.current_tenant_id` first. See the existing routes for the pattern. Forgetting this means cross-tenant data leaks.
- **Lint:** `Array.isArray(x)` narrows to `any[]`, not `unknown[]` — assign to a typed local first if eslint complains.

---

**End of plan.** ~25 commits across 8 phases. Estimated 1-2 working days for an engineer with the design pre-read.
