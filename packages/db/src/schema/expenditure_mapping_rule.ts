import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { activity } from './activity.js';
import { tenant } from './tenant.js';

/**
 * Expenditure mapping rule — a per-tenant rule that auto-suggests
 * (or auto-applies) an R&D apportionment percentage for incoming
 * expenditure lines based on vendor / account-code / description
 * patterns (per design doc §"Core tables").
 *
 * Lookup semantics: when an `expenditure_line` is ingested or
 * reviewed, the rule engine (F5) walks rules in descending
 * `priority` order and returns the highest-priority match. Each
 * predicate column is independently optional — a rule with only
 * `vendor_pattern` set matches purely on vendor; a rule with all
 * four predicates set requires every match to fire.
 *
 * Predicate columns (each independently nullable; NULL means "any"):
 *   - `source` — match by Xero source. Must be one of the
 *     `EXPENDITURE_SOURCES` values for an exact match, or NULL for
 *     "any source" (wildcard). The `'*'` magic string is NOT used; NULL
 *     is the wildcard, consistent with the other predicate fields below.
 *     F4 will hand-author a CHECK constraint
 *     `CHECK (source IS NULL OR source IN ('xero_invoice', 'xero_bank_tx',
 *     'xero_receipt', 'manual'))`.
 *   - `vendor_pattern` — POSIX regex against `expenditure.vendor_name`;
 *     NULL means "any vendor".
 *   - `account_code` — exact match against `expenditure_line.account_code`;
 *     NULL means "any code".
 *   - `description_pattern` — POSIX regex against `expenditure_line.description`;
 *     NULL means "any description".
 *
 * Action columns:
 *   - `activity_id` — FK to the `activity` row whose narrative this
 *     expenditure should attach to.
 *   - `rd_percent` — apportionment percentage to suggest (0-100).
 *     CHECK 0-100 hand-authored in F4.
 *
 * `priority` is an integer; higher values win. Ties are broken in
 * insertion order (id ordering) — but the route layer should not
 * rely on that.
 *
 * RLS-protected (F4 hand-authors): tenant_id =
 *   current_setting('app.current_tenant_id', true)::uuid
 *
 * Naming convention: camelCase TS / snake_case SQL (per T5/T6 chain).
 */
export const expenditureMappingRule = pgTable(
  'expenditure_mapping_rule',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    // Per-source filter; NULL = wildcard ("any source"). F4 hand-authors
    // CHECK (source IS NULL OR source IN (...EXPENDITURE_SOURCES)).
    source: text('source'),
    // POSIX regex against expenditure.vendor_name.
    vendorPattern: text('vendor_pattern'),
    // Exact match against expenditure_line.account_code.
    accountCode: text('account_code'),
    // POSIX regex against expenditure_line.description.
    descriptionPattern: text('description_pattern'),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activity.id),
    // Apportionment % (0-100); CHECK 0-100 hand-authored in F4.
    rdPercent: integer('rd_percent').notNull(),
    // Highest match wins; ties broken in insertion order.
    priority: integer('priority').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('expenditure_mapping_rule_tenant_idx').on(t.tenantId),
    activityIdx: index('expenditure_mapping_rule_activity_idx').on(t.activityId),
  }),
);
