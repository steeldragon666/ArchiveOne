# A-endpoints Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Ship four routes (GET list, POST map / apportion / unmap) that activate the existing expenditure-mapping UI end-to-end, with the event chain as single source of truth and an on-read projection deriving `current_mapping`.

**Architecture:** A new `EXPENDITURE_UNMAPPED` event kind joins the existing `EXPENDITURE_MAPPED` and `EXPENDITURE_APPORTIONED` kinds. Four Fastify routes write to the chain via `insertEventWithChain`; a server-side projection helper walks events in SQL (for the GET list) or in pure TS (for unit/parity tests). RLS scopes every read and write via the `cpa_app` role + `app.current_tenant_id` GUC.

**Tech Stack:** Fastify, Drizzle ORM, postgres-js, Zod, node:test.

**Design doc:** `docs/plans/2026-05-21-a-endpoints-design.md`

**Branch:** `feat/a-endpoints` off `main`. Do **not** stack on `feat/evidence-tab` or `feat/vps-staging-deployment`. Create the worktree first:

```bash
git worktree add ../cpa-platform-a-endpoints -b feat/a-endpoints origin/main
cd ../cpa-platform-a-endpoints
pnpm install
```

---

## Task 1: Add `EXPENDITURE_UNMAPPED` to the event-kind enums

**Files:**
- Modify: `packages/db/src/schema/event.ts` (add to `EVIDENCE_KINDS` after `EXPENDITURE_APPORTIONED`)
- Modify: `packages/schemas/src/event.ts` (mirror in `evidenceKind` enum at the same position)

**Step 1: Add to `@cpa/db`**

In `packages/db/src/schema/event.ts`, find `'EXPENDITURE_APPORTIONED',` and add immediately after:

```ts
  // P5 Theme 5 Task 5.3 — emitted by POST /v1/expenditures/:id/unmap when
  // a consultant explicitly clears a current mapping. Payload:
  //   { expenditure_id, prior_activity_id?, unmapped_by_user_id, reason? }
  // The event_kind_valid CHECK is rebuilt to admit it by
  // 00NN_expenditure_unmapped_kind.sql; this list tracks the CHECK byte-for-byte.
  'EXPENDITURE_UNMAPPED',
```

**Step 2: Mirror in `@cpa/schemas`**

In `packages/schemas/src/event.ts`, find `'EXPENDITURE_APPORTIONED',` and add immediately after:

```ts
  // P5 Theme 5 Task 5.3 — emitted by POST /v1/expenditures/:id/unmap.
  // The CHECK is rebuilt by 00NN_expenditure_unmapped_kind.sql to admit it;
  // this Zod enum tracks the same set.
  'EXPENDITURE_UNMAPPED',
```

**Step 3: Verify the parity test recognises the change**

The migration hasn't been added yet — at this point the schemas are in sync with each other but ahead of the DB CHECK. That's fine; we'll catch up in Task 2.

Run: `pnpm --filter @cpa/db test --test-name-pattern="EVIDENCE_KINDS parity"`
Expected: PASS (parity test compares the two TS sources, not the DB).

**Step 4: Commit**

```bash
git add packages/db/src/schema/event.ts packages/schemas/src/event.ts
git commit -m "feat(schemas): add EXPENDITURE_UNMAPPED event kind to both EVIDENCE_KINDS sources"
```

---

## Task 2: Migration that admits `EXPENDITURE_UNMAPPED` on the chain CHECK

**Files:**
- Create: `packages/db/migrations/0085_expenditure_unmapped_kind.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

**Step 1: Find the most recent journal idx**

```bash
tail -10 packages/db/migrations/meta/_journal.json
```

The last entry should be `0084_backfill_cpa_app_grants` at idx 57. The new migration is idx 58, file `0085_expenditure_unmapped_kind.sql`.

**Step 2: Write the migration**

Use `0025_expenditure_apportioned_kind.sql` as a template (read it first to mirror its exact shape). Create `packages/db/migrations/0085_expenditure_unmapped_kind.sql`:

```sql
-- Admit EXPENDITURE_UNMAPPED on the event_kind_valid CHECK.
--
-- Mirrors the pattern from 0024/0025 — drop the old CHECK, add a new
-- one with the expanded set. Idempotent via IF EXISTS / IF NOT EXISTS.

ALTER TABLE "event" DROP CONSTRAINT IF EXISTS "event_kind_valid";
--> statement-breakpoint

ALTER TABLE "event"
  ADD CONSTRAINT "event_kind_valid" CHECK (kind IN (
    -- (paste the complete current allowlist from the prior CHECK + 'EXPENDITURE_UNMAPPED')
  ));
```

**Important:** The body of the `IN (...)` clause must exactly match the full set of kinds in `packages/db/src/schema/event.ts`'s `EVIDENCE_KINDS` array (now with `EXPENDITURE_UNMAPPED` included). Cross-check both — any drift here breaks the parity test.

**Step 3: Register the migration in the journal**

In `packages/db/migrations/meta/_journal.json`, after the `0084_backfill_cpa_app_grants` entry:

```json
,
{
  "idx": 58,
  "version": "7",
  "when": 1779000000000,
  "tag": "0085_expenditure_unmapped_kind",
  "breakpoints": true
}
```

**Step 4: Apply the migration locally**

```bash
pnpm --filter @cpa/db migrate
```

Expected: `migrations applied`

**Step 5: Sanity check**

```bash
psql "$DATABASE_URL" -c "INSERT INTO event (id, tenant_id, subject_tenant_id, kind, payload, hash, captured_at, received_at) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'EXPENDITURE_UNMAPPED', '{}'::jsonb, 'h', now(), now())"
```

Expected: either succeeds (good) or fails with FK violation on tenant_id (also good — the CHECK passed; the FK fail is from the placeholder UUID). What you do NOT want to see: `check constraint "event_kind_valid"`.

**Step 6: Commit**

```bash
git add packages/db/migrations/0085_expenditure_unmapped_kind.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): migration 0085 — admit EXPENDITURE_UNMAPPED on event_kind_valid"
```

---

## Task 3: Server-side projection — pure-logic helper + unit tests

**Files:**
- Create: `apps/api/src/lib/expenditure-projection.ts`
- Create: `apps/api/src/lib/expenditure-projection.test.ts`

**Step 1: Define the input/output types and pure function**

```ts
// apps/api/src/lib/expenditure-projection.ts

/**
 * Server-side projection of the EXPENDITURE_* event chain into
 * a current_mapping shape per expenditure.
 *
 * Mirror of apps/web/src/app/claims/[claim_id]/_lib/expenditure-projection.ts
 * — a parity test asserts identical output for the same input chain.
 *
 * The chain is the system of record; this helper just walks events in
 * captured_at DESC order and picks the latest parent-level mapping
 * event. EXPENDITURE_LINE_MAPPED is out of scope (line-level granularity
 * is a separate concern).
 */

export interface SingleMapping {
  kind: 'single';
  activity_id: string;
  activity_code: string;
  activity_title: string;
}

export interface ApportionedMapping {
  kind: 'apportioned';
  allocations: Array<{
    activity_id: string;
    activity_code: string;
    activity_title: string;
    percentage: number;
  }>;
}

export type CurrentMapping = SingleMapping | ApportionedMapping | null;

/**
 * Input event shape for the projection. Only the fields the projection
 * actually reads — keeps the helper testable without dragging the full
 * `event` row schema in.
 */
export interface MappingChainEvent {
  kind: 'EXPENDITURE_MAPPED' | 'EXPENDITURE_APPORTIONED' | 'EXPENDITURE_UNMAPPED';
  payload: Record<string, unknown>;
  captured_at: string; // ISO8601
  id: string;          // tiebreaker for same-instant events
}

/**
 * Walk events for ONE expenditure and return the current mapping.
 * Caller must pre-filter events by expenditure_id.
 */
export function projectMapping(events: MappingChainEvent[]): CurrentMapping {
  if (events.length === 0) return null;
  // Latest first by (captured_at, id) — descending.
  const sorted = [...events].sort((a, b) => {
    if (a.captured_at !== b.captured_at) return a.captured_at < b.captured_at ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
  const latest = sorted[0]!;
  if (latest.kind === 'EXPENDITURE_UNMAPPED') return null;
  if (latest.kind === 'EXPENDITURE_MAPPED') {
    const p = latest.payload;
    return {
      kind: 'single',
      activity_id: String(p['activity_id']),
      activity_code: String(p['activity_code']),
      activity_title: String(p['activity_title']),
    };
  }
  // EXPENDITURE_APPORTIONED
  const allocations = (latest.payload['allocations'] as Array<Record<string, unknown>>) ?? [];
  return {
    kind: 'apportioned',
    allocations: allocations.map((a) => ({
      activity_id: String(a['activity_id']),
      activity_code: String(a['activity_code']),
      activity_title: String(a['activity_title']),
      percentage: Number(a['percentage']),
    })),
  };
}
```

**Step 2: Write 6 unit tests**

```ts
// apps/api/src/lib/expenditure-projection.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectMapping, type MappingChainEvent } from './expenditure-projection.js';

const ev = (
  kind: MappingChainEvent['kind'],
  payload: Record<string, unknown>,
  at: string,
  id: string,
): MappingChainEvent => ({ kind, payload, captured_at: at, id });

test('projectMapping: empty event list returns null', () => {
  assert.equal(projectMapping([]), null);
});

test('projectMapping: single MAPPED → single-kind mapping', () => {
  const out = projectMapping([
    ev('EXPENDITURE_MAPPED',
       { activity_id: 'a1', activity_code: 'CA-001', activity_title: 'Activity 1' },
       '2026-05-01T00:00:00Z', 'e1'),
  ]);
  assert.deepEqual(out, {
    kind: 'single',
    activity_id: 'a1',
    activity_code: 'CA-001',
    activity_title: 'Activity 1',
  });
});

test('projectMapping: MAPPED → APPORTIONED → apportioned wins', () => {
  const out = projectMapping([
    ev('EXPENDITURE_MAPPED',
       { activity_id: 'a1', activity_code: 'CA-001', activity_title: 'Activity 1' },
       '2026-05-01T00:00:00Z', 'e1'),
    ev('EXPENDITURE_APPORTIONED',
       { allocations: [
         { activity_id: 'a1', activity_code: 'CA-001', activity_title: 'Activity 1', percentage: 60 },
         { activity_id: 'a2', activity_code: 'CA-002', activity_title: 'Activity 2', percentage: 40 },
       ]},
       '2026-05-02T00:00:00Z', 'e2'),
  ]);
  assert.equal(out?.kind, 'apportioned');
  if (out?.kind === 'apportioned') assert.equal(out.allocations.length, 2);
});

test('projectMapping: APPORTIONED → MAPPED → single wins', () => {
  const out = projectMapping([
    ev('EXPENDITURE_APPORTIONED',
       { allocations: [
         { activity_id: 'a1', activity_code: 'CA-001', activity_title: 'A1', percentage: 50 },
         { activity_id: 'a2', activity_code: 'CA-002', activity_title: 'A2', percentage: 50 },
       ]},
       '2026-05-01T00:00:00Z', 'e1'),
    ev('EXPENDITURE_MAPPED',
       { activity_id: 'a3', activity_code: 'CA-003', activity_title: 'A3' },
       '2026-05-02T00:00:00Z', 'e2'),
  ]);
  assert.equal(out?.kind, 'single');
  if (out?.kind === 'single') assert.equal(out.activity_id, 'a3');
});

test('projectMapping: MAPPED → UNMAPPED → null', () => {
  const out = projectMapping([
    ev('EXPENDITURE_MAPPED',
       { activity_id: 'a1', activity_code: 'CA-001', activity_title: 'A1' },
       '2026-05-01T00:00:00Z', 'e1'),
    ev('EXPENDITURE_UNMAPPED', { prior_activity_id: 'a1' }, '2026-05-02T00:00:00Z', 'e2'),
  ]);
  assert.equal(out, null);
});

test('projectMapping: latest by (captured_at, id) wins regardless of input order', () => {
  // Three MAPPED events at same instant, different ids — highest id wins.
  const out = projectMapping([
    ev('EXPENDITURE_MAPPED', { activity_id: 'a1', activity_code: 'CA-001', activity_title: 'A1' },
       '2026-05-01T00:00:00Z', 'e1'),
    ev('EXPENDITURE_MAPPED', { activity_id: 'a3', activity_code: 'CA-003', activity_title: 'A3' },
       '2026-05-01T00:00:00Z', 'e3'),
    ev('EXPENDITURE_MAPPED', { activity_id: 'a2', activity_code: 'CA-002', activity_title: 'A2' },
       '2026-05-01T00:00:00Z', 'e2'),
  ]);
  assert.equal(out?.kind, 'single');
  if (out?.kind === 'single') assert.equal(out.activity_id, 'a3');
});
```

**Step 3: Run tests**

Run: `pnpm --filter @cpa/api test -- --test-name-pattern="projectMapping"`
Expected: 6 PASS

**Step 4: Commit**

```bash
git add apps/api/src/lib/expenditure-projection.ts apps/api/src/lib/expenditure-projection.test.ts
git commit -m "feat(api): expenditure-projection — pure-logic projectMapping + 6 unit tests"
```

---

## Task 4: Parity test against client projection

**Files:**
- Create: `apps/api/src/lib/expenditure-projection-parity.test.ts`

**Step 1: Inspect the client projection's exported API**

```bash
cat apps/web/src/app/claims/[claim_id]/_lib/expenditure-projection.ts | head -80
```

You're looking for: the function name(s), input event shape, output shape. The client side may differ in field names — the parity test bridges those.

**Step 2: Write the parity test**

```ts
// apps/api/src/lib/expenditure-projection-parity.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectMapping as serverProject } from './expenditure-projection.js';
// Adjust the import path to match the client-side projection's actual export.
// If the client-side function takes a different shape, write a small adapter
// here that maps server's MappingChainEvent → client's expected input.
import {
  projectMappingFromEvents as clientProject,
} from '../../../../apps/web/src/app/claims/[claim_id]/_lib/expenditure-projection.js';

// Three synthetic chains covering the projection's behavior surface.
// CHAIN 1: only MAPPED events
// CHAIN 2: only APPORTIONED events
// CHAIN 3: mixed — MAPPED, APPORTIONED, UNMAPPED, in non-trivial order

const a = { id: 'a1', code: 'CA-001', title: 'Activity 1' };
const b = { id: 'a2', code: 'CA-002', title: 'Activity 2' };

const CHAINS = [
  // CHAIN 1: only MAPPED
  [
    { kind: 'EXPENDITURE_MAPPED' as const,
      payload: { activity_id: a.id, activity_code: a.code, activity_title: a.title },
      captured_at: '2026-05-01T00:00:00Z', id: 'e1' },
    { kind: 'EXPENDITURE_MAPPED' as const,
      payload: { activity_id: b.id, activity_code: b.code, activity_title: b.title },
      captured_at: '2026-05-02T00:00:00Z', id: 'e2' },
  ],
  // CHAIN 2: only APPORTIONED
  [
    { kind: 'EXPENDITURE_APPORTIONED' as const,
      payload: { allocations: [
        { activity_id: a.id, activity_code: a.code, activity_title: a.title, percentage: 70 },
        { activity_id: b.id, activity_code: b.code, activity_title: b.title, percentage: 30 },
      ]},
      captured_at: '2026-05-01T00:00:00Z', id: 'e1' },
  ],
  // CHAIN 3: mixed
  [
    { kind: 'EXPENDITURE_MAPPED' as const,
      payload: { activity_id: a.id, activity_code: a.code, activity_title: a.title },
      captured_at: '2026-05-01T00:00:00Z', id: 'e1' },
    { kind: 'EXPENDITURE_APPORTIONED' as const,
      payload: { allocations: [
        { activity_id: a.id, activity_code: a.code, activity_title: a.title, percentage: 50 },
        { activity_id: b.id, activity_code: b.code, activity_title: b.title, percentage: 50 },
      ]},
      captured_at: '2026-05-02T00:00:00Z', id: 'e2' },
    { kind: 'EXPENDITURE_UNMAPPED' as const,
      payload: { prior_activity_id: a.id },
      captured_at: '2026-05-03T00:00:00Z', id: 'e3' },
  ],
];

for (const [idx, chain] of CHAINS.entries()) {
  test(`projection parity: chain ${idx + 1}`, () => {
    const serverOut = serverProject(chain);
    // Adapt the chain to the client's input shape if needed (see step 1).
    const clientOut = clientProject(chain as never);
    assert.deepEqual(serverOut, clientOut,
      `server and client projections diverged on chain ${idx + 1}`);
  });
}
```

**Step 3: Run the test**

Run: `pnpm --filter @cpa/api test -- --test-name-pattern="projection parity"`
Expected: 3 PASS

**If the import or shape diverges from the client**, this is a real finding — either the client projection needs to be refactored to share types (preferred), or document the divergence in the test file and explain why parity isn't possible. Do NOT silently change either side's behavior to force parity.

**Step 4: Commit**

```bash
git add apps/api/src/lib/expenditure-projection-parity.test.ts
git commit -m "test(api): expenditure projection — parity test vs client implementation"
```

---

## Task 5: API test scaffold (seed + 401)

**Files:**
- Create: `apps/api/src/routes/expenditures.test.ts`

**Step 1: Set up the seed harness**

```ts
// apps/api/src/routes/expenditures.test.ts
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../app.js';

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';

// Namespace 0e000... for expenditures-tab tests.
const TENANT = '00000000-0000-4000-8000-0000000e1001';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000e1002';
const USER = '00000000-0000-4000-8000-0000000e1010';
const SUBJECT = '00000000-0000-4000-8000-0000000e1021';
const OTHER_SUBJECT = '00000000-0000-4000-8000-0000000e1022';
const PROJECT = '00000000-0000-4000-8000-0000000e1031';
const CLAIM = '00000000-0000-4000-8000-0000000e1041';
const OTHER_CLAIM = '00000000-0000-4000-8000-0000000e1042';
const ACTIVITY_CA = '00000000-0000-4000-8000-0000000e1051';
const ACTIVITY_SA = '00000000-0000-4000-8000-0000000e1052';
const ACTIVITY_OTHER_CLAIM = '00000000-0000-4000-8000-0000000e1053';
const E1 = '00000000-0000-4000-8000-0000000e1061'; // unmapped
const E2 = '00000000-0000-4000-8000-0000000e1062'; // pre-mapped to ACTIVITY_CA
const E3 = '00000000-0000-4000-8000-0000000e1063'; // pre-apportioned across both
const E_VOIDED = '00000000-0000-4000-8000-0000000e1064'; // voided
const E_OTHER_TENANT = '00000000-0000-4000-8000-0000000e1065'; // RLS control

const cleanup = async (): Promise<void> => {
  await privilegedSql`DELETE FROM event WHERE tenant_id IN (${TENANT}, ${OTHER_TENANT})`;
  await privilegedSql`DELETE FROM expenditure WHERE tenant_id IN (${TENANT}, ${OTHER_TENANT})`;
  await privilegedSql`DELETE FROM activity WHERE tenant_id IN (${TENANT}, ${OTHER_TENANT})`;
  await privilegedSql`DELETE FROM claim WHERE tenant_id IN (${TENANT}, ${OTHER_TENANT})`;
  await privilegedSql`DELETE FROM project WHERE tenant_id IN (${TENANT}, ${OTHER_TENANT})`;
  await privilegedSql`DELETE FROM subject_tenant WHERE tenant_id IN (${TENANT}, ${OTHER_TENANT})`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id IN (${TENANT}, ${OTHER_TENANT})`;
  await sql`DELETE FROM "user" WHERE id = ${USER}`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT}, ${OTHER_TENANT})`;
};

before(async () => {
  await cleanup();
  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT}, 'Firm A Exp', 'firm-a-exp', 'mixed'),
                   (${OTHER_TENANT}, 'Firm B Exp', 'firm-b-exp', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${USER}, 'user-exp@example.com', 'microsoft', 'ms:exp', 'Exp User')`;
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role)
                      VALUES (gen_random_uuid(), ${TENANT}, ${USER}, 'admin')`;
  await privilegedSql`INSERT INTO subject_tenant (id, tenant_id, name)
                      VALUES (${SUBJECT}, ${TENANT}, 'Test Claimant'),
                             (${OTHER_SUBJECT}, ${OTHER_TENANT}, 'Other Tenant Claimant')`;
  await privilegedSql`INSERT INTO project (id, tenant_id, subject_tenant_id, name, started_at)
                      VALUES (${PROJECT}, ${TENANT}, ${SUBJECT}, 'Test Project', now())`;
  await privilegedSql`INSERT INTO claim (id, tenant_id, subject_tenant_id, project_id, fiscal_year, stage)
                      VALUES (${CLAIM}, ${TENANT}, ${SUBJECT}, ${PROJECT}, 2026, 'engagement'),
                             (${OTHER_CLAIM}, ${TENANT}, ${SUBJECT}, ${PROJECT}, 2025, 'engagement')`;
  // Activities — first two in CLAIM, third in OTHER_CLAIM (for cross-claim 404 test).
  await privilegedSql`INSERT INTO activity (id, tenant_id, project_id, claim_id, kind, code, name, hypothesis, technical_uncertainty, expected_outcome)
                      VALUES (${ACTIVITY_CA}, ${TENANT}, ${PROJECT}, ${CLAIM}, 'core', 'CA-001', 'Activity One', 'h', 'u', 'o'),
                             (${ACTIVITY_SA}, ${TENANT}, ${PROJECT}, ${CLAIM}, 'supporting', 'SA-001', 'Supporting', 'h', 'u', 'o'),
                             (${ACTIVITY_OTHER_CLAIM}, ${TENANT}, ${PROJECT}, ${OTHER_CLAIM}, 'core', 'CA-002', 'Other Claim Activity', 'h', 'u', 'o')`;
  // Expenditures
  await privilegedSql`INSERT INTO expenditure (id, tenant_id, subject_tenant_id, claim_id, source, vendor_name, expenditure_date, total_amount, currency)
                      VALUES (${E1},        ${TENANT}, ${SUBJECT}, ${CLAIM}, 'manual', 'Vendor 1', '2026-04-01', 100.00, 'AUD'),
                             (${E2},        ${TENANT}, ${SUBJECT}, ${CLAIM}, 'manual', 'Vendor 2', '2026-04-02', 200.00, 'AUD'),
                             (${E3},        ${TENANT}, ${SUBJECT}, ${CLAIM}, 'manual', 'Vendor 3', '2026-04-03', 300.00, 'AUD'),
                             (${E_VOIDED},  ${TENANT}, ${SUBJECT}, ${CLAIM}, 'manual', 'Voided',   '2026-04-04', 400.00, 'AUD'),
                             (${E_OTHER_TENANT}, ${OTHER_TENANT}, ${OTHER_SUBJECT}, NULL, 'manual', 'Cross Tenant', '2026-04-05', 500.00, 'AUD')`;
  await privilegedSql`UPDATE expenditure SET voided_at = now() WHERE id = ${E_VOIDED}`;
  // Seed chain events: E2 pre-mapped to ACTIVITY_CA, E3 pre-apportioned 60/40.
  // Use direct INSERT (not insertEventWithChain) — we only need the rows, not the hash chain integrity.
  await privilegedSql`
    INSERT INTO event (id, tenant_id, subject_tenant_id, kind, payload, hash, captured_at, received_at)
    VALUES
      (gen_random_uuid(), ${TENANT}, ${SUBJECT}, 'EXPENDITURE_MAPPED',
       jsonb_build_object('expenditure_id', ${E2}, 'activity_id', ${ACTIVITY_CA}, 'activity_code', 'CA-001', 'activity_title', 'Activity One'),
       encode(sha256('seed-e2'::bytea), 'hex'), now(), now()),
      (gen_random_uuid(), ${TENANT}, ${SUBJECT}, 'EXPENDITURE_APPORTIONED',
       jsonb_build_object('expenditure_id', ${E3}, 'allocations',
         jsonb_build_array(
           jsonb_build_object('activity_id', ${ACTIVITY_CA}, 'activity_code', 'CA-001', 'activity_title', 'Activity One', 'percentage', 60),
           jsonb_build_object('activity_id', ${ACTIVITY_SA}, 'activity_code', 'SA-001', 'activity_title', 'Supporting', 'percentage', 40))),
       encode(sha256('seed-e3'::bytea), 'hex'), now(), now())
  `;
});

after(async () => {
  await cleanup();
  await sql.end();
  await privilegedSql.end();
});

const userJwt = (): Promise<string> =>
  signSession(
    {
      sub: USER,
      email: 'user-exp@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: TENANT,
      activeRole: 'admin',
      availableTenants: [
        { tenantId: TENANT, name: 'Firm A Exp', slug: 'firm-a-exp', role: 'admin' },
      ],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

test('GET /v1/claims/:id/expenditures: 401 without session', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: `/v1/claims/${CLAIM}/expenditures` });
  assert.equal(res.statusCode, 401);
  await app.close();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @cpa/api test -- --test-name-pattern="GET /v1/claims/.*/expenditures"`
Expected: FAIL — route not registered (404 not 401, or 401 from a different code path)

**Step 3: Commit**

```bash
git add apps/api/src/routes/expenditures.test.ts
git commit -m "test(api): expenditures scaffold + seed + first 401 case"
```

---

## Task 6: GET list route + 4 tests (list, filter modes, RLS)

**Files:**
- Create: `apps/api/src/routes/expenditures.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/expenditures.test.ts` (append tests)

**Step 1: Implement the GET route**

```ts
// apps/api/src/routes/expenditures.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { projectMapping, type MappingChainEvent, type CurrentMapping } from '../lib/expenditure-projection.js';

const listQuery = z.object({
  filter: z.enum(['all', 'unmapped', 'mapped']).default('all'),
});

interface ExpenditureRow {
  id: string;
  vendor_name: string;
  reference: string | null;
  expenditure_date: Date;
  total_amount: string;
  currency: string;
  source: string;
  voided_at: Date | null;
}

interface MappingEventRow {
  expenditure_id: string;
  kind: MappingChainEvent['kind'];
  payload: Record<string, unknown>;
  captured_at: Date;
  id: string;
}

export function registerExpenditureRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/expenditures',
    { preHandler: requireSession },
    async (req, reply) => {
      const parsed = listQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid_query',
          message: parsed.error.issues.map((i) => i.message).join('; '),
          requestId: req.id,
        });
      }
      const { filter } = parsed.data;
      const claimId = req.params.id;

      const expRows = await sql<ExpenditureRow[]>`
        SELECT id::text, vendor_name, reference, expenditure_date, total_amount::text, currency, source, voided_at
        FROM expenditure
        WHERE claim_id = ${claimId}
      `;

      if (expRows.length === 0) {
        return reply.send({ expenditures: [] });
      }

      const expIds = expRows.map((r) => r.id);
      const eventRows = await sql<MappingEventRow[]>`
        SELECT
          (payload->>'expenditure_id')::text AS expenditure_id,
          kind,
          payload,
          captured_at,
          id::text
        FROM event
        WHERE kind IN ('EXPENDITURE_MAPPED', 'EXPENDITURE_APPORTIONED', 'EXPENDITURE_UNMAPPED')
          AND (payload->>'expenditure_id') = ANY(${expIds})
      `;

      // Group events by expenditure_id, project each.
      const byExp = new Map<string, MappingChainEvent[]>();
      for (const ev of eventRows) {
        const list = byExp.get(ev.expenditure_id) ?? [];
        list.push({
          kind: ev.kind,
          payload: ev.payload,
          captured_at: ev.captured_at.toISOString(),
          id: ev.id,
        });
        byExp.set(ev.expenditure_id, list);
      }

      const expenditures = expRows.map((r) => {
        const current_mapping: CurrentMapping = projectMapping(byExp.get(r.id) ?? []);
        return {
          id: r.id,
          vendor_name: r.vendor_name,
          reference: r.reference,
          expenditure_date: r.expenditure_date.toISOString().split('T')[0],
          total_amount: r.total_amount,
          currency: r.currency,
          source: r.source,
          voided_at: r.voided_at?.toISOString() ?? null,
          current_mapping,
        };
      });

      const filtered = expenditures.filter((e) => {
        if (filter === 'unmapped') return e.current_mapping === null;
        if (filter === 'mapped') return e.current_mapping !== null;
        return true;
      });

      return reply.send({ expenditures: filtered });
    },
  );
}
```

**Step 2: Register in `app.ts`**

In `apps/api/src/app.ts`, near other `register*Routes` calls:

```ts
import { registerExpenditureRoutes } from './routes/expenditures.js';
// ...
registerExpenditureRoutes(app);
```

**Step 3: Append 4 tests**

```ts
test('GET /v1/claims/:id/expenditures: returns all 3 with correct current_mapping', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM}/expenditures`,
    cookies: { cpa_session: await userJwt() },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { expenditures: Array<{ id: string; current_mapping: unknown }> };
  // 4 rows: E1, E2, E3, E_VOIDED (all in CLAIM)
  assert.equal(body.expenditures.length, 4);
  const e1 = body.expenditures.find((e) => e.id === E1);
  const e2 = body.expenditures.find((e) => e.id === E2);
  const e3 = body.expenditures.find((e) => e.id === E3);
  assert.equal(e1?.current_mapping, null);
  assert.equal((e2?.current_mapping as { kind: string })?.kind, 'single');
  assert.equal((e3?.current_mapping as { kind: string })?.kind, 'apportioned');
  await app.close();
});

test('GET /v1/claims/:id/expenditures?filter=unmapped: returns only E1 + E_VOIDED', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM}/expenditures?filter=unmapped`,
    cookies: { cpa_session: await userJwt() },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { expenditures: Array<{ id: string }> };
  const ids = body.expenditures.map((e) => e.id).sort();
  assert.deepEqual(ids, [E1, E_VOIDED].sort());
});

test('GET /v1/claims/:id/expenditures?filter=mapped: returns E2 + E3', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM}/expenditures?filter=mapped`,
    cookies: { cpa_session: await userJwt() },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { expenditures: Array<{ id: string }> };
  const ids = body.expenditures.map((e) => e.id).sort();
  assert.deepEqual(ids, [E2, E3].sort());
});

test('GET /v1/claims/:id/expenditures: RLS isolation — other tenant invisible', async () => {
  const app = buildApp();
  // Try to read OTHER_CLAIM (in our tenant — visible) — should return empty.
  // Try to read a claim under OTHER_TENANT — would 404 if it existed; we use the cross-tenant expenditure check instead.
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM}/expenditures`,
    cookies: { cpa_session: await userJwt() },
  });
  const body = res.json() as { expenditures: Array<{ id: string }> };
  const ids = body.expenditures.map((e) => e.id);
  assert.ok(!ids.includes(E_OTHER_TENANT), 'cross-tenant expenditure must not appear');
});
```

**Step 4: Run tests**

Run: `pnpm --filter @cpa/api test -- --test-name-pattern="GET /v1/claims/.*/expenditures"`
Expected: 5 PASS (incl. the 401 test from Task 5)

**Step 5: Commit**

```bash
git add apps/api/src/routes/expenditures.ts apps/api/src/app.ts apps/api/src/routes/expenditures.test.ts
git commit -m "feat(api): GET /v1/claims/:id/expenditures with on-read projection + filter"
```

---

## Task 7: POST :id/map route + 3 tests (success, cross-claim 404, idempotent)

**Files:**
- Modify: `apps/api/src/routes/expenditures.ts` (append route)
- Modify: `apps/api/src/routes/expenditures.test.ts` (append tests)

**Step 1: Implement the route**

```ts
// Append to expenditures.ts (inside registerExpenditureRoutes)

import { insertEventWithChain } from '@cpa/db';

// ... existing GET ...

const mapBody = z.object({
  activity_id: z.string().uuid(),
});

app.post<{ Params: { id: string }; Body: { activity_id: string } }>(
  '/v1/expenditures/:id/map',
  { preHandler: requireSession },
  async (req, reply) => {
    const parsed = mapBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_body',
        message: parsed.error.issues.map((i) => i.message).join('; '),
      });
    }
    const expId = req.params.id;
    const { activity_id } = parsed.data;

    // Look up expenditure + voided check + claim_id.
    const expRows = await sql<{ id: string; claim_id: string | null; subject_tenant_id: string; voided_at: Date | null }[]>`
      SELECT id::text, claim_id::text, subject_tenant_id::text, voided_at
      FROM expenditure WHERE id = ${expId}
    `;
    if (expRows.length === 0) {
      return reply.status(404).send({ error: 'expenditure_not_found', message: 'Expenditure not found' });
    }
    const exp = expRows[0]!;
    if (exp.voided_at) {
      return reply.status(409).send({ error: 'expenditure_voided', message: 'Cannot map a voided expenditure' });
    }

    // Activity must belong to same claim.
    const actRows = await sql<{ id: string; code: string; name: string; claim_id: string }[]>`
      SELECT id::text, code, name, claim_id::text FROM activity WHERE id = ${activity_id}
    `;
    if (actRows.length === 0 || actRows[0]!.claim_id !== exp.claim_id) {
      return reply.status(404).send({
        error: 'activity_not_in_claim',
        message: 'Activity does not belong to this claim',
      });
    }
    const act = actRows[0]!;

    // Idempotency: is the latest mapping event already this same activity?
    const latestRows = await sql<{ kind: string; payload: Record<string, unknown>; id: string }[]>`
      SELECT kind, payload, id::text
      FROM event
      WHERE kind IN ('EXPENDITURE_MAPPED','EXPENDITURE_APPORTIONED','EXPENDITURE_UNMAPPED')
        AND (payload->>'expenditure_id') = ${expId}
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    `;
    const latest = latestRows[0];
    if (latest && latest.kind === 'EXPENDITURE_MAPPED' && latest.payload['activity_id'] === activity_id) {
      // Idempotent — return existing event.
      return reply.send({ event: { id: latest.id, kind: latest.kind, payload: latest.payload } });
    }

    const payload = {
      expenditure_id: expId,
      activity_id,
      activity_code: act.code,
      activity_title: act.name,
    };
    const ev = await insertEventWithChain({
      tenantId: req.user!.tenantId!,
      subjectTenantId: exp.subject_tenant_id,
      kind: 'EXPENDITURE_MAPPED',
      payload,
      capturedByUserId: req.user!.id,
    });
    return reply.send({ event: ev });
  },
);
```

**Step 2: Append 3 tests**

```ts
test('POST /v1/expenditures/:id/map: 200, emits EXPENDITURE_MAPPED, projection reflects', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/expenditures/${E1}/map`,
    cookies: { cpa_session: await userJwt() },
    payload: { activity_id: ACTIVITY_SA },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { event: { kind: string; payload: { activity_id: string } } };
  assert.equal(body.event.kind, 'EXPENDITURE_MAPPED');
  assert.equal(body.event.payload.activity_id, ACTIVITY_SA);
  await app.close();
});

test('POST /v1/expenditures/:id/map: 404 when activity in different claim', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/expenditures/${E1}/map`,
    cookies: { cpa_session: await userJwt() },
    payload: { activity_id: ACTIVITY_OTHER_CLAIM },
  });
  assert.equal(res.statusCode, 404);
  const body = res.json() as { error: string };
  assert.equal(body.error, 'activity_not_in_claim');
  await app.close();
});

test('POST /v1/expenditures/:id/map: idempotent re-map returns existing event', async () => {
  const app = buildApp();
  // E2 is already mapped to ACTIVITY_CA in the seed.
  const res = await app.inject({
    method: 'POST',
    url: `/v1/expenditures/${E2}/map`,
    cookies: { cpa_session: await userJwt() },
    payload: { activity_id: ACTIVITY_CA },
  });
  assert.equal(res.statusCode, 200);
  // No new event should have been inserted; verify by counting MAPPED events for E2.
  const evCount = await privilegedSql<{ count: string }[]>`
    SELECT count(*) FROM event WHERE kind = 'EXPENDITURE_MAPPED' AND (payload->>'expenditure_id') = ${E2}
  `;
  assert.equal(evCount[0]?.count, '1', 'no duplicate event written');
  await app.close();
});
```

**Step 3: Run tests**

Run: `pnpm --filter @cpa/api test -- --test-name-pattern="POST /v1/expenditures/.*/map"`
Expected: 3 PASS

**Step 4: Commit**

```bash
git add apps/api/src/routes/expenditures.ts apps/api/src/routes/expenditures.test.ts
git commit -m "feat(api): POST /v1/expenditures/:id/map with idempotency + same-claim check"
```

---

## Task 8: POST :id/apportion route + 2 tests (success + validation 400s)

**Files:**
- Modify: `apps/api/src/routes/expenditures.ts` (append)
- Modify: `apps/api/src/routes/expenditures.test.ts` (append)

**Step 1: Implement the route**

```ts
// Append to expenditures.ts

const apportionBody = z.object({
  allocations: z
    .array(
      z.object({
        activity_id: z.string().uuid(),
        percentage: z.number().positive(),
      }),
    )
    .min(1)
    .max(5)
    .refine(
      (a) => {
        const ids = a.map((x) => x.activity_id);
        return new Set(ids).size === ids.length;
      },
      { message: 'duplicate activity in allocation' },
    )
    .refine(
      (a) => Math.abs(a.reduce((s, x) => s + x.percentage, 0) - 100) < 0.001,
      { message: 'allocations must sum to 100 (±0.001)' },
    ),
});

app.post<{ Params: { id: string } }>(
  '/v1/expenditures/:id/apportion',
  { preHandler: requireSession },
  async (req, reply) => {
    const parsed = apportionBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_allocation',
        message: parsed.error.issues.map((i) => i.message).join('; '),
      });
    }
    const expId = req.params.id;
    const { allocations } = parsed.data;

    const expRows = await sql<{ id: string; claim_id: string | null; subject_tenant_id: string; voided_at: Date | null }[]>`
      SELECT id::text, claim_id::text, subject_tenant_id::text, voided_at FROM expenditure WHERE id = ${expId}
    `;
    if (expRows.length === 0) return reply.status(404).send({ error: 'expenditure_not_found', message: 'Expenditure not found' });
    const exp = expRows[0]!;
    if (exp.voided_at) return reply.status(409).send({ error: 'expenditure_voided', message: 'Cannot apportion a voided expenditure' });

    // Resolve all activities. They must all belong to the same claim.
    const actIds = allocations.map((a) => a.activity_id);
    const actRows = await sql<{ id: string; code: string; name: string; claim_id: string }[]>`
      SELECT id::text, code, name, claim_id::text FROM activity WHERE id = ANY(${actIds})
    `;
    if (actRows.length !== actIds.length || actRows.some((a) => a.claim_id !== exp.claim_id)) {
      return reply.status(404).send({
        error: 'activity_not_in_claim',
        message: 'One or more activities do not belong to this claim',
      });
    }
    const actById = new Map(actRows.map((a) => [a.id, a]));

    const payload = {
      expenditure_id: expId,
      allocations: allocations.map((a) => {
        const act = actById.get(a.activity_id)!;
        return {
          activity_id: a.activity_id,
          activity_code: act.code,
          activity_title: act.name,
          percentage: a.percentage,
        };
      }),
      mapped_by_user_id: req.user!.id,
    };
    const ev = await insertEventWithChain({
      tenantId: req.user!.tenantId!,
      subjectTenantId: exp.subject_tenant_id,
      kind: 'EXPENDITURE_APPORTIONED',
      payload,
      capturedByUserId: req.user!.id,
    });
    return reply.send({ event: ev });
  },
);
```

**Step 2: Append 2 tests**

```ts
test('POST /v1/expenditures/:id/apportion: 200, emits EXPENDITURE_APPORTIONED', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/expenditures/${E1}/apportion`,
    cookies: { cpa_session: await userJwt() },
    payload: {
      allocations: [
        { activity_id: ACTIVITY_CA, percentage: 70 },
        { activity_id: ACTIVITY_SA, percentage: 30 },
      ],
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { event: { kind: string; payload: { allocations: unknown[] } } };
  assert.equal(body.event.kind, 'EXPENDITURE_APPORTIONED');
  assert.equal(body.event.payload.allocations.length, 2);
  await app.close();
});

test('POST /v1/expenditures/:id/apportion: 400 on validation errors', async () => {
  const app = buildApp();
  const cases = [
    // sum ≠ 100
    [{ activity_id: ACTIVITY_CA, percentage: 50 }, { activity_id: ACTIVITY_SA, percentage: 30 }],
    // pct = 0
    [{ activity_id: ACTIVITY_CA, percentage: 100 }, { activity_id: ACTIVITY_SA, percentage: 0 }],
    // duplicate
    [{ activity_id: ACTIVITY_CA, percentage: 50 }, { activity_id: ACTIVITY_CA, percentage: 50 }],
    // length 0
    [],
  ];
  for (const allocations of cases) {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/expenditures/${E1}/apportion`,
      cookies: { cpa_session: await userJwt() },
      payload: { allocations },
    });
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(allocations)}`);
  }
  await app.close();
});
```

**Step 3: Run tests**

Run: `pnpm --filter @cpa/api test -- --test-name-pattern="POST /v1/expenditures/.*/apportion"`
Expected: 2 PASS

**Step 4: Commit**

```bash
git add apps/api/src/routes/expenditures.ts apps/api/src/routes/expenditures.test.ts
git commit -m "feat(api): POST /v1/expenditures/:id/apportion with sum/length/dupe validation"
```

---

## Task 9: POST :id/unmap route + 2 tests (success, 400 when not mapped)

**Files:**
- Modify: `apps/api/src/routes/expenditures.ts` (append)
- Modify: `apps/api/src/routes/expenditures.test.ts` (append)

**Step 1: Implement the route**

```ts
const unmapBody = z.object({
  reason: z.string().optional(),
});

app.post<{ Params: { id: string } }>(
  '/v1/expenditures/:id/unmap',
  { preHandler: requireSession },
  async (req, reply) => {
    const parsed = unmapBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_body',
        message: parsed.error.issues.map((i) => i.message).join('; '),
      });
    }
    const expId = req.params.id;
    const { reason } = parsed.data;

    const expRows = await sql<{ id: string; subject_tenant_id: string; voided_at: Date | null }[]>`
      SELECT id::text, subject_tenant_id::text, voided_at FROM expenditure WHERE id = ${expId}
    `;
    if (expRows.length === 0) return reply.status(404).send({ error: 'expenditure_not_found', message: 'Expenditure not found' });
    const exp = expRows[0]!;
    if (exp.voided_at) return reply.status(409).send({ error: 'expenditure_voided', message: 'Cannot unmap a voided expenditure' });

    // Check current mapping — error if already null.
    const latestRows = await sql<{ kind: string; payload: Record<string, unknown> }[]>`
      SELECT kind, payload FROM event
      WHERE kind IN ('EXPENDITURE_MAPPED','EXPENDITURE_APPORTIONED','EXPENDITURE_UNMAPPED')
        AND (payload->>'expenditure_id') = ${expId}
      ORDER BY captured_at DESC, id DESC LIMIT 1
    `;
    const latest = latestRows[0];
    if (!latest || latest.kind === 'EXPENDITURE_UNMAPPED') {
      return reply.status(400).send({ error: 'nothing_to_unmap', message: 'Expenditure is not currently mapped' });
    }

    const priorActivityId =
      latest.kind === 'EXPENDITURE_MAPPED'
        ? String(latest.payload['activity_id'])
        : undefined; // for apportioned we don't have a single prior_activity_id

    const payload: Record<string, unknown> = {
      expenditure_id: expId,
      unmapped_by_user_id: req.user!.id,
    };
    if (priorActivityId) payload['prior_activity_id'] = priorActivityId;
    if (reason) payload['reason'] = reason;

    const ev = await insertEventWithChain({
      tenantId: req.user!.tenantId!,
      subjectTenantId: exp.subject_tenant_id,
      kind: 'EXPENDITURE_UNMAPPED',
      payload,
      capturedByUserId: req.user!.id,
    });
    return reply.send({ event: ev });
  },
);
```

**Step 2: Append 2 tests**

```ts
test('POST /v1/expenditures/:id/unmap: 200, emits EXPENDITURE_UNMAPPED', async () => {
  const app = buildApp();
  // E2 is mapped in the seed.
  const res = await app.inject({
    method: 'POST',
    url: `/v1/expenditures/${E2}/unmap`,
    cookies: { cpa_session: await userJwt() },
    payload: { reason: 'wrong activity' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { event: { kind: string; payload: { prior_activity_id?: string; reason?: string } } };
  assert.equal(body.event.kind, 'EXPENDITURE_UNMAPPED');
  assert.equal(body.event.payload.prior_activity_id, ACTIVITY_CA);
  assert.equal(body.event.payload.reason, 'wrong activity');
  await app.close();
});

test('POST /v1/expenditures/:id/unmap: 400 when not currently mapped', async () => {
  const app = buildApp();
  // E1 has never been mapped.
  const res = await app.inject({
    method: 'POST',
    url: `/v1/expenditures/${E1}/unmap`,
    cookies: { cpa_session: await userJwt() },
    payload: {},
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { error: string };
  assert.equal(body.error, 'nothing_to_unmap');
  await app.close();
});
```

**Step 3: Run tests**

Run: `pnpm --filter @cpa/api test -- --test-name-pattern="POST /v1/expenditures/.*/unmap"`
Expected: 2 PASS

**Step 4: Commit**

```bash
git add apps/api/src/routes/expenditures.ts apps/api/src/routes/expenditures.test.ts
git commit -m "feat(api): POST /v1/expenditures/:id/unmap with current-mapping precondition"
```

---

## Task 10: Voided-expenditure 409 test (across all three mutation routes)

**Files:**
- Modify: `apps/api/src/routes/expenditures.test.ts` (append)

**Step 1: Append**

```ts
test('POST any mutation on voided expenditure → 409', async () => {
  const app = buildApp();
  const routes = [
    { url: `/v1/expenditures/${E_VOIDED}/map`, payload: { activity_id: ACTIVITY_CA } },
    {
      url: `/v1/expenditures/${E_VOIDED}/apportion`,
      payload: {
        allocations: [
          { activity_id: ACTIVITY_CA, percentage: 60 },
          { activity_id: ACTIVITY_SA, percentage: 40 },
        ],
      },
    },
    { url: `/v1/expenditures/${E_VOIDED}/unmap`, payload: {} },
  ];
  for (const r of routes) {
    const res = await app.inject({
      method: 'POST',
      url: r.url,
      cookies: { cpa_session: await userJwt() },
      payload: r.payload,
    });
    assert.equal(res.statusCode, 409, `expected 409 on ${r.url}`);
    const body = res.json() as { error: string };
    assert.equal(body.error, 'expenditure_voided');
  }
  await app.close();
});
```

**Step 2: Run all expenditure tests**

Run: `pnpm --filter @cpa/api test -- --test-name-pattern="/v1/(claims|expenditures)"`
Expected: all 13 PASS

**Step 3: Commit**

```bash
git add apps/api/src/routes/expenditures.test.ts
git commit -m "test(api): voided expenditure returns 409 on map/apportion/unmap"
```

---

## Task 11: Run full workspace verification + manual smoke

**Step 1: Full typecheck and lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: PASS on both.

**Step 2: All tests, all packages**

```bash
pnpm test
```

Expected: all PASS, including the EVIDENCE_KINDS parity test (which catches if `EXPENDITURE_UNMAPPED` wasn't mirrored in both files) and the expenditure-projection parity test (which catches client/server divergence).

**Step 3: Manual smoke via dev-login**

Use the dev-login cookie to authenticate, then exercise the four routes against your dev DB:

```bash
# (Assuming API is running locally on :3001 or via the deployed claimsure-mu.vercel.app)
COOKIE="cpa_session=<paste from dev-login>"
BASE="https://claimsure-mu.vercel.app"

# GET list
curl -s -b "$COOKIE" "$BASE/v1/claims/<some-real-claim-id>/expenditures" | jq .

# POST map
curl -s -b "$COOKIE" -X POST "$BASE/v1/expenditures/<exp-id>/map" \
  -H 'Content-Type: application/json' \
  -d '{"activity_id":"<activity-id>"}' | jq .

# POST apportion
curl -s -b "$COOKIE" -X POST "$BASE/v1/expenditures/<exp-id>/apportion" \
  -H 'Content-Type: application/json' \
  -d '{"allocations":[{"activity_id":"<a1>","percentage":60},{"activity_id":"<a2>","percentage":40}]}' | jq .

# POST unmap
curl -s -b "$COOKIE" -X POST "$BASE/v1/expenditures/<exp-id>/unmap" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"test"}' | jq .
```

Expected: each returns 200 with the expected event shape; subsequent GET reflects the mapping change.

**Step 4: Commit nothing here (no code changed); just record green status in PR body.**

---

## Task 12: Open the PR

**Step 1: Push**

```bash
git push -u origin feat/a-endpoints
```

**Step 2: Open**

```bash
gh pr create --title "feat: A-endpoints — expenditure map/apportion/unmap" --body "$(cat <<'EOF'
## Summary

Four new endpoints that activate the existing expenditure-mapping UI in `/claims/[claim_id]/`:

- `GET /v1/claims/:id/expenditures?filter=all|unmapped|mapped` — list with on-read projection.
- `POST /v1/expenditures/:id/map` — single-activity mapping, idempotent on re-map.
- `POST /v1/expenditures/:id/apportion` — multi-activity split, server-side sum/length/dupe validation.
- `POST /v1/expenditures/:id/unmap` — explicit clear (new `EXPENDITURE_UNMAPPED` event kind).

Design doc: `docs/plans/2026-05-21-a-endpoints-design.md`

## What's new

- New event kind `EXPENDITURE_UNMAPPED` (mirrored in `@cpa/db` + `@cpa/schemas`, migration `0085_expenditure_unmapped_kind.sql` rebuilds the CHECK).
- Server-side `expenditure-projection.ts` with parity test against the existing client-side projection.

## Test plan

- [ ] 13 integration tests pass (`pnpm --filter @cpa/api test`)
- [ ] 6 projection unit tests + 3 parity tests pass
- [ ] EVIDENCE_KINDS parity test stays green
- [ ] Full workspace `pnpm typecheck`, `pnpm lint`
- [ ] Manual smoke via dev-login against staging

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done

Acceptance per the design doc §10:

- 13 API integration tests pass ✓
- 6 projection unit tests pass ✓
- 3 parity tests pass ✓
- EVIDENCE_KINDS parity test stays green ✓
- `pnpm typecheck` + `pnpm lint` green ✓
- Manual smoke succeeds end-to-end ✓
