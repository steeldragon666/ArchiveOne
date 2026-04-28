import { index, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { expenditure } from './expenditure.js';

/**
 * Expenditure line — a single line item within an `expenditure` row,
 * carrying the per-account-code amount and (after consultant review)
 * the R&D apportionment percentage (per design doc §"Core tables").
 *
 * One expenditure typically has one-to-many lines:
 *   - A Xero invoice with multiple line items splits into N rows
 *     here.
 *   - A bank transaction or receipt usually maps to a single line
 *     (the whole amount).
 *
 * `account_code` is the upstream Xero account code (e.g. "400", "404")
 * — used by the mapping rule engine in F5 to suggest a default
 * `rd_percent` based on the consultant's prior decisions.
 *
 * `amount` matches the upstream line amount; the sum of lines should
 * equal `expenditure.total_amount` minus any tax/fee variations
 * (validation lives in the route layer, not as a DB constraint).
 *
 * `rd_percent` is nullable: null means the line is unmapped (awaiting
 * consultant review). Once mapped, it sits in [0, 100] — the 0-100
 * CHECK constraint is hand-authored in F4.
 *
 * No tenant_id column on this table: tenancy is inherited transitively
 * via `expenditure_id → expenditure.tenant_id`. RLS on the parent is
 * therefore sufficient — F4 will not add RLS to this table directly,
 * matching the F1 pattern where children of an RLS-protected parent
 * inherit isolation through the FK chain.
 *
 * No created_at / updated_at: lines are immutable from the
 * sync/ingestion layer's perspective (re-syncing replaces the parent
 * expenditure's lines as a unit). The route layer handles this as
 * delete+reinsert under one transaction.
 *
 * FK does NOT carry ON DELETE CASCADE in this initial F3 schema —
 * Drizzle does not emit cascade by default and the design doc does
 * not commit to cascade semantics. F4 (or a later task) can layer
 * cascade on if the route layer's delete+reinsert pattern proves
 * insufficient.
 *
 * Naming convention: camelCase TS / snake_case SQL (per T5/T6 chain).
 */
export const expenditureLine = pgTable(
  'expenditure_line',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    expenditureId: uuid('expenditure_id')
      .notNull()
      .references(() => expenditure.id),
    description: text('description').notNull(),
    // Xero account code (e.g. "400"); used for mapping-rule lookup in F5.
    accountCode: text('account_code'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    // Apportionment % (0-100); null = unmapped. CHECK 0-100 hand-authored in F4.
    rdPercent: integer('rd_percent'),
  },
  (t) => ({
    expenditureIdx: index('expenditure_line_expenditure_idx').on(t.expenditureId),
  }),
);
