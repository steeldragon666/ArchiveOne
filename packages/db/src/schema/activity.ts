import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { claim } from './claim.js';
import { project } from './project.js';
import { tenant } from './tenant.js';

/**
 * R&DTI activity — a Core Activity (CA-NN) or Supporting Activity
 * (SA-NN) registered against a claim, anchored to the project where
 * the work happened. Activities are the regulator-facing unit: each
 * one carries the Section 355-25 narrative chain (hypothesis →
 * technical uncertainty → experimentation log → expected/actual
 * outcome) per design doc §"Core tables".
 *
 * Uniqueness: `(claim_id, code)` — within a single fiscal-year claim,
 * each CA/SA code is unique (CA-01, CA-02, SA-01, SA-02, …). Codes can
 * repeat across different claims (a multi-year program would have
 * CA-01 in both 2024 and 2025 claims).
 *
 * `kind` is `'core' | 'supporting'`; `code` follows the `^(CA|SA)-\d+$`
 * shape (and `kind` must agree with the `code` prefix). Both columns
 * are plain `text` here — F2 hand-authors CHECK constraints enforcing
 * the enum (`kind IN ('core','supporting')`) and the regex
 * (`code ~ '^(CA|SA)-\d+$'`) plus the kind/code agreement check.
 *
 * Narrative fields are all nullable because activities pass through
 * stages of completion as the consultant gathers evidence — nothing
 * is required up-front beyond identity (`code`, `kind`, `title`).
 *
 * RLS-protected (F2 hand-authors): tenant_id =
 *   current_setting('app.current_tenant_id', true)::uuid
 *
 * Naming convention: camelCase TS / snake_case SQL (per T5/T6 chain).
 */
export const activity = pgTable(
  'activity',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claim.id),
    // CA-NN or SA-NN; CHECK constraint hand-authored in F2.
    code: text('code').notNull(),
    // 'core' | 'supporting'; CHECK constraint hand-authored in F2.
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    hypothesis: text('hypothesis'),
    technicalUncertainty: text('technical_uncertainty'),
    experimentationLog: text('experimentation_log'),
    expectedOutcome: text('expected_outcome'),
    actualOutcome: text('actual_outcome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('activity_tenant_idx').on(t.tenantId),
    projectIdx: index('activity_project_idx').on(t.projectId),
    claimIdx: index('activity_claim_idx').on(t.claimId),
    claimCodeUnique: uniqueIndex('activity_claim_code_unique').on(t.claimId, t.code),
  }),
);
