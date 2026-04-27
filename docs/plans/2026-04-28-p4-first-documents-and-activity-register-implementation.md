# P4 — First Documents & Activity Register — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** Ship Module 1 advanced (project + activity register CA/SA + technical uncertainty register + invoice cross-walk), Module 4 pipeline workflow, and Module 5 Tier A early (real Xero accounting integration; MYOB defers to P5), with three deterministic audit-defensible documents.

**Architecture:** New tables (project, claim, activity, expenditure, expenditure_line, expenditure_mapping_rule) layered on the existing P2 hash chain. 14 new evidence kinds for activity / artefact / expenditure / claim / document audit events. Generic 4-source expenditure ingestion (Xero invoices + bank tx + receipts + manual). Three deterministic PDFs generated on-demand from live data with content-hash logged on chain. Real Xero PKCE OAuth reusing P3's `@cpa/integrations/xero-payroll` scaffolding.

**Tech Stack:** TypeScript 5.6 strict + ESM · Drizzle ORM + postgres-js 3.4.9 · Fastify 5 · `@react-pdf/renderer` for PDFs · pg-boss for async sync jobs · `nock` for HTTP fixtures · Playwright e2e · `node:test` runner.

**Design doc:** [`./2026-04-28-p4-first-documents-and-activity-register-design.md`](./2026-04-28-p4-first-documents-and-activity-register-design.md)
**Builds on:** P0/P1/P2/P3 — main at `fa946f9`, tags `p0-foundation` / `p1-identity-tenancy` / `p2-event-capture` / `p3-mobile-scribe`.

**Working directory for all tasks:** `C:\Users\Aaron\cpa-platform-worktrees\p4` (branch `p4/foundation`).

**Discipline notes (apply to every task):**
- `@cpa/...` workspace imports; never relative paths across packages
- TypeScript strict + ESM with `.js` import suffix + verbatimModuleSyntax
- Tests use `tsx --env-file-if-exists=../../.env --test "src/**/*.test.ts"`
- Migrations: `pnpm --filter @cpa/db generate` then hand-author RLS portion; **never `generate` after a hand-edit on the same migration** (the DO-NOT-REGENERATE convention from migrations 0006/0008/0009/0010/0011)
- Per-test UUIDs (`crypto.randomUUID()`) for fixture isolation — the P9 hygiene improvement now applies to all new tests
- Conventional-commits + co-author trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- Commit per task; push at end of each phase

**Pillar verification:** every task advances ≥1 of the 5 Pillars in the omniscient spec — note in PR descriptions.

---

## Phasing overview

| Phase | Tasks | Calendar | Dependency |
|---|---|---|---|
| **Foundation** | F1–F12 | 1–2 weeks | main at fa946f9 |
| **Swimlane A — Evidence Engine** | A1–A10 | 2 weeks | Foundation |
| **Swimlane B — Xero + Expenditure** | B1–B12 | 3 weeks (parallel with A & C) | Foundation |
| **Swimlane C — Pipeline + Documents** | C1–C10 | 2 weeks (parallel with A & B) | Foundation |
| **Final — integration + e2e + docs** | D1–D6 | 1 week | A + B + C |

Total: ~6–8 weeks if swimlanes parallel; ~10–12 weeks sequential.

---

## Phase 0 — Setup

### Task 0.1: Verify worktree + dependencies + env

**Steps:**

1. `cd /c/Users/Aaron/cpa-platform-worktrees/p4 && git status` — confirm clean on `p4/foundation`
2. `pnpm install` — bring node_modules in sync with main
3. Verify Postgres + extensions: `docker compose up -d postgres && pnpm db:migrate` — should complete cleanly through migration 0011
4. Confirm CI baseline: `pnpm typecheck && pnpm lint && pnpm format:check` — all green from main

**No commit** — environment validation only.

### Task 0.2: Add Xero accounting env vars to `.env.example`

**Files:** Modify: `.env.example`

**Append:**
```
# Xero Accounting integration (P4 — Module 5 Tier A)
XERO_ACCOUNTING_CLIENT_ID=
XERO_ACCOUNTING_CLIENT_SECRET=
XERO_ACCOUNTING_REDIRECT_URI=http://localhost:3000/v1/integrations/xero-accounting/callback
# Implementation toggle: 'real' uses live Xero; 'stub' uses tests/fixtures/xero/*.json (CI default)
XERO_IMPL=stub
```

**Commit:** `chore(env): add Xero accounting env vars to .env.example`

---

## Foundation phase (F1–F12)

### Task F1: Drizzle schemas for `project`, `claim`, `activity` (migration 0012)

**Files:**
- Create: `packages/db/src/schema/project.ts`
- Create: `packages/db/src/schema/claim.ts`
- Create: `packages/db/src/schema/activity.ts`
- Modify: `packages/db/src/schema/index.ts` (re-export all 3)

**Approach:** Match the convention from P3 schemas (camelCase TS / snake_case SQL, `pgTable('table', { ... }, (t) => ({ indexes }))`). Use existing `tenant.id`, `subjectTenant.id`, `user.id` for FKs. Set FK column on existing `event` table to `activity` (currently `project_id` is the placeholder; add an optional `activity_id` later in F3 to avoid circular FK at table-build time).

**Schema details** — follow design doc §"Core tables".

**Steps:**

1. Read `packages/db/src/schema/event.ts` and `subject_tenant.ts` for the Drizzle conventions
2. Write `project.ts` — note `started_at NOT NULL`, `ended_at` and `archived_at` nullable
3. Write `claim.ts` — `UNIQUE (subject_tenant_id, fiscal_year)`; `stage text NOT NULL DEFAULT 'engagement'`
4. Write `activity.ts` — `UNIQUE (claim_id, code)`; `kind text` enum-like via CHECK
5. Re-export from `packages/db/src/schema/index.ts`
6. `pnpm --filter @cpa/db generate` — produces `0012_<adj>_<noun>.sql`
7. `pnpm --filter @cpa/db build && pnpm --filter @cpa/db typecheck` — clean
8. Commit: `feat(db): P4 schemas — project, claim, activity + migration 0012`

### Task F2: Hand-author RLS + CHECK for migration 0012

**Files:** Modify: `packages/db/migrations/0012_<...>.sql` (append block)

**Approach:** Same pattern as `0008_funny_kid_colt.sql` — `DO NOT REGENERATE` header, explicit RLS + CHECK + GRANT.

**Append at top of file:**
```sql
-- DO NOT REGENERATE THIS MIGRATION VIA `pnpm --filter @cpa/db generate`.
-- The block at the bottom is hand-authored: RLS policies + CHECK constraints + GRANT.
-- drizzle-kit will silently regenerate this file and clobber them.
```

**Append at bottom of file** — for each of `project`, `claim`, `activity`:

```sql
ALTER TABLE "project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project" FORCE ROW LEVEL SECURITY;
CREATE POLICY "project_tenant_isolation" ON "project"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "project" TO cpa_app;

-- (same pattern for claim, activity)

-- CHECK: activity.kind in valid set
ALTER TABLE "activity" ADD CONSTRAINT activity_kind_valid
  CHECK (kind IN ('core', 'supporting'));

-- CHECK: activity.code matches CA-### / SA-### pattern
ALTER TABLE "activity" ADD CONSTRAINT activity_code_format
  CHECK (code ~ '^(CA|SA)-[0-9]{2,3}$');

-- CHECK: claim.stage in canonical 7-stage enum
ALTER TABLE "claim" ADD CONSTRAINT claim_stage_valid
  CHECK (stage IN ('engagement', 'activity_capture', 'narrative_drafting',
                   'expenditure_schedule', 'review', 'submitted', 'audit_defence'));

-- CHECK: claim.fiscal_year in plausible range (matches AusIndustry FY-end-year convention)
ALTER TABLE "claim" ADD CONSTRAINT claim_fiscal_year_range
  CHECK (fiscal_year BETWEEN 2010 AND 2050);
```

**Steps:**
1. Apply migration to local DB: `pnpm db:migrate`
2. Verify in psql: `\dt+` shows the 3 tables, `\d+ activity` shows the CHECK constraints
3. Run `packages/db/src/rls.test.ts` — should still pass (this migration adds tables; isolation tested in F7)
4. Commit: `feat(db): RLS + CHECK constraints for project / claim / activity (0012)`

### Task F3: Drizzle schemas for `expenditure`, `expenditure_line`, `expenditure_mapping_rule` (migration 0013)

**Files:**
- Create: `packages/db/src/schema/expenditure.ts`
- Create: `packages/db/src/schema/expenditure_line.ts`
- Create: `packages/db/src/schema/expenditure_mapping_rule.ts`
- Modify: `packages/db/src/schema/index.ts` (re-export 3)

**Schema details** — follow design doc §"Core tables". Note partial unique on `expenditure (tenant_id, source, source_external_id) WHERE source_external_id IS NOT NULL`.

**Steps:**
1. Write the 3 schema files
2. Re-export
3. `pnpm --filter @cpa/db generate` — produces `0013_<adj>_<noun>.sql`
4. Build + typecheck — clean
5. Commit: `feat(db): expenditure schemas + migration 0013`

### Task F4: Hand-author RLS + CHECK for migration 0013

**Files:** Modify: `packages/db/migrations/0013_<...>.sql`

**Same DO-NOT-REGENERATE header + RLS pattern as F2.**

**CHECK constraints:**
```sql
ALTER TABLE "expenditure" ADD CONSTRAINT expenditure_source_valid
  CHECK (source IN ('xero_invoice', 'xero_bank_tx', 'xero_receipt', 'manual'));

ALTER TABLE "expenditure" ADD CONSTRAINT expenditure_currency_aud
  CHECK (currency = 'AUD');                              -- P4 scope; multi-currency is P9

ALTER TABLE "expenditure_line" ADD CONSTRAINT expenditure_line_rd_percent_range
  CHECK (rd_percent IS NULL OR (rd_percent >= 0 AND rd_percent <= 100));

ALTER TABLE "expenditure_mapping_rule" ADD CONSTRAINT mapping_rule_rd_percent_range
  CHECK (rd_percent >= 0 AND rd_percent <= 100);

-- Partial unique index (drizzle doesn't emit WHERE clause cleanly; do it manually):
CREATE UNIQUE INDEX expenditure_external_unique
  ON expenditure (tenant_id, source, source_external_id)
  WHERE source_external_id IS NOT NULL;
```

**Steps:**
1. Apply migration; verify in psql
2. Commit: `feat(db): RLS + CHECK constraints for expenditure tables (0013)`

### Task F5: Migration 0014 — extend `event.kind` enum with 14 new P4 kinds

**Files:**
- Create: `packages/db/migrations/0014_p4_evidence_kinds.sql` (hand-authored only — drizzle doesn't emit ENUM extensions cleanly for our text+CHECK shape)
- Modify: `packages/db/src/schema/event.ts` (extend `EVIDENCE_KINDS` array)

**Note:** Per migration 0006, the `event.kind` is `text` with a CHECK constraint listing valid values. So extending the kind enum = updating the CHECK constraint.

**Migration body:**
```sql
-- DO NOT REGENERATE THIS MIGRATION.
-- Hand-authored: extends event.kind CHECK with 14 P4 evidence kinds.

ALTER TABLE "event" DROP CONSTRAINT IF EXISTS event_kind_valid;

ALTER TABLE "event" ADD CONSTRAINT event_kind_valid CHECK (
  kind IN (
    'HYPOTHESIS', 'UNCERTAINTY', 'EXPERIMENT', 'OBSERVATION', 'ITERATION',
    'NEW_KNOWLEDGE', 'TIME_LOG', 'EXPENDITURE_NOTE', 'ASSOCIATE_FLAG',
    'INELIGIBLE', 'SUPPORTING', 'OVERRIDE',
    -- P4 additions:
    'ACTIVITY_CREATED', 'ACTIVITY_UPDATED', 'ACTIVITY_LOCKED',
    'ARTEFACT_LINKED', 'ARTEFACT_UNLINKED',
    'EXPENDITURE_INGESTED', 'EXPENDITURE_LINE_MAPPED', 'EXPENDITURE_LINE_UNMAPPED',
    'EXPENDITURE_VOIDED',
    'CLAIM_STAGE_ADVANCED', 'CLAIM_SUBMITTED',
    'PROJECT_CREATED', 'PROJECT_ARCHIVED',
    'DOCUMENT_GENERATED'
  )
);
```

**Schema update:**
```ts
// packages/db/src/schema/event.ts
export const EVIDENCE_KINDS = [
  // existing 12 P0–P3 kinds
  'HYPOTHESIS', 'UNCERTAINTY', 'EXPERIMENT', 'OBSERVATION', 'ITERATION',
  'NEW_KNOWLEDGE', 'TIME_LOG', 'EXPENDITURE_NOTE', 'ASSOCIATE_FLAG',
  'INELIGIBLE', 'SUPPORTING', 'OVERRIDE',
  // P4 additions:
  'ACTIVITY_CREATED', 'ACTIVITY_UPDATED', 'ACTIVITY_LOCKED',
  'ARTEFACT_LINKED', 'ARTEFACT_UNLINKED',
  'EXPENDITURE_INGESTED', 'EXPENDITURE_LINE_MAPPED', 'EXPENDITURE_LINE_UNMAPPED',
  'EXPENDITURE_VOIDED',
  'CLAIM_STAGE_ADVANCED', 'CLAIM_SUBMITTED',
  'PROJECT_CREATED', 'PROJECT_ARCHIVED',
  'DOCUMENT_GENERATED',
] as const;
```

**Steps:**
1. Hand-author the migration file
2. Update the schema constant
3. Append the migration to `packages/db/migrations/meta/_journal.json` with idx 14 + new `tag: '0014_p4_evidence_kinds'`
4. Apply: `pnpm db:migrate`
5. Verify: `psql -c "SELECT consrc FROM pg_constraint WHERE conname='event_kind_valid'"` — shows all 26 kinds
6. Commit: `feat(db): extend event.kind CHECK with 14 P4 evidence kinds (0014)`

### Task F6: chain.ts canonicaliser — backward-compat verification + new-kinds tests

**Files:**
- Modify: `packages/db/src/chain.test.ts` (add 4 new tests)

**Goal:** Confirm `canonicaliseEvent` produces byte-identical output for existing P0–P3 events; verify new event kinds hash deterministically; verify `verifyChain` still passes for mixed sequences.

**New tests to add to chain.test.ts:**

```ts
test('canonicaliseEvent: P4 kinds produce stable hash', () => {
  const e = canonicaliseEvent({
    subject_tenant_id: 'a', kind: 'ACTIVITY_CREATED',
    payload: { activity_id: 'act-1', code: 'CA-01', kind: 'core', title: 'ML rebuild', project_id: 'p-1', claim_id: 'c-1' },
    classification: null,
    captured_at: new Date('2026-04-28T00:00:00Z'),
    captured_by_user_id: 'u', captured_by_employee_id: null,
    override_of_event_id: null, override_new_kind: null, override_reason: null,
  });
  // Snapshot the canonical string; this becomes the regression-anchor for any
  // future canonicaliser changes.
  assert.match(e, /^\{"captured_at":"2026-04-28T00:00:00\.000Z"/);
});

test('canonicaliseEvent: pre-P4 events hash identically (regression guard)', () => {
  // Pin a P2-shape event; assert hash matches the value from p2-event-capture tag.
  const h = hashEvent(null, {
    subject_tenant_id: 'a', kind: 'HYPOTHESIS',
    payload: { _v: 1, source: 'paste', raw_text: 'hello' },
    classification: null,
    captured_at: new Date('2026-04-27T00:00:00Z'),
    captured_by_user_id: 'u', captured_by_employee_id: null,
    override_of_event_id: null, override_new_kind: null, override_reason: null,
  });
  // Lock this hash to whatever P2 emitted on the same input. Look up actual
  // value via `git checkout p2-event-capture && pnpm test packages/db -- -t "stable hex hash"`.
  assert.equal(h, '<replace-with-p2-tag-value>');
});

test('verifyChain: mixed P2 + P4 kinds verify clean', async () => {
  const subj = await seedSubjectTenant();
  await insertEventWithChain({ ...baseEvent, kind: 'HYPOTHESIS', payload: { _v: 1, source: 'paste', raw_text: 'h' } });
  await insertEventWithChain({ ...baseEvent, kind: 'ACTIVITY_CREATED', payload: { activity_id: 'a-1', ... } });
  await insertEventWithChain({ ...baseEvent, kind: 'ARTEFACT_LINKED', payload: { activity_id: 'a-1', artefact_kind: 'media', artefact_id: 'm-1' } });
  await insertEventWithChain({ ...baseEvent, kind: 'EXPENDITURE_INGESTED', payload: { expenditure_id: 'e-1', source: 'xero_invoice', vendor_name: 'AWS', line_count: 3 } });
  const result = await verifyChain(subj);
  assert.equal(result.verified, true);
  assert.equal(result.event_count, 4);
});

test('canonicaliseEvent: rejects events with unknown kind (defensive)', () => {
  // ↑ optional — chain.ts doesn't validate kind, but worth a regression check
  // if we add validation.
});
```

**Steps:**
1. Add the 4 tests to `chain.test.ts`
2. Run: `pnpm --filter @cpa/db test -- -t chain` — first 3 pass, the regression-guard fails until you fill in the actual P2 hash
3. Capture the actual P2 hash: `cd /tmp && git clone <repo> p2-test && cd p2-test && git checkout p2-event-capture && pnpm install && pnpm --filter @cpa/db test -- -t "stable hex hash"` and read the value, paste back
4. All 4 tests pass
5. Commit: `test(chain): P4 evidence kinds + regression guard for pre-P4 hash compat`

### Task F7: RLS isolation tests for new tables (rls.test.ts P4 chapter)

**Files:** Modify: `packages/db/src/rls.test.ts` (append a new test block)

**Approach:** Same pattern as the existing `event` / `subject_tenant` blocks — seed two tenants, set GUC for tenant A, verify queries against tenant B's rows return empty / inserts to tenant B's tenant_id rejected.

**For each new table** (`project`, `claim`, `activity`, `expenditure`, `expenditure_line`, `expenditure_mapping_rule`):

```ts
test('RLS: <table> — tenant A cannot read tenant B rows', async () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  await seedTenant(tenantA);
  await seedTenant(tenantB);
  // Insert one row per tenant via privilegedSql
  // Set GUC to tenantA via sql.begin
  // Query <table> via cpa_app sql — count must be 1, not 2
});

test('RLS: <table> — tenant A cannot insert tenant B rows', async () => {
  // Set GUC to tenantA, INSERT with tenant_id = tenantB — should error
});
```

**Steps:**
1. Add test pair per table (12 tests total)
2. `pnpm --filter @cpa/db test -- -t rls` — all green
3. Commit: `test(rls): isolation tests for P4 tables`

### Task F8: Zod schemas in `@cpa/schemas`

**Files:**
- Create: `packages/schemas/src/project.ts`
- Create: `packages/schemas/src/claim.ts`
- Create: `packages/schemas/src/activity.ts`
- Create: `packages/schemas/src/expenditure.ts`
- Create: `packages/schemas/src/expenditure_mapping_rule.ts`
- Modify: `packages/schemas/src/index.ts` (re-export 5)
- Modify: `packages/schemas/src/event.ts` (add new event payload schemas keyed by kind)

**Approach:** Wire-shape Zod for API request/response bodies + event payload validation. Match the existing pattern (`Project`, `CreateProjectBody`, `ProjectId`, etc.).

**Per file — example for project.ts:**

```ts
import { z } from 'zod';
import { Uuid, Iso8601 } from './primitives.js';

export const Project = z.object({
  id: Uuid,
  tenant_id: Uuid,
  subject_tenant_id: Uuid,
  name: z.string().min(1).max(200),
  description: z.string().nullable(),
  started_at: Iso8601,
  ended_at: Iso8601.nullable(),
  archived_at: Iso8601.nullable(),
  created_at: Iso8601,
  updated_at: Iso8601,
});
export type Project = z.infer<typeof Project>;

export const CreateProjectBody = z.object({
  subject_tenant_id: Uuid,
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  started_at: Iso8601,
  ended_at: Iso8601.optional(),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;
```

**Event payload schemas** — extend `event.ts`:

```ts
export const ActivityCreatedPayload = z.object({
  activity_id: Uuid,
  code: z.string().regex(/^(CA|SA)-\d{2,3}$/),
  kind: z.enum(['core', 'supporting']),
  title: z.string(),
  project_id: Uuid,
  claim_id: Uuid,
});

export const ArtefactLinkedPayload = z.object({
  activity_id: Uuid,
  artefact_kind: z.enum(['media', 'event', 'invoice', 'time_entry']),
  artefact_id: Uuid,
  link_reason: z.string().optional(),
});

// ... and so on for each of the 14 new kinds
```

**Steps:**
1. Write the 5 entity files + extend event.ts
2. Re-export from index.ts
3. `pnpm --filter @cpa/schemas typecheck` — clean
4. Commit: `feat(schemas): P4 Zod schemas — project/claim/activity/expenditure + event payload kinds`

### Task F9: CA/SA code auto-generation helper

**Files:**
- Create: `packages/db/src/activity-codes.ts`
- Create: `packages/db/src/activity-codes.test.ts`

**Approach:** Pure function that, given a `claim_id` and a `kind` ('core' or 'supporting'), returns the next available `CA-XX` or `SA-XX` code. Gap-filling (if CA-01 + CA-03 exist, returns CA-02). Idempotent on retries (same input → same output until a row is inserted).

```ts
// packages/db/src/activity-codes.ts
import { privilegedSql } from './client.js';

const PREFIX = { core: 'CA', supporting: 'SA' } as const;

export async function nextActivityCode(args: {
  claim_id: string;
  kind: 'core' | 'supporting';
}): Promise<string> {
  const prefix = PREFIX[args.kind];
  const rows = await privilegedSql<{ code: string }[]>`
    SELECT code FROM activity
     WHERE claim_id = ${args.claim_id}
       AND code LIKE ${prefix + '-%'}
     ORDER BY code
  `;
  const used = new Set(rows.map((r) => parseInt(r.code.slice(3), 10)));
  for (let n = 1; n <= 999; n++) {
    if (!used.has(n)) return `${prefix}-${String(n).padStart(2, '0')}`;
  }
  throw new Error(`activity code exhausted for claim ${args.claim_id} kind ${args.kind}`);
}
```

**Tests** (cover): empty claim → returns CA-01 / SA-01; with CA-01 only → returns CA-02; gap-fill (CA-01 + CA-03) → returns CA-02; mixed kinds independent (CA-01 doesn't shadow SA-01).

**Steps:**
1. Write the helper + 4 tests
2. `pnpm --filter @cpa/db test -- -t activity-codes` — green
3. Commit: `feat(db): nextActivityCode helper for CA/SA auto-generation`

### Task F10: Stage advance/revert helper

**Files:**
- Create: `apps/api/src/lib/claim-stage.ts`
- Create: `apps/api/src/lib/claim-stage.test.ts`

**Approach:** Pure function that validates allowed stage transitions and returns the new stage. The route handler calls this then writes the `CLAIM_STAGE_ADVANCED` event. Backward transitions allowed only for admin role.

```ts
// apps/api/src/lib/claim-stage.ts
export const STAGES = [
  'engagement', 'activity_capture', 'narrative_drafting',
  'expenditure_schedule', 'review', 'submitted', 'audit_defence',
] as const;
export type Stage = (typeof STAGES)[number];

export type StageTransition =
  | { ok: true; from: Stage; to: Stage; direction: 'forward' | 'backward' }
  | { ok: false; reason: 'invalid_target' | 'cannot_revert_from_submitted' | 'role_required' };

export function validateStageTransition(args: {
  from: Stage;
  to: Stage;
  role: 'admin' | 'consultant' | 'viewer';
}): StageTransition {
  const fromIdx = STAGES.indexOf(args.from);
  const toIdx = STAGES.indexOf(args.to);
  if (toIdx === -1 || fromIdx === -1) return { ok: false, reason: 'invalid_target' };
  if (args.from === 'submitted' && toIdx < fromIdx) return { ok: false, reason: 'cannot_revert_from_submitted' };
  const direction = toIdx > fromIdx ? 'forward' : 'backward';
  if (direction === 'backward' && args.role !== 'admin') return { ok: false, reason: 'role_required' };
  return { ok: true, from: args.from, to: args.to, direction };
}
```

**Tests:** all 21 forward transitions valid; backward as admin OK except from submitted; backward as consultant rejected; bogus stage rejected.

**Steps:**
1. Write helper + tests
2. Run, green
3. Commit: `feat(api): claim stage transition validator`

### Task F11: `@cpa/documents` package — React-PDF base

**Files:**
- Create: `packages/documents/package.json`
- Create: `packages/documents/tsconfig.json`
- Create: `packages/documents/src/index.ts`
- Create: `packages/documents/src/pdf-base.tsx` (shared header/footer/styles)
- Create: `packages/documents/src/content-hash.ts` (canonical hashing helper for document inputs)
- Create: `packages/documents/src/content-hash.test.ts`
- Modify: root `pnpm-workspace.yaml` if needed (workspace already glob-matches packages/*)
- Modify: `packages/documents/eslint.config.mjs` (extends root)

**package.json:**
```json
{
  "name": "@cpa/documents",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "test": "tsx --env-file-if-exists=../../.env --test \"src/**/*.test.{ts,tsx}\"",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "@react-pdf/renderer": "^4.0.0",
    "react": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

**`pdf-base.tsx`** — shared `<DocumentLayout>` component with cover, header, footer (incl. content-hash placeholder).

**`content-hash.ts`** — canonical JSON hashing of the document's input data; same `canonicalJsonStringify` algorithm as `chain.ts`. Re-export it from `@cpa/db/chain` if cleanly importable; otherwise duplicate the function.

**Tests:** content-hash deterministic; same input → same hash; field reordering → same hash (canonical key sort).

**Steps:**
1. Create package files + content-hash + tests
2. `pnpm install`
3. `pnpm --filter @cpa/documents build && pnpm --filter @cpa/documents typecheck && pnpm --filter @cpa/documents test` — clean
4. Commit: `feat(documents): @cpa/documents package — React-PDF base + content-hash`

### Task F12: CI env passthrough + format check

**Files:** Modify: `.github/workflows/ci.yml` (add Xero env vars to ci job + e2e job)

**In ci job env block:**
```yaml
XERO_ACCOUNTING_CLIENT_ID: ci-test-client-id
XERO_ACCOUNTING_CLIENT_SECRET: ci-test-client-secret
XERO_ACCOUNTING_REDIRECT_URI: http://localhost:3000/v1/integrations/xero-accounting/callback
XERO_IMPL: stub
```

(Same for e2e job.)

**Steps:**
1. Add the env block in both jobs
2. Push to remote; verify CI run picks up changes
3. Commit: `ci: add Xero accounting env vars to ci + e2e jobs`

---

## Swimlane A — Evidence Engine (A1–A10)

### Task A1: Project routes — POST/GET/PATCH/DELETE

**Files:**
- Create: `apps/api/src/routes/projects.ts`
- Create: `apps/api/src/routes/projects.test.ts`
- Modify: `apps/api/src/app.ts` (register `registerProjects(instance)`)

**Routes:**
- `POST /v1/projects` — admin or consultant role; body parsed by `CreateProjectBody`; writes `PROJECT_CREATED` event; returns the row
- `GET /v1/projects?subject_tenant_id=X` — list filtered by subject_tenant_id (RLS auto-filters cross-firm)
- `PATCH /v1/projects/:id` — partial update; admin or consultant; writes `PROJECT_UPDATED` event (or treat as ACTIVITY_UPDATED-style — per design doc we just need an event; new kind `PROJECT_UPDATED` not in F5 — add to F5's enum NOW if needed, OR use a generic `OBSERVATION` payload — recommend extending F5 with `PROJECT_UPDATED`)
- `DELETE /v1/projects/:id` — soft delete (sets `archived_at`); writes `PROJECT_ARCHIVED` event

**Per-route tests:** 401 without session, 201/200 happy paths, 403 viewer role, 404 cross-firm, 400 invalid body. Per-test UUID prefixes.

**Steps:**
1. Write the route handlers + register call
2. Write the tests
3. `pnpm --filter @cpa/api test -- -t "/v1/projects"` — green
4. Commit: `feat(api): /v1/projects CRUD + PROJECT_CREATED/ARCHIVED events`

### Task A2: Claim routes — POST + GET + PATCH stage + PATCH submission

**Files:**
- Create: `apps/api/src/routes/claims.ts`
- Create: `apps/api/src/routes/claims.test.ts`
- Modify: `apps/api/src/app.ts` (register)

**Routes:**
- `POST /v1/claims` — body: `{ subject_tenant_id, fiscal_year }`; default stage = 'engagement'; admin/consultant
- `GET /v1/claims?subject_tenant_id=X&stage=Y&assignee=Z&fiscal_year=N` — pipeline filter
- `GET /v1/claims/:id` — detail + counts (activities, mapped_lines, total_expenditure)
- `PATCH /v1/claims/:id/stage` — body: `{ to_stage }`; calls `validateStageTransition` (F10); writes `CLAIM_STAGE_ADVANCED` event
- `PATCH /v1/claims/:id` — body: `{ ausindustry_reference?, submitted_at? }`; validates we're at `submitted` stage when ausindustry_reference set; writes `CLAIM_SUBMITTED` event when both fields set

**Tests:** unique-per-FY guard (UNIQUE constraint surfaces as 409); stage-advance forward by consultant; backward by admin; backward by consultant rejected (403); submission flag gated on stage; cross-firm via RLS.

**Steps:**
1. Routes + tests
2. Run; green
3. Commit: `feat(api): /v1/claims CRUD + stage advance + submission`

### Task A3: Activity routes — POST + GET + PATCH

**Files:**
- Create: `apps/api/src/routes/activities.ts`
- Create: `apps/api/src/routes/activities.test.ts`
- Modify: `apps/api/src/app.ts`

**Routes:**
- `POST /v1/activities` — body: `{ project_id, claim_id, kind: 'core' | 'supporting', title, description?, hypothesis?, ... }`; auto-generates `code` via `nextActivityCode` (F9); writes `ACTIVITY_CREATED` event
- `GET /v1/activities?claim_id=X` — list, ordered by `code`
- `GET /v1/activities/:id` — detail
- `PATCH /v1/activities/:id` — body: any subset of `{ title, description, hypothesis, technical_uncertainty, experimentation_log, expected_outcome, actual_outcome }`; writes `ACTIVITY_UPDATED` event with `fields_changed` diff in payload

**Tests:** 201 with auto-generated code; gap-fill with pre-existing activities; mixed core/supporting numbering independence; PATCH writes diff event correctly.

**Steps:**
1. Routes + tests
2. Run; green
3. Commit: `feat(api): /v1/activities CRUD + auto CA/SA code + chain events`

### Task A4: Artefact-link routes

**Files:**
- Create: `apps/api/src/routes/artefact-links.ts`
- Create: `apps/api/src/routes/artefact-links.test.ts`
- Modify: `apps/api/src/app.ts`

**Routes:**
- `POST /v1/activities/:id/artefact-links` — body: `{ artefact_kind: 'media' | 'event' | 'invoice' | 'time_entry', artefact_id, link_reason? }`. Validates the artefact exists in the same tenant (RLS-scoped query). Writes `ARTEFACT_LINKED` event.
- `DELETE /v1/activities/:id/artefact-links/:event_id` — looks up the original `ARTEFACT_LINKED` event, writes `ARTEFACT_UNLINKED` event with `prior_artefact_id`. (No need to delete the original event — append-only chain.)

**Tests:** link a media artefact; cross-firm artefact_id rejected (404); unlink writes UNLINKED event; query "artefacts for activity X" filters events of kind LINKED minus subsequent UNLINKED (test the helper).

**Steps:**
1. Routes + tests
2. Run; green
3. Commit: `feat(api): activity artefact linkage via ARTEFACT_LINKED/UNLINKED events`

### Task A5: Activity detail view (web)

**Files:**
- Create: `apps/web/src/app/claims/[claim_id]/activities/[activity_id]/page.tsx`
- Create: `apps/web/src/app/claims/[claim_id]/activities/[activity_id]/page.test.tsx`
- Create: `apps/web/src/components/activity-editor.tsx`

**Approach:** Server-rendered detail page with form for title, description, hypothesis, technical_uncertainty, experimentation_log, expected_outcome, actual_outcome. Save button calls `PATCH /v1/activities/:id`; toast on success.

**Steps:**
1. Page + component + test
2. Run; green
3. Commit: `feat(web): activity detail editor`

### Task A6: Technical uncertainty register view

**Files:**
- Create: `apps/web/src/app/claims/[claim_id]/activities/[activity_id]/register/page.tsx`
- Create: `apps/web/src/components/uncertainty-feed.tsx`

**Approach:** Filtered events list — events of kind `HYPOTHESIS` / `UNCERTAINTY` / `EXPERIMENT` / `OBSERVATION` / `ITERATION` / `NEW_KNOWLEDGE` / `ACTIVITY_UPDATED` whose payload has `activity_id = :activity_id`. Ordered by `captured_at`. Each event renders as a card showing kind, captured_at, payload summary.

API extension: `GET /v1/events?activity_id=X` — add `activity_id` query param to the existing events route's filter.

**Steps:**
1. Extend events route filter
2. Add web page + component + test
3. Run; green
4. Commit: `feat(web): technical uncertainty register feed`

### Task A7: Project list + detail (web)

**Files:**
- Create: `apps/web/src/app/projects/page.tsx` (list)
- Create: `apps/web/src/app/projects/[project_id]/page.tsx` (detail with activities table)

**Approach:** List filtered by `subject_tenant_id` from URL. Detail shows activities grouped by claim (FY).

**Steps:** same TDD pattern. Commit: `feat(web): project list + detail pages`

### Task A8: Activity application skeleton PDF

**Files:**
- Create: `packages/documents/src/activity-application.tsx` (React-PDF template)
- Create: `packages/documents/src/activity-application.test.tsx`
- Create: `apps/api/src/routes/documents.ts` (route handler)
- Create: `apps/api/src/routes/documents.test.ts`
- Modify: `apps/api/src/app.ts`

**Template structure** (per design doc §"Document generation #1"):
- Cover page: claimant, FY, registration ref (if submitted), generated-on date
- Per-activity section: code, title, dominant-purpose, hypothesis, technical_uncertainty, experimentation_log, expected_outcome, actual_outcome
- Footer: SHA-256 of input + timestamp + generator version

**Route:** `GET /v1/claims/:id/documents/activity-application.pdf` — fetches claim + activities, renders, hashes input via `@cpa/documents/content-hash`, writes `DOCUMENT_GENERATED` event with `content_sha256`, streams PDF response with `X-Content-Hash: <sha>` header.

**Tests:** content-hash deterministic on same input; PDF byte-stream non-empty; DOCUMENT_GENERATED event written.

**Steps:**
1. Template + tests
2. Route + tests
3. Run all; green
4. Commit: `feat(api,documents): activity application skeleton PDF + DOCUMENT_GENERATED event`

### Task A9: Hash-chain extension test (mixed kinds)

**Files:** Modify: `packages/db/src/chain.test.ts` (extend test from F6 to use real DB)

**Goal:** Seed 100 events alternating across all P0–P4 kinds (12 P0–P3 + 14 P4 = 26 kinds); verify the chain extends cleanly; `verifyChain` returns `verified: true`.

**Steps:**
1. Add the seed loop test
2. Run; green
3. Commit: `test(chain): 100-event mixed-kind sequence verifyChain green`

### Task A10: Swimlane A e2e — create project → claim → activity → link evidence → see register

**Files:** Create: `apps/web/e2e/p4-evidence-engine.spec.ts`

**Test flow:**
1. Sign in as consultant
2. Create project via UI
3. Create claim for FY25
4. Create activity CA-01
5. Edit activity hypothesis + uncertainty + experimentation log
6. Link existing media artefact (seeded by fixture) to activity
7. Open uncertainty register view → see 1 ACTIVITY_CREATED + 1 ACTIVITY_UPDATED + 1 ARTEFACT_LINKED event

**Steps:**
1. Write spec
2. `pnpm --filter @cpa/web exec playwright test p4-evidence-engine` — green
3. Commit: `test(e2e): P4 evidence engine end-to-end`

---

## Swimlane B — Xero + Expenditure (B1–B12)

### Task B1: `@cpa/integrations/xero-accounting` module — OAuth scaffolding

**Files:**
- Create: `packages/integrations/src/xero-accounting/index.ts`
- Create: `packages/integrations/src/xero-accounting/client.ts`
- Create: `packages/integrations/src/xero-accounting/oauth.ts`
- Create: `packages/integrations/src/xero-accounting/oauth.test.ts`
- Create: `packages/integrations/src/xero-accounting/types.ts`
- Modify: `packages/integrations/src/runtime/index.ts` (re-export)
- Modify: `packages/integrations/package.json` (add `./xero-accounting` export)

**Approach:** Clone `packages/integrations/src/payroll/xero-payroll/` structure. Same PKCE OAuth, same encrypted token storage in `integration_connection`, different scope set (`accounting.transactions accounting.contacts accounting.settings offline_access`). New connection `provider='xero_accounting'`.

**Steps:**
1. Copy + adapt module structure
2. Tests for: PKCE state generation, token exchange parsing, refresh token rotation
3. Run; green
4. Commit: `feat(integrations): xero-accounting OAuth scaffolding`

### Task B2: Sync — Invoices (ACCPAY) backfill + incremental

**Files:**
- Create: `packages/integrations/src/xero-accounting/sync-invoices.ts`
- Create: `packages/integrations/src/xero-accounting/sync-invoices.test.ts`
- Create: `tests/fixtures/xero-accounting/invoices-sample.json`

**Approach:** Function `syncInvoices(connection, { mode: 'backfill' | 'incremental', since? })`. Paginated fetch (`page` + `pageSize=200`). For backfill, no `If-Modified-Since`. For incremental, `If-Modified-Since: <since.toISOString()>`. Each invoice + its line items → upsert into `expenditure` + `expenditure_line` (source='xero_invoice', source_external_id=Xero InvoiceID). Writes `EXPENDITURE_INGESTED` event per new invoice.

**Tests:** nock mocks the Xero `Invoices` endpoint with the fixture JSON; assert N invoices + M lines persisted; assert EXPENDITURE_INGESTED events written; second call with `If-Modified-Since` returns 0 new (or just-updated).

**Steps:**
1. Sync function + tests + fixtures
2. Run; green
3. Commit: `feat(integrations): xero-accounting invoice sync (ACCPAY)`

### Task B3: Sync — BankTransactions (SPEND)

**Files:**
- Create: `packages/integrations/src/xero-accounting/sync-bank-tx.ts`
- Create: `packages/integrations/src/xero-accounting/sync-bank-tx.test.ts`
- Create: `tests/fixtures/xero-accounting/bank-tx-sample.json`

**Same pattern as B2.** Filter to `Type=SPEND`. Source = `xero_bank_tx`.

**Steps:** mirror B2. Commit: `feat(integrations): xero-accounting bank transaction sync (SPEND)`

### Task B4: Sync — Receipts (Xero Expenses module)

**Files:**
- Create: `packages/integrations/src/xero-accounting/sync-receipts.ts`
- Create: `packages/integrations/src/xero-accounting/sync-receipts.test.ts`
- Create: `tests/fixtures/xero-accounting/receipts-sample.json`

**Same pattern.** Plus: map Xero submitter user ID → our `user.id` via email match (the `submitter` in Xero has an email; we look up `user WHERE email = X` in the same tenant). On match, set `reimbursed_to_user_id`. On no-match, leave null.

**Steps:** mirror B2/B3 + add the email-lookup logic. Commit: `feat(integrations): xero-accounting receipts sync + reimbursee user mapping`

### Task B5: Sync — Contacts + Accounts cache

**Files:**
- Create: `packages/integrations/src/xero-accounting/sync-contacts.ts`
- Create: `packages/integrations/src/xero-accounting/sync-accounts.ts`
- Create: `packages/db/src/schema/xero_contact.ts`
- Create: `packages/db/src/schema/xero_account.ts`
- Modify: `packages/db/migrations/0015_xero_caches.sql` (hand-authored — small tables, no RLS-sensitive data, but tenant-scoped)

**Approach:** Cache tables for vendor / account-code rule matching. Tenant-scoped. RLS still applied. Updated on every sync run. Exposed via API for the rules-engine UI.

**Steps:** schemas + migration + sync functions + tests. Commit: `feat(integrations): xero-accounting contacts + accounts cache`

### Task B6: pg-boss job — per-tenant sync trigger

**Files:**
- Create: `apps/api/src/jobs/xero-accounting-sync.ts`
- Create: `apps/api/src/jobs/xero-accounting-sync.test.ts`

**Approach:** pg-boss schedule registers a recurring job per `integration_connection` with `provider='xero_accounting'` and `state='connected'`. Job runs every 15 minutes. Idempotent: if a previous run is still in progress (per-tenant lock), skip. Calls `syncInvoices`, `syncBankTx`, `syncReceipts`, `syncContacts`, `syncAccounts` in sequence. Updates `last_synced_at` on the connection.

**Steps:** job module + tests + registration in `apps/api/src/index.ts`. Commit: `feat(api): pg-boss xero-accounting sync job (15min cadence)`

### Task B7: Stub fallback — `XERO_IMPL=stub`

**Files:**
- Create: `packages/integrations/src/xero-accounting/stub.ts`
- Modify: `packages/integrations/src/xero-accounting/index.ts` (route based on `XERO_IMPL`)

**Approach:** When `XERO_IMPL=stub`, all sync functions read from `tests/fixtures/xero-accounting/*.json` instead of hitting the live API. CI runs use stub. Integration tests use stub for predictable behaviour. Real keys flip to `real`.

**Steps:** stub implementations + route logic + smoke test that stub paths produce data. Commit: `feat(integrations): xero-accounting stub fallback for CI/dev`

### Task B8: Expenditure mapping rules engine

**Files:**
- Create: `apps/api/src/lib/mapping-rule.ts`
- Create: `apps/api/src/lib/mapping-rule.test.ts`

**Approach:** Pure function `findMatchingRule(rules, line)` — orders rules by `priority DESC`, returns first match where vendor / account / description patterns all match (empty = wildcard). Used at ingest time + on rule creation (background job).

```ts
export function findMatchingRule(
  rules: MappingRule[],
  line: { vendor_name: string; account_code?: string | null; description: string },
): MappingRule | null {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (rule.vendor_pattern && !new RegExp(rule.vendor_pattern, 'i').test(line.vendor_name)) continue;
    if (rule.account_code && rule.account_code !== line.account_code) continue;
    if (rule.description_pattern && !new RegExp(rule.description_pattern, 'i').test(line.description)) continue;
    return rule;
  }
  return null;
}
```

**Tests:** priority ordering, wildcard empty fields, case-insensitive regex, no-match returns null.

**Steps:** function + tests. Commit: `feat(api): expenditure mapping rule matcher`

### Task B9: Manual expenditure entry route

**Files:**
- Create: `apps/api/src/routes/expenditures.ts`
- Create: `apps/api/src/routes/expenditures.test.ts`
- Modify: `apps/api/src/app.ts`

**Routes:**
- `POST /v1/expenditures` — body: `{ subject_tenant_id, vendor_name, reference?, expenditure_date, total_amount, lines: [{ description, account_code?, amount }] }`, source automatically = 'manual', writes `EXPENDITURE_INGESTED` event
- `GET /v1/expenditures?subject_tenant_id=X&fiscal_year=Y&source=Z&mapped_state=mapped|unmapped|all` — filtered list with line totals
- `GET /v1/expenditures/:id` — detail incl. lines + raw_payload
- `PATCH /v1/expenditures/:id` — only allowed if source='manual'; rejects edits to Xero-sourced rows
- `DELETE /v1/expenditures/:id` — soft delete (sets `voided_at`); writes `EXPENDITURE_VOIDED` event

**Tests:** manual create with lines; Xero-sourced PATCH 403; void writes event; cross-firm 404.

**Steps:** routes + tests. Commit: `feat(api): /v1/expenditures CRUD + manual entry`

### Task B10: PATCH /v1/expenditure-lines/:id/mapping + rule auto-creation toggle

**Files:**
- Create: `apps/api/src/routes/expenditure-lines.ts`
- Create: `apps/api/src/routes/expenditure-lines.test.ts`
- Create: `apps/api/src/routes/expenditure-mapping-rules.ts`
- Create: `apps/api/src/routes/expenditure-mapping-rules.test.ts`
- Modify: `apps/api/src/app.ts`

**Routes:**
- `PATCH /v1/expenditure-lines/:id/mapping` — body: `{ activity_id, rd_percent, save_as_rule?: { vendor?: boolean, account_code?: boolean, description_pattern?: string, priority? } }`. Writes `EXPENDITURE_LINE_MAPPED` event. If `save_as_rule` present, also creates a rule.
- `DELETE /v1/expenditure-lines/:id/mapping` — writes `EXPENDITURE_LINE_UNMAPPED` event
- `POST /v1/expenditure-mapping-rules` — admin/consultant — creates rule, optionally backfills unmapped lines via background job
- `GET /v1/expenditure-mapping-rules` — list (admin)
- `PATCH /v1/expenditure-mapping-rules/:id` — edit
- `DELETE /v1/expenditure-mapping-rules/:id` — archive

**Tests:** map a line, save as vendor rule, verify rule applies to subsequent unmapped lines from same vendor. Unmap, remap, override.

**Steps:** routes + tests. Commit: `feat(api): expenditure line mapping + rule routes`

### Task B11: Bulk operations on expenditure lines

**Files:** Modify: `apps/api/src/routes/expenditure-lines.ts` (add bulk endpoint)

**Routes:**
- `POST /v1/expenditure-lines/bulk-map` — body: `{ line_ids: [], activity_id, rd_percent }` — atomic over all lines; writes one event per line
- `POST /v1/expenditure-lines/bulk-unmap` — body: `{ line_ids: [] }`

**Tests:** map 10 lines at once; partial failure (one line cross-firm) → entire batch fails (transaction).

**Steps:** add routes + tests. Commit: `feat(api): bulk expenditure-line map/unmap`

### Task B12: Swimlane B e2e — Xero connect → sync → map → cross-walk

**Files:** Create: `apps/web/e2e/p4-xero-mapping.spec.ts`

**Test flow:**
1. Sign in as consultant; XERO_IMPL=stub
2. Connect Xero via `/integrations` page (stub returns success)
3. Trigger sync (admin button)
4. Open `/claims/[id]/expenditure`; see ingested invoices + bank tx + receipts
5. Map 3 lines manually + create a rule
6. Verify a 4th line of same vendor auto-maps
7. Open cross-walk PDF link; verify download with content-hash header

**Steps:** spec + run; green. Commit: `test(e2e): Xero connect to cross-walk end-to-end`

---

## Swimlane C — Pipeline + Documents (C1–C10)

### Task C1: Pipeline page route + view toggle

**Files:**
- Create: `apps/web/src/app/pipeline/page.tsx`
- Create: `apps/web/src/components/pipeline-filters.tsx`

**Approach:** Server-rendered list of claims with filters (stage, consultant, FY, sector). View toggle (kanban|table) via URL query param `?view=kanban|table`. Default = table.

**Steps:** page + filters + tests. Commit: `feat(web): /pipeline list + view toggle + filters`

### Task C2: Kanban view component

**Files:**
- Create: `apps/web/src/components/pipeline-kanban.tsx`
- Create: `apps/web/src/components/pipeline-kanban.test.tsx`

**Approach:** 7-column board, claims as cards, drag-drop forward via `@hello-pangea/dnd` (already a P3 dep) or use HTML5 drag/drop natively. Context menu on card → revert (admin-only). Bulk multi-select via shift-click; bulk-advance / bulk-revert / bulk-assign actions.

**Tests:** drag a card from `engagement` to `activity_capture` → calls `PATCH /:id/stage`; revert as consultant rejected (admin-only context menu hidden); bulk select 3 cards → bulk advance posts 3 PATCH requests.

**Steps:** component + tests. Commit: `feat(web): pipeline kanban view + drag-drop stage advance`

### Task C3: Tabular view component

**Files:**
- Create: `apps/web/src/components/pipeline-table.tsx`
- Create: `apps/web/src/components/pipeline-table.test.tsx`

**Approach:** Sortable, filterable table. Columns: Claimant, FY, Stage, Activities, Days-in-stage, Assignee, Last updated, Actions. Multi-select checkbox; bulk dropdown for stage advance + consultant reassignment.

**Steps:** component + tests. Commit: `feat(web): pipeline tabular view + bulk operations`

### Task C4: Claim detail page (tabs)

**Files:**
- Create: `apps/web/src/app/claims/[claim_id]/page.tsx`
- Create: `apps/web/src/components/claim-tabs.tsx`

**Tabs:** Activities (list of CAs and SAs); Evidence (filtered events feed for this claim); Expenditure (mapping UI — wired in C5); Documents (links to 3 PDFs); Timeline (chain events for this claim).

**Steps:** page + tab component + per-tab smoke tests. Commit: `feat(web): claim detail page with 5 tabs`

### Task C5: Expenditure mapping UI — tabular line-by-line

**Files:**
- Create: `apps/web/src/components/expenditure-mapping-table.tsx`
- Create: `apps/web/src/components/expenditure-mapping-modal.tsx`

**Approach:** Table of `expenditure_line` rows for the FY with columns: Date, Source, Vendor, Description, Account, Amount, RD%, Activity, Action. Source filter chip; mapped-state filter (mapped/unmapped/all). Inline mapping modal with activity dropdown, RD% slider, "save as rule" toggle. Bulk multi-select.

**Steps:** components + tests + integration with C4's Expenditure tab. Commit: `feat(web): expenditure mapping table + modal`

### Task C6: Apportionment integration (line-level RD% slider)

**Files:** Modify: `apps/web/src/components/expenditure-mapping-modal.tsx` (already created in C5; extend with RD% slider that respects existing apportionment workbench rules from P3)

**Approach:** RD% slider 0–100. Default 100%. Stored on `expenditure_line.rd_percent`. Same as P3's `time_entry.apportionment_pct` UI conventions.

**Steps:** extend modal + tests. Commit: `feat(web): line-level RD% apportionment slider`

### Task C7: Expenditure schedule PDF

**Files:**
- Create: `packages/documents/src/expenditure-schedule.tsx`
- Create: `packages/documents/src/expenditure-schedule.test.tsx`
- Modify: `apps/api/src/routes/documents.ts` (add `/expenditure-schedule.pdf` route)

**Template:** FY total + per-activity breakdown. Per-activity rows: salary (sum of `time_entry.amount × rd_percent` for the FY), invoices, bank tx, receipts, manual. ASSOCIATE_FLAG events highlight rows. Footer with content-hash.

**Tests:** generate from fixture data; assert table shape; assert content-hash deterministic.

**Steps:** template + route + tests. Commit: `feat(documents): expenditure schedule PDF`

### Task C8: ATO cross-walk PDF

**Files:**
- Create: `packages/documents/src/cross-walk.tsx`
- Create: `packages/documents/src/cross-walk.test.tsx`
- Modify: `apps/api/src/routes/documents.ts` (add `/cross-walk.pdf` route)

**Template:** One-page table — every R&D dollar mapped to an activity. Columns: Date, Source, Vendor, Description, Account, Amount, RD%, Activity, Evidence ref. Footer: SHA-256 of canonical input + timestamp + generator version.

**Steps:** template + route + tests. Commit: `feat(documents): ATO cross-walk PDF`

### Task C9: Document download routes — content-hash response header

**Files:** Modify: `apps/api/src/routes/documents.ts` (already exists from A8; ensure all 3 routes set `X-Content-Hash` response header before streaming)

**Approach:** All 3 PDF routes (activity-application, expenditure-schedule, cross-walk) set:
- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename=...`
- `X-Content-Hash: <sha>` (matches `DOCUMENT_GENERATED` event payload)

**Tests:** integration test asserts the header on each route.

**Steps:** modify + tests. Commit: `feat(api): document download routes with X-Content-Hash header`

### Task C10: Swimlane C e2e — full pipeline traversal

**Files:** Create: `apps/web/e2e/p4-pipeline.spec.ts`

**Test flow:**
1. Sign in; create claim
2. Advance through 7 stages via kanban drag-drop
3. At `expenditure_schedule`: open Expenditure tab, see mapping UI
4. At `submitted`: enter ausindustry_reference, mark submitted
5. Try to revert as consultant — rejected; revert as admin — allowed (only from non-`submitted` stages)
6. Download all 3 PDFs; verify X-Content-Hash header

**Steps:** spec + run; green. Commit: `test(e2e): pipeline traversal end-to-end`

---

## Final integration (D1–D6)

### Task D1: Cross-cutting integration test

**Files:** Create: `apps/web/e2e/p4-full-happy-path.spec.ts`

**Flow:** Connect Xero (stub) → sync → create project + claim + 2 activities → map 20 expenditures → advance pipeline → mark submitted → all 3 docs generate with stable hashes.

**Steps:** spec + run; green. Commit: `test(e2e): full P4 happy-path integration test`

### Task D2: Hash-chain integrity smoke test

**Files:** Create: `packages/db/src/chain-integrity.test.ts`

**Approach:** Seed 500 mixed events across all P0–P4 kinds for 5 different subject_tenants; `verifyChain` green for all 5. Per-tenant chain isolation verified (events for tenant A don't appear in tenant B's chain).

**Steps:** test + run; green. Commit: `test(chain): 500-event mixed-kind integrity smoke test`

### Task D3: Audit-readiness score (P3) extension

**Files:**
- Modify: `packages/audit-score/src/rules.ts` (add 4 new rules)

**New rules:**
- `activities_have_hypothesis` — % of activities in claim with non-empty `hypothesis`
- `activities_have_uncertainty` — % with non-empty `technical_uncertainty`
- `expenditure_coverage` — % of expenditure dollars (by amount) mapped to an activity
- `evidence_per_activity_min` — every activity has ≥1 ARTEFACT_LINKED event

**Steps:** rules + per-rule tests + update SCORING_RULES total. Commit: `feat(audit-score): P4 rules — activity completeness + expenditure coverage`

### Task D4: ADR-0006 — P4 architecture

**Files:** Create: `docs/decisions/0006-activity-register-and-expenditure.md`

**Sections:** Decision context (why hybrid project+claim, why on event chain, why Xero-only in P4), consequences, alternatives considered, migration plan for breakage.

**Steps:** write + commit. `docs(adr): ADR-0006 P4 architecture`

### Task D5: Documentation updates

**Files:**
- Create: `packages/integrations/src/xero-accounting/README.md`
- Create: `packages/documents/README.md`
- Modify: root `README.md` (mention P4)

**Steps:** write all 3. Commit: `docs: README updates for P4`

### Task D6: First-customer onboarding test (manual smoke)

**Files:** Create: `docs/runbooks/p4-first-customer-onboarding.md`

**Manual checklist:**
1. Empty account → connect Xero sandbox
2. Wait for sync (verify rows in `expenditure` table)
3. Create 1 project + 2 activities (CA-01 + SA-01)
4. Map 20 expenditure lines
5. Advance through pipeline → `submitted`
6. Download all 3 PDFs; verify content-hashes match `DOCUMENT_GENERATED` events
7. AusIndustry portal manual submission with our generated docs (manual step; document the workflow)

**Steps:** doc + commit. `docs(runbook): P4 first-customer onboarding checklist`

---

## Acceptance criteria — P4 done when

- [ ] Migrations 0012-0014 apply cleanly on fresh DB; verifyChain green on existing P0-P3 fixtures (backward compat verified by F6's regression-guard test)
- [ ] Connect Xero sandbox → 24-month backfill of invoices + bank transactions + receipts → `expenditure` rows in DB
- [ ] Create project + claim + activities (CA-01, SA-01) → activity application PDF generates with content-hash logged on chain
- [ ] Map 50+ expenditure lines (mix of rule-driven + manual) → expenditure schedule + cross-walk PDFs generate
- [ ] Pipeline kanban + tabular both render; advance through 7 stages writes CLAIM_STAGE_ADVANCED events
- [ ] Mark a claim submitted with reference number → claim frozen, post-submission edits rejected
- [ ] Hash chain verifies across all P0-P4 event kinds for every test subject_tenant
- [ ] CI green (lint, typecheck, format, test, e2e) on `p4/foundation` (or merged feature branches)
- [ ] First-customer manual onboarding test: blank account → connect Xero → 1 project → 2 activities → 20 expenditures mapped → submission flag → 3 docs all generate
- [ ] HaikuClassifier remains unaffected (P2 backward compat)
- [ ] ADR-0006 committed
- [ ] All commits include co-author trailer

---

## Execution

Use `superpowers:subagent-driven-development` to execute task-by-task with two-stage review (spec compliance → code quality) after each.

**Recommended approach:** Foundation tasks (F1-F12) sequentially by one controller. Once foundation merges, dispatch Swimlane A / B / C in parallel worktrees (`p4a`, `p4b`, `p4c` from `p4/foundation`). Final integration (D1-D6) merges all three swimlanes back to `p4/foundation`, then opens PR to `main`.

**Parallel-worktree pattern (proven in P3):**
```bash
cd /c/Users/Aaron/cpa-platform-worktrees
git -C ../cpa-platform fetch origin
git -C ../cpa-platform worktree add p4a -b p4a/evidence-engine p4/foundation
git -C ../cpa-platform worktree add p4b -b p4b/xero-expenditure p4/foundation
git -C ../cpa-platform worktree add p4c -b p4c/pipeline-documents p4/foundation
```

After all swimlanes complete, merge in dependency order (A first since it produces activities that B and C consume, but in practice A/B/C are mostly independent — confirm at integration time).
