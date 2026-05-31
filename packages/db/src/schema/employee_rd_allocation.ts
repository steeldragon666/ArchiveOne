import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { activity } from './activity.js';
import { claim } from './claim.js';
import { subjectTenantEmployee } from './subject_tenant_employee.js';
import { tenant } from './tenant.js';
import { user } from './user.js';

/**
 * Per-employee R&D percentage allocation per TR 2021/5.
 *
 * The apportionment engine multiplies a salary expenditure's amount_aud
 * by the employee's `rd_percentage` to derive the R&D-claimable portion.
 * On-costs (super @ 11.5%, leave loading, payroll tax) follow the same %.
 *
 * `activity_id` is optional: NULL = "applies across all R&D activities in
 * this claim" (the common case). Non-null = "this % applies specifically
 * to that activity" (used when consultants track per-activity timesheets).
 *
 * The unique constraint `(employee_id, claim_id, activity_id)` prevents
 * duplicate rows for the same triple. The "claim-wide vs per-activity"
 * mutual exclusion (you can have one OR the other, never both for the
 * same employee+claim) is enforced at the application layer in
 * packages/schemas/src/employee-rd-allocation.ts.
 *
 * RLS: canonical NULLIF(...)::uuid tenant isolation.
 */

export const employeeRdAllocation = pgTable(
  'employee_rd_allocation',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claim.id),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => subjectTenantEmployee.id),
    activityId: uuid('activity_id').references(() => activity.id),
    rdPercentage: smallint('rd_percentage').notNull(),
    basisNote: text('basis_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('employee_rd_allocation_tenant_idx').on(t.tenantId),
    claimIdx: index('employee_rd_allocation_claim_idx').on(t.claimId),
    employeeIdx: index('employee_rd_allocation_employee_idx').on(t.employeeId),
    employeeClaimActivityUnique: uniqueIndex(
      'employee_rd_allocation_employee_claim_activity_key',
    ).on(t.employeeId, t.claimId, t.activityId),
    // Mirror the SQL CHECK in migration 0097 so application writes via
    // drizzle pick up the same validation surface.
    rdPercentageBounds: check(
      'employee_rd_allocation_rd_percentage_bounds',
      sql`${t.rdPercentage} BETWEEN 0 AND 100`,
    ),
  }),
);
