# R&DTI Skill Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the 4 material gaps between the cpa-platform codebase and the `rdti-workflow` skill spec, achieving 100% portal-ready output capability for direct AusIndustry submission.

**Architecture:** 4 independent sprints / 4 PRs across ~2-2.5 weeks. Each sprint addresses one gap and ships independently — no inter-sprint dependencies that prevent parallel execution. Sprint A is the most consequential (touches Agent C's prompt + adds the headline "Export Portal Pack" feature); Sprints B/C/D are smaller schema + UI additions.

**Tech Stack:** TypeScript (Drizzle ORM, Zod, Fastify, Next.js, postgres-js, Anthropic SDK). Existing platform conventions: TDD discipline, RLS-protected schemas, ESM imports with `.js` extensions, `pnpm --filter <package>` scoped builds.

**Audit reference:** see capability audit (chat history, 2026-05-05) — 4 material gaps + 2 deferred (email parser, ASX feed) + significant capability extensions beyond the skill.

**Worktree / branch suggestion:** each sprint opens its own branch off latest `main` after the previous sprint's PR merges. No cross-branch dependencies.

| Sprint | Branch | Effort |
|--------|--------|--------|
| A — Portal field structure | `feat/rdti-portal-pack` | ~1 week |
| B — Feedstock + R&D intensity | `feat/rdti-feedstock-intensity` | ~3-4 days |
| C — Checkbox structures | `feat/rdti-portal-checkboxes` | ~2-3 days |
| D — Registration form fields | `feat/rdti-registration-fields` | ~2 days |

---

## Sprint A — Portal field structure (~1 week)

**Goal:** Produce AusIndustry-portal-ready content with the exact 13 core / 9 supporting field structure expected by the registration form. Add an "Export Portal Pack" deliverable that gives consultants copy-paste-ready content with character counts.

### Task A.1 — Migration `0044_activity_portal_fields.sql`

**Type:** TDD code (migration test pattern)

**Files:**
- Create: `packages/db/migrations/0044_activity_portal_fields.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/src/migrations.test.ts` (add tests)
- Modify: `packages/db/src/schema/activity.ts` (add Drizzle column)

**Step 1: Write the failing migration test**

```ts
test('migration 0044: activity.portal_fields jsonb column exists', async () => {
  const rows = await privilegedSql<{ data_type: string; is_nullable: string }[]>`
    SELECT data_type, is_nullable FROM information_schema.columns
     WHERE table_name='activity' AND column_name='portal_fields'
  `;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.data_type, 'jsonb');
  assert.equal(rows[0]!.is_nullable, 'YES');
});

test('migration 0044: portal_fields default is empty object', async () => {
  // Test default by inserting an activity without specifying portal_fields
  await sql`SELECT set_config('app.current_tenant_id', ${TEST_TENANT_ID}, true)`;
  const inserted = await sql<{ portal_fields: object }[]>`
    INSERT INTO activity (id, tenant_id, project_id, claim_id, code, kind, title, fy_label)
    VALUES (gen_random_uuid(), ${TEST_TENANT_ID}, ${TEST_PROJECT_ID}, ${TEST_CLAIM_ID},
            'CA-99', 'core', 'Test', 'FY25')
    RETURNING portal_fields
  `;
  assert.deepEqual(inserted[0]!.portal_fields, {});
});
```

**Step 2: Run tests — expect fail**

```bash
cd C:/Users/Aaron/cpa-platform-worktrees/<branch>
pnpm --filter @cpa/db test -- --test-name-pattern="migration 0044"
```

**Step 3: Write the migration SQL**

```sql
-- packages/db/migrations/0044_activity_portal_fields.sql
-- Adds portal_fields jsonb column to activity table to capture per-AusIndustry-
-- portal-field content. Schema below; enforced at application layer (Zod).

ALTER TABLE activity
  ADD COLUMN portal_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Index for jsonb path queries (e.g., finding activities with hypothesis content)
CREATE INDEX activity_portal_fields_idx ON activity USING GIN (portal_fields);

-- Application-layer Zod schema enforces shape:
-- For 'core' activities:
--   { activity_name, description, outcome_unknown_methods, sources_investigated,
--     why_competent_professional_couldnt_know, hypothesis, experiment,
--     evaluation, conclusions, evidence_kept_categories, new_knowledge_purpose,
--     expenditure_estimate, related_supporting_activity_ids }
-- For 'supporting' activities:
--   { activity_name, description, supports_core_activity_ids,
--     how_supports_core_rd, who_performed_work, dates_conducted,
--     expenditure_estimate, produces_good_or_service, dominant_purpose,
--     evidence_kept }
```

**Step 4: Run tests + verify pass**

**Step 5: Update Drizzle schema**

```ts
// packages/db/src/schema/activity.ts (add to pgTable)
portal_fields: jsonb('portal_fields').notNull().default({}),
```

**Step 6: Update journal + commit**

```bash
git add packages/db/migrations/0044_activity_portal_fields.sql \
        packages/db/migrations/meta/_journal.json \
        packages/db/src/migrations.test.ts \
        packages/db/src/schema/activity.ts
git commit -m "feat(db): activity.portal_fields jsonb for 13-core/9-supporting AusIndustry portal structure (A.1)"
```

### Task A.2 — Zod schemas for portal fields

**Type:** TDD code

**Files:**
- Create: `packages/schemas/src/portal-fields.ts`
- Create: `packages/schemas/src/portal-fields.test.ts`

**Step 1: Write failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CorePortalFieldsSchema,
  SupportingPortalFieldsSchema,
  PortalFieldCharacterLimits,
} from './portal-fields.js';

test('CorePortalFieldsSchema: requires all 13 fields', () => {
  const valid = {
    activity_name: 'Test core activity',
    description: 'a'.repeat(200),
    outcome_unknown_methods: ['no_applicable_literature'],
    sources_investigated: 'a'.repeat(500),
    why_competent_professional_couldnt_know: 'a'.repeat(500),
    hypothesis: 'a'.repeat(500),
    experiment: 'a'.repeat(500),
    evaluation: 'a'.repeat(500),
    conclusions: 'a'.repeat(500),
    evidence_kept_categories: ['hypothesis_design', 'results_evaluation'],
    new_knowledge_purpose: 'a'.repeat(500),
    expenditure_estimate_aud: 250000,
    related_supporting_activity_ids: [],
  };
  assert.doesNotThrow(() => CorePortalFieldsSchema.parse(valid));
});

test('CorePortalFieldsSchema: rejects content exceeding 4000 chars', () => {
  const invalid = { activity_name: 'X', description: 'a'.repeat(4001) /* etc */ };
  assert.throws(() => CorePortalFieldsSchema.parse(invalid));
});

test('PortalFieldCharacterLimits: all narrative fields cap at 4000', () => {
  for (const limit of Object.values(PortalFieldCharacterLimits.core)) {
    assert.ok(limit <= 4000);
  }
});
```

**Step 2-4:** Run, implement, verify per TDD.

```ts
// packages/schemas/src/portal-fields.ts
import { z } from 'zod';

const Char4000 = z.string().max(4000);
const Char200 = z.string().max(200); // for activity_name

export const OutcomeUnknownMethodEnum = z.enum([
  'no_applicable_literature',     // No applicable info in scientific/technical/professional literature or patents
  'expert_advice',                 // Experts advised no available solution
  'no_adaptable_solutions',        // No way to adapt solutions from other companies
  'other',                         // Other reason (requires explanation)
  'did_not_investigate',           // Company did not look into existing knowledge — COMPLIANCE RISK FLAG
]);

export const EvidenceKeptCategoryEnum = z.enum([
  'hypothesis_design',             // Evidence of hypothesis + experiment design
  'results_evaluation',            // Documented results + evaluation
  'experiment_revisions',          // Evidence of revisions in response to results
  'knowledge_searches',            // Evidence of searches/inquiries for current knowledge
  'systematic_progression',        // Evidence of systematic progression of work
  'other',                         // Other (requires description)
  'no_records_kept',               // Did not keep records — CRITICAL COMPLIANCE GAP
]);

export const CorePortalFieldsSchema = z.object({
  activity_name: Char200,
  description: Char4000,
  outcome_unknown_methods: z.array(OutcomeUnknownMethodEnum).min(1),
  sources_investigated: Char4000,
  why_competent_professional_couldnt_know: Char4000,
  hypothesis: Char4000,
  experiment: Char4000,
  evaluation: Char4000,
  conclusions: Char4000,
  evidence_kept_categories: z.array(EvidenceKeptCategoryEnum).min(1),
  new_knowledge_purpose: Char4000,
  expenditure_estimate_aud: z.number().nonnegative(),
  related_supporting_activity_ids: z.array(z.string().uuid()),
});

export const SupportingPortalFieldsSchema = z.object({
  activity_name: Char200,
  description: Char4000,
  supports_core_activity_ids: z.array(z.string().uuid()).min(1),
  how_supports_core_rd: Char4000,
  who_performed_work: z.enum([
    'r_and_d_company_only',
    'r_and_d_company_and_others',
    'subsidiary_or_group_or_others',
    'others_only',
  ]),
  dates_conducted: z.object({ start: z.string().date(), end: z.string().date() }),
  expenditure_estimate_aud: z.number().nonnegative(),
  produces_good_or_service: z.boolean(),
  dominant_purpose: z.object({
    is_dominant_purpose: z.literal(true), // must be true for a valid supporting activity
    explanation: Char4000,
  }),
  evidence_kept: Char4000,
});

export const PortalFieldCharacterLimits = {
  core: {
    description: 4000,
    sources_investigated: 4000,
    why_competent_professional_couldnt_know: 4000,
    hypothesis: 4000,
    experiment: 4000,
    evaluation: 4000,
    conclusions: 4000,
    new_knowledge_purpose: 4000,
  },
  supporting: {
    description: 4000,
    how_supports_core_rd: 4000,
    dominant_purpose_explanation: 4000,
    evidence_kept: 4000,
  },
};

export type CorePortalFields = z.infer<typeof CorePortalFieldsSchema>;
export type SupportingPortalFields = z.infer<typeof SupportingPortalFieldsSchema>;
```

**Step 5: Commit**

```bash
git add packages/schemas/src/portal-fields.ts packages/schemas/src/portal-fields.test.ts
git commit -m "feat(schemas): Zod schemas for AusIndustry portal fields (A.2)"
```

### Task A.3 — Update Agent C narrative drafter prompt for per-field generation

**Type:** TDD code (agent prompt + integration)

**Files:**
- Modify: `packages/agents/src/narrative-drafter/prompts/draft-narrative@1.1.0.ts`
- Create: `packages/agents/src/narrative-drafter/prompts/draft-narrative@1.2.0.ts` (NEW VERSION)
- Modify: `packages/agents/src/narrative-drafter/index.ts` (default to v1.2.0)
- Update tests

**Step 1: Write failing test**

```ts
import { test } from 'node:test';
import { draftNarrative } from './index.js';
import { CorePortalFieldsSchema } from '@cpa/schemas/portal-fields';

test('draft-narrative@1.2.0: emits all 13 core portal fields for core activity', async () => {
  const result = await draftNarrative({
    activity: { kind: 'core', /* ... */ },
    promptVersion: '1.2.0',
  });
  // Should produce object that parses cleanly against CorePortalFieldsSchema
  CorePortalFieldsSchema.parse(result.portal_fields);
});

test('draft-narrative@1.2.0: respects 4000-char limit per field', async () => {
  const result = await draftNarrative({ /* ... */ });
  for (const [field, value] of Object.entries(result.portal_fields)) {
    if (typeof value === 'string') {
      assert.ok(value.length <= 4000, `${field} exceeds 4000 chars`);
    }
  }
});
```

**Step 2-4:** TDD pattern. Bump prompt version (don't modify v1.1.0 in place — preserves audit trail of which activities were drafted with which prompt). New v1.2.0 prompt asks Anthropic to produce a JSON object with all 13/9 fields, validated by Zod on response.

**Step 5: Commit**

```bash
git add packages/agents/src/narrative-drafter/
git commit -m "feat(agents): draft-narrative v1.2.0 emits per-portal-field structured output (A.3)"
```

### Task A.4 — `POST /v1/activities/:id/portal-fields` endpoint to persist Agent C output

**Type:** TDD code

**Files:**
- Create: `apps/api/src/routes/activity-portal-fields.ts`
- Create: `apps/api/src/routes/activity-portal-fields.test.ts`
- Modify: `apps/api/src/app.ts` (register route)

**Step 1-5:** Standard TDD. Endpoint accepts `CorePortalFieldsSchema` or `SupportingPortalFieldsSchema` (selected by `activity.kind`), validates, persists to `activity.portal_fields` jsonb. Idempotent.

```bash
git commit -m "feat(api): POST /v1/activities/:id/portal-fields endpoint (A.4)"
```

### Task A.5 — Trigger Agent C portal-fields generation from existing narrative-drafter route

**Type:** TDD code (integration)

**Files:**
- Modify: existing narrative drafter route handler

**Steps:** When the existing narrative drafter completes, also call the v1.2.0 prompt path to emit portal_fields and persist via Task A.4's endpoint. Both `narrative_segment` (4 thematic) and `activity.portal_fields` (13 portal-aligned) get populated. The thematic segments remain useful for summary views; portal_fields is for export.

```bash
git commit -m "feat(api): wire Agent C portal-fields generation alongside thematic narrative (A.5)"
```

### Task A.6 — `GET /v1/claims/:id/portal-pack` — Export Portal Pack endpoint

**Type:** TDD code (read-side aggregation)

**Files:**
- Create: `apps/api/src/routes/claim-portal-pack.ts`
- Create: `apps/api/src/routes/claim-portal-pack.test.ts`
- Create: `packages/agents/src/portal-pack-formatter.ts` — Markdown formatter

**Step 1: Write failing test**

```ts
test('GET /v1/claims/:id/portal-pack: returns markdown with all activities + character counts', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${claimId}/portal-pack`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/markdown; charset=utf-8');
  const md = res.payload;
  assert.match(md, /## Core Activity: CA-01/);
  assert.match(md, /\*\*Field 1: Activity Name\*\* \(\d+ \/ 200\)/);
  assert.match(md, /\*\*Field 6: Hypothesis\*\* \(\d+ \/ 4000\)/);
  // 13 fields per core, 9 per supporting
});
```

**Step 2-4:** TDD pattern. Server reads all activities for the claim, aggregates `portal_fields`, formats as markdown with each field clearly labeled + character count. Output is copy-paste ready for AusIndustry portal.

```bash
git commit -m "feat(api): GET /v1/claims/:id/portal-pack — Markdown export with field-level character counts (A.6)"
```

### Task A.7 — Web UI — "Export Portal Pack" button on claim detail page

**Type:** TDD code + UX

**Files:**
- Modify: `apps/web/src/app/claims/[claim_id]/page.tsx` (add button)
- Create: `apps/web/src/components/portal-pack-export-button.tsx`

**Steps:** Standard React component. Button hits `/v1/claims/:id/portal-pack`, downloads as `.md` file OR opens in modal with copy-to-clipboard per field. Per-field copy is friendlier UX (consultant pastes one field at a time into AusIndustry portal).

```bash
git commit -m "feat(web): Export Portal Pack button on claim detail with per-field copy (A.7)"
```

### Task A.8 — Sprint A contract test

**Files:** `apps/api/src/routes/portal-pack.contract.test.ts`

**Steps:** End-to-end: create claim with 2 core + 2 supporting activities → trigger Agent C drafting → verify `portal_fields` populated for all 4 → call `/portal-pack` → verify all 13×2 + 9×2 fields present in output, all under 4000 chars.

```bash
git commit -m "test(api): Sprint A portal-pack contract test (A.8)"
```

### Sprint A → PR

```
gh pr create --title "feat(rdti): AusIndustry portal-pack export with 13-core/9-supporting field structure (Sprint A)"
```

---

## Sprint B — Feedstock + R&D intensity tier (~3-4 days)

**Goal:** Implement Section 355-465 feedstock adjustment + Section 355-100 R&D intensity tier logic for ≥$20M turnover entities.

### Task B.1 — Migration `0045_subject_tenant_financial_metrics.sql`

**Type:** TDD code (migration)

**Files:**
- Create: `packages/db/migrations/0045_subject_tenant_financial_metrics.sql`
- Update journal + Drizzle schema

**Step 1-5:**

```sql
ALTER TABLE subject_tenant
  ADD COLUMN aggregated_turnover_aud numeric(14,2),
  ADD COLUMN total_expenditure_aud numeric(14,2),
  ADD COLUMN feedstock_revenue_aud numeric(14,2) DEFAULT 0,
  ADD COLUMN feedstock_input_cost_aud numeric(14,2) DEFAULT 0;

-- Index for fast filtering by entity size (drives offset rate)
CREATE INDEX subject_tenant_turnover_idx ON subject_tenant (aggregated_turnover_aud);
```

```bash
git commit -m "feat(db): subject_tenant financial-metrics columns for offset + feedstock calc (B.1)"
```

### Task B.2 — Feedstock calculator

**Type:** TDD code

**Files:**
- Create: `packages/audit-score/src/feedstock-calculator.ts`
- Create: `packages/audit-score/src/feedstock-calculator.test.ts`

**Step 1: Write failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFeedstockAdjustment } from './feedstock-calculator.js';

test('feedstock: 1/3 of min(revenue, input_cost) — revenue is binding', () => {
  const result = calculateFeedstockAdjustment({
    feedstock_revenue_aud: 90000,
    feedstock_input_cost_aud: 150000,
  });
  // min = 90000, 1/3 = 30000
  assert.equal(result.adjustment_aud, 30000);
  assert.equal(result.binding_constraint, 'revenue');
});

test('feedstock: input cost is binding when lower', () => {
  const result = calculateFeedstockAdjustment({
    feedstock_revenue_aud: 200000,
    feedstock_input_cost_aud: 60000,
  });
  // min = 60000, 1/3 = 20000
  assert.equal(result.adjustment_aud, 20000);
  assert.equal(result.binding_constraint, 'input_cost');
});

test('feedstock: zero when no feedstock activity', () => {
  const result = calculateFeedstockAdjustment({
    feedstock_revenue_aud: 0,
    feedstock_input_cost_aud: 0,
  });
  assert.equal(result.adjustment_aud, 0);
});
```

**Step 2-4:** Implement.

```ts
// packages/audit-score/src/feedstock-calculator.ts
export interface FeedstockInput {
  feedstock_revenue_aud: number;
  feedstock_input_cost_aud: number;
}

export interface FeedstockResult {
  adjustment_aud: number;
  binding_constraint: 'revenue' | 'input_cost' | 'none';
}

/**
 * Section 355-465 feedstock adjustment.
 *
 * When R&D activities produce sellable goods, the eligible R&D
 * expenditure must be reduced by 1/3 of the lesser of:
 *   - feedstock revenue (sales of those goods)
 *   - feedstock input expenditure (cost of inputs to those goods)
 *
 * This prevents the offset from subsidising profitable manufacturing.
 * Failure to apply when applicable is a common audit trigger.
 */
export function calculateFeedstockAdjustment(input: FeedstockInput): FeedstockResult {
  const { feedstock_revenue_aud, feedstock_input_cost_aud } = input;
  if (feedstock_revenue_aud === 0 && feedstock_input_cost_aud === 0) {
    return { adjustment_aud: 0, binding_constraint: 'none' };
  }
  const lesser = Math.min(feedstock_revenue_aud, feedstock_input_cost_aud);
  return {
    adjustment_aud: Math.round((lesser / 3) * 100) / 100, // round to cents
    binding_constraint:
      feedstock_revenue_aud <= feedstock_input_cost_aud ? 'revenue' : 'input_cost',
  };
}
```

```bash
git commit -m "feat(audit-score): Section 355-465 feedstock adjustment calculator (B.2)"
```

### Task B.3 — R&D intensity tier logic for ≥$20M entities

**Type:** TDD code (refactor existing clawback-calculator)

**Files:**
- Modify: `packages/audit-score/src/clawback-calculator.ts`
- Modify: `packages/audit-score/src/clawback-calculator.test.ts`

**Step 1: Write failing tests**

```ts
test('clawback: large entity, low intensity (<2%) gets +8.5pp offset', () => {
  const result = calculateOffsetRate({
    aggregated_turnover_aud: 50_000_000, // $50M
    total_expenditure_aud: 10_000_000,    // $10M
    eligible_rd_expenditure_aud: 100_000, // $100K → intensity 1%
  });
  assert.equal(result.offset_rate, 0.335); // 25% company tax + 8.5pp
  assert.equal(result.tier, 'large_low_intensity');
});

test('clawback: large entity, high intensity (>2%) gets +16.5pp offset', () => {
  const result = calculateOffsetRate({
    aggregated_turnover_aud: 50_000_000,
    total_expenditure_aud: 10_000_000,
    eligible_rd_expenditure_aud: 500_000, // 5% intensity
  });
  assert.equal(result.offset_rate, 0.415); // 25% + 16.5pp
  assert.equal(result.tier, 'large_high_intensity');
});

test('clawback: small entity uses refundable rate regardless of intensity', () => {
  const result = calculateOffsetRate({
    aggregated_turnover_aud: 10_000_000, // <$20M
    total_expenditure_aud: 5_000_000,
    eligible_rd_expenditure_aud: 800_000, // 16% intensity
  });
  assert.equal(result.offset_rate, 0.435); // refundable, intensity ignored
  assert.equal(result.tier, 'small_refundable');
});
```

**Step 2-4:** Implement.

```ts
// packages/audit-score/src/clawback-calculator.ts (additions)
export interface OffsetRateInput {
  aggregated_turnover_aud: number;
  total_expenditure_aud: number;
  eligible_rd_expenditure_aud: number;
}

export interface OffsetRateResult {
  offset_rate: number;
  tier: 'small_refundable' | 'large_low_intensity' | 'large_high_intensity';
  rd_intensity_pct: number | null; // null for small entities
}

const LARGE_ENTITY_THRESHOLD_AUD = 20_000_000;
const COMPANY_TAX_RATE = 0.25;
const SMALL_REFUNDABLE_PREMIUM = 0.185; // +18.5pp
const LARGE_LOW_INTENSITY_PREMIUM = 0.085; // +8.5pp
const LARGE_HIGH_INTENSITY_PREMIUM = 0.165; // +16.5pp
const INTENSITY_TIER_THRESHOLD = 0.02; // 2%

export function calculateOffsetRate(input: OffsetRateInput): OffsetRateResult {
  if (input.aggregated_turnover_aud < LARGE_ENTITY_THRESHOLD_AUD) {
    return {
      offset_rate: COMPANY_TAX_RATE + SMALL_REFUNDABLE_PREMIUM, // 43.5%
      tier: 'small_refundable',
      rd_intensity_pct: null,
    };
  }
  const intensity = input.eligible_rd_expenditure_aud / input.total_expenditure_aud;
  if (intensity <= INTENSITY_TIER_THRESHOLD) {
    return {
      offset_rate: COMPANY_TAX_RATE + LARGE_LOW_INTENSITY_PREMIUM, // 33.5%
      tier: 'large_low_intensity',
      rd_intensity_pct: intensity,
    };
  }
  return {
    offset_rate: COMPANY_TAX_RATE + LARGE_HIGH_INTENSITY_PREMIUM, // 41.5%
    tier: 'large_high_intensity',
    rd_intensity_pct: intensity,
  };
}
```

Update existing `calculateClawback` to use this new offset-rate calc instead of the flat `RDTI_OFFSET_RATE_LARGE`. Keep backward-compat exports.

```bash
git commit -m "feat(audit-score): Section 355-100 R&D intensity tiers for large entities (B.3)"
```

### Task B.4 — Integrate feedstock + intensity into eligible expenditure calculation

**Type:** TDD code

**Files:**
- Create or modify: relevant expenditure-aggregation routes (e.g., `apps/api/src/routes/claim-eligible-expenditure.ts`)
- Tests

**Steps:** When a claim's eligible expenditure is computed, apply feedstock adjustment from `subject_tenant.feedstock_*` columns + intensity-tier offset rate from `subject_tenant.aggregated_turnover_aud`. Surface in PDF + invoice + claim summary endpoints.

```bash
git commit -m "feat(api): apply feedstock + intensity-tier in eligible-expenditure calc (B.4)"
```

### Task B.5 — Sprint B contract test

```bash
git commit -m "test(audit-score,api): Sprint B feedstock + intensity contract test (B.5)"
```

### Sprint B → PR

```
gh pr create --title "feat(rdti): Section 355-465 feedstock + Section 355-100 intensity tiers (Sprint B)"
```

---

## Sprint C — Checkbox structures (~2-3 days)

**Goal:** Add structured checkbox fields for AusIndustry portal Field 3 (outcome unknown methods) and Field 10 (evidence kept categories) so the Portal Pack export carries them as discrete selections.

### Task C.1 — Migration `0046_activity_checkbox_arrays.sql`

**Type:** TDD code (migration)

**Files:**
- Create: `packages/db/migrations/0046_activity_checkbox_arrays.sql`

```sql
-- These columns may be redundant with activity.portal_fields jsonb (which
-- includes outcome_unknown_methods + evidence_kept_categories). Decision:
-- store both — jsonb for export composition, dedicated columns for indexing
-- + queryability + RLS-aware filtering.

ALTER TABLE activity
  ADD COLUMN outcome_unknown_methods text[] DEFAULT '{}'::text[],
  ADD COLUMN evidence_kept_categories text[] DEFAULT '{}'::text[];

-- CHECK constraints enforcing enum values
ALTER TABLE activity
  ADD CONSTRAINT activity_outcome_unknown_methods_valid CHECK (
    outcome_unknown_methods <@ ARRAY[
      'no_applicable_literature', 'expert_advice', 'no_adaptable_solutions',
      'other', 'did_not_investigate'
    ]::text[]
  ),
  ADD CONSTRAINT activity_evidence_kept_categories_valid CHECK (
    evidence_kept_categories <@ ARRAY[
      'hypothesis_design', 'results_evaluation', 'experiment_revisions',
      'knowledge_searches', 'systematic_progression', 'other', 'no_records_kept'
    ]::text[]
  );

-- Index for finding compliance-risk activities (those that "did_not_investigate"
-- or "no_records_kept")
CREATE INDEX activity_compliance_risk_idx ON activity ((
  'did_not_investigate' = ANY(outcome_unknown_methods) OR
  'no_records_kept' = ANY(evidence_kept_categories)
));
```

```bash
git commit -m "feat(db): activity outcome_unknown_methods + evidence_kept_categories enum arrays (C.1)"
```

### Task C.2 — Compliance-risk warning logic

**Type:** TDD code

**Files:**
- Create: `packages/audit-score/src/compliance-risk-flags.ts`
- Tests

**Steps:** When an activity has `did_not_investigate` in outcome_unknown_methods OR `no_records_kept` in evidence_kept_categories, surface as critical compliance gap (red flag in audit summary, warning on Portal Pack export, blocking modal at submission). Test for these surfacing.

```bash
git commit -m "feat(audit-score): compliance-risk flagging for did_not_investigate / no_records_kept (C.2)"
```

### Task C.3 — Web UI checkbox controls

**Type:** TDD code + UX

**Files:**
- Modify: `apps/web/src/app/claims/[claim_id]/activities/[activity_id]/page.tsx`
- Create: `apps/web/src/components/activity-checkbox-fields.tsx`

**Steps:** UI for consultant to select applicable outcome-unknown methods + evidence-kept categories. Use design system tokens (cream + patina). Surface compliance warnings inline if they select the risky options.

```bash
git commit -m "feat(web): activity outcome-unknown + evidence-kept checkbox UI (C.3)"
```

### Task C.4 — Update Portal Pack export to include checkbox state

**Type:** TDD code (modification)

**Files:**
- Modify: `packages/agents/src/portal-pack-formatter.ts` (from Sprint A)

**Steps:** Sprint A's Markdown export now includes "Field 3: Outcome Unknown" with checkbox state expressed as `[X]` / `[ ]` in the Markdown.

```bash
git commit -m "feat(api): Portal Pack export includes Field 3 + Field 10 checkboxes (C.4)"
```

### Sprint C → PR

```
gh pr create --title "feat(rdti): outcome-unknown + evidence-kept checkbox arrays + compliance flags (Sprint C)"
```

---

## Sprint D — Registration form fields (~2 days)

**Goal:** Capture the AusIndustry registration form's Company / Financial / Employee fields so the registration data extraction (per skill spec) maps cleanly to the platform.

### Task D.1 — Migration `0047_subject_tenant_registration_metadata.sql`

**Type:** TDD code (migration)

**Files:**
- Create: `packages/db/migrations/0047_subject_tenant_registration_metadata.sql`

```sql
ALTER TABLE subject_tenant
  ADD COLUMN anzsic_division text,
  ADD COLUMN anzsic_class text,
  ADD COLUMN abn text,
  ADD COLUMN acn text,
  ADD COLUMN is_part_of_consolidated_group boolean DEFAULT false,
  ADD COLUMN total_employees_fte numeric(8,2),
  ADD COLUMN r_and_d_employees_fte numeric(8,2),
  ADD COLUMN stem_qualified_employees_count integer,
  ADD COLUMN tax_agent_name text,
  ADD COLUMN tax_agent_registration_number text;

-- ABN = 11 digits; ACN = 9 digits
ALTER TABLE subject_tenant
  ADD CONSTRAINT subject_tenant_abn_format CHECK (abn IS NULL OR abn ~ '^\d{11}$'),
  ADD CONSTRAINT subject_tenant_acn_format CHECK (acn IS NULL OR acn ~ '^\d{9}$');

-- Standard ANZSIC division codes (sect/class), see ABS 1292.0
-- We don't enforce a value list at DB level (codes change); validate at
-- application layer via a Zod enum derived from a static reference.
```

```bash
git commit -m "feat(db): subject_tenant registration metadata fields (ANZSIC, FTE, agent) (D.1)"
```

### Task D.2 — Zod schemas + reference data

**Type:** TDD code

**Files:**
- Create: `packages/schemas/src/registration-metadata.ts`
- Create: `packages/schemas/src/anzsic-codes.ts` (static reference table from ABS 1292.0)

**Steps:** Zod schemas for new fields. Static ANZSIC division codes (Section A through S; e.g. 'A' = Agriculture, 'M' = Professional/Scientific/Technical Services). Tests for format validation.

```bash
git commit -m "feat(schemas): registration-metadata Zod + ANZSIC reference table (D.2)"
```

### Task D.3 — API route for editing registration metadata

**Type:** TDD code

**Files:**
- Create or modify: `apps/api/src/routes/subject-tenant-registration.ts`
- Tests

**Steps:** PATCH endpoint to update registration fields. Server-side validation with Zod.

```bash
git commit -m "feat(api): PATCH /v1/subject-tenants/:id/registration endpoint (D.3)"
```

### Task D.4 — Web UI: registration metadata form

**Type:** TDD code + UX

**Files:**
- Modify or create: `apps/web/src/app/subject-tenants/[id]/registration/page.tsx`

**Steps:** Form with all registration fields. ANZSIC code dropdown sourced from static reference. ABN/ACN format validation. Coordinate with D.4 compliance UI work that is being handled separately (this is registration-side; D.4 is form-completeness side).

```bash
git commit -m "feat(web): subject_tenant registration metadata form (D.4)"
```

### Task D.5 — Surface registration data in Portal Pack export

**Type:** TDD code

**Files:**
- Modify: `packages/agents/src/portal-pack-formatter.ts`

**Steps:** Pre-pend the Portal Pack output with a "Company Registration" section containing the registration metadata, ready to copy into the AusIndustry portal's company-detail step.

```bash
git commit -m "feat(api): Portal Pack export pre-pends Company Registration section (D.5)"
```

### Sprint D → PR

```
gh pr create --title "feat(rdti): registration metadata fields (ANZSIC, FTE, ABN/ACN) (Sprint D)"
```

---

## Cross-cutting verification (after all 4 sprints merge)

### Final task — End-to-end skill-spec compliance test

**Type:** integration test against rdti-workflow skill spec

**Files:**
- Create: `apps/api/src/routes/rdti-skill-parity.contract.test.ts`

**Steps:** Walk through the full skill workflow:
1. Bulk ingest sample files via existing OCR pipeline
2. Trigger Agent B (activity register) → verify all activities have correct kind
3. Trigger Agent C v1.2.0 → verify all 13/9 portal_fields populated
4. Set checkbox arrays via API
5. Set registration metadata via API
6. Set financial metrics (turnover, expenditure, feedstock)
7. Call `GET /v1/claims/:id/portal-pack` → verify output matches skill spec exactly
8. Verify intensity-tier offset is correct for ≥$20M entity
9. Verify feedstock adjustment applied
10. Verify compliance flags raised for any did_not_investigate / no_records_kept

```bash
git commit -m "test(api): end-to-end rdti-skill-parity contract test (final)"
gh pr create --title "test(rdti): full skill-spec parity contract test (final)"
```

---

## Estimates summary

| Sprint | Effort | Calendar | PR |
|--------|--------|----------|-----|
| A — Portal field structure | ~5-7 days | week 1 | PR-A |
| B — Feedstock + intensity | ~3-4 days | week 2 | PR-B |
| C — Checkbox structures | ~2-3 days | week 2 | PR-C |
| D — Registration fields | ~2 days | week 2-3 | PR-D |
| Final E2E | ~1 day | end | PR-E |
| **Total** | **~13-17 days** | **~2-2.5 weeks** | **5 PRs** |

## Cumulative outcome

After all 4 sprints + final test merge to main:

- **100% rdti-workflow skill-spec parity** for portal-ready output
- AusIndustry registration ready in one click via "Export Portal Pack"
- Section 355-465 feedstock + Section 355-100 intensity tiers correctly computed
- Compliance-risk flagging for did_not_investigate / no_records_kept
- All registration metadata captured (ANZSIC, FTE, ABN/ACN)

The platform's superpowers (forensic chain, multi-cycle continuity, RIF, multi-entity similarity, AI feedback loop) remain intact + are now additive to a fully-skill-spec-compliant baseline.

End of R&DTI skill parity plan.
