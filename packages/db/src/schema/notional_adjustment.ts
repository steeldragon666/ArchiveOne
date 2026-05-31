import { index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { claim } from './claim.js';
import { tenant } from './tenant.js';
import { user } from './user.js';

/**
 * Notional R&D adjustment — Subdiv 355-G line item.
 *
 * One row per ATO worksheet line that adjusts the notional R&D deduction.
 * The adjustment categories mirror the AusIndustry / ATO portal sections:
 *
 *   - 'feedstock'             — s.355-465; reduction for inputs consumed
 *   - 'recoupment'            — s.355-435; government grant clawback
 *   - 'associate_payment'     — s.355-205; associate spend, claimable
 *                                only when paid before year-end
 *   - 'depreciation'          — s.355-305/315; notional R&D deduction
 *   - 'balancing_adjustment'  — s.40-285; depreciating asset wash-up
 *
 * Sign convention is application-level (see migration 0097 COMMENT and
 * `packages/schemas/src/notional-adjustment.ts` for the rules).
 *
 * Three-way parity: kind values are mirrored in
 *   - migration 0097's CHECK constraint
 *   - NOTIONAL_ADJUSTMENT_KINDS export below
 *   - migrations.test.ts parity matrix
 *
 * RLS: tenant_id GUC isolation via canonical NULLIF(...)::uuid pattern.
 */

export const NOTIONAL_ADJUSTMENT_KINDS = [
  'feedstock',
  'recoupment',
  'associate_payment',
  'depreciation',
  'balancing_adjustment',
] as const;
export type NotionalAdjustmentKind = (typeof NOTIONAL_ADJUSTMENT_KINDS)[number];

export const notionalAdjustment = pgTable(
  'notional_adjustment',
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
    kind: text('kind', { enum: NOTIONAL_ADJUSTMENT_KINDS }).notNull(),
    amountAud: numeric('amount_aud', { precision: 14, scale: 2 }).notNull(),
    description: text('description').notNull(),
    statutoryAnchor: text('statutory_anchor').notNull(),
    firstRecordedAt: timestamp('first_recorded_at', { withTimezone: true }).notNull().defaultNow(),
    hypothesisFormedAt: timestamp('hypothesis_formed_at', { withTimezone: true }),
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
    tenantIdx: index('notional_adjustment_tenant_idx').on(t.tenantId),
    claimIdx: index('notional_adjustment_claim_idx').on(t.claimId),
    kindIdx: index('notional_adjustment_kind_idx').on(t.kind),
  }),
);
