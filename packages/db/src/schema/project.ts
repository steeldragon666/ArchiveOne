import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { subjectTenant } from './subject_tenant.js';
import { tenant } from './tenant.js';

/**
 * Project — a discrete piece of R&D work owned by a `subject_tenant`
 * (e.g. "ML pipeline rebuild", "robotic harvester firmware v3"). The
 * organising unit beneath the claim that activities and evidence
 * artefacts hang off (per design doc §"Core tables").
 *
 * Lifecycle:
 *   - `started_at` (NOT NULL): when the project work began. Used by
 *     downstream apportionment to bound the eligibility window.
 *   - `ended_at` (nullable): when the project finished — null for
 *     ongoing work.
 *   - `archived_at` (nullable): soft delete. Archived projects stay
 *     queryable for prior-year claims but are filtered from default
 *     active-project lists.
 *
 * `project_id` becomes the FK target referenced by `event.project_id`
 * (the column was carried as nullable-no-FK from P2 expressly so this
 * F1 schema could land it; the FK gets added when downstream code
 * starts populating the column — out of scope for F1).
 *
 * RLS-protected (F2 hand-authors the policy in this same migration's
 * appended block — see DO-NOT-REGENERATE header in the .sql file):
 *   tenant_id = current_setting('app.current_tenant_id', true)::uuid
 *
 * Naming convention: camelCase TS / snake_case SQL (per T5/T6 chain).
 */
export const project = pgTable(
  'project',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    subjectTenantId: uuid('subject_tenant_id')
      .notNull()
      .references(() => subjectTenant.id),
    name: text('name').notNull(),
    description: text('description'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('project_tenant_idx').on(t.tenantId),
    subjectTenantIdx: index('project_subject_tenant_idx').on(t.subjectTenantId),
  }),
);
