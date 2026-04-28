import { z } from 'zod';
import { Iso8601, Uuid } from './primitives.js';

/**
 * Single source of truth for expenditure source classification over
 * the wire.
 *
 * Dual SOT pattern: `@cpa/schemas` (Zod, wire format) and `@cpa/db`
 * (Drizzle, storage) are intentionally independent SOTs — `@cpa/db`
 * depends on `@cpa/schemas` (one-way), so importing `EXPENDITURE_SOURCES`
 * from `@cpa/db/schema` here would invert the layering and pull
 * storage internals into the wire contract. The two lists must
 * therefore be kept in sync by hand.
 *
 * KEEP IN SYNC WITH:
 *   1. `EXPENDITURE_SOURCES` in `@cpa/db/schema/expenditure.ts`
 *   2. The `expenditure_source_valid` CHECK hand-authored in F4
 *      (migration 0013 appended block)
 *
 * Order matches `@cpa/db` byte-for-byte.
 */
export const EXPENDITURE_SOURCES_LITERAL = [
  'xero_invoice',
  'xero_bank_tx',
  'xero_receipt',
  'manual',
] as const;
export const ExpenditureSource = z.enum(EXPENDITURE_SOURCES_LITERAL);
export type ExpenditureSource = z.infer<typeof ExpenditureSource>;

/**
 * Calendar date in YYYY-MM-DD form. Matches the postgres `date` column
 * type used for `expenditure.expenditure_date` (the date the expense
 * was incurred, distinct from the `ingested_at` timestamptz).
 */
export const ExpenditureDateRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Numeric-as-string for `total_amount`. Postgres returns NUMERIC(12,2)
 * as a string by default (postgres-js doesn't auto-coerce to number,
 * which would lose precision for AUD over ~$10^15). The two-decimal
 * regex enforces the storage shape directly.
 */
export const NumericAmountRegex = /^\d+\.\d{2}$/;

/**
 * Public shape of an `expenditure` row over the API.
 *
 * `raw_payload` (the full upstream Xero JSON) is NOT surfaced — it's
 * storage-only audit data, not part of the wire contract. Routes that
 * need to expose subsets of it (e.g. line-item detail) project the
 * relevant fields explicitly.
 *
 * `voided_at` (nullable) is the soft-void marker. Voided expenditures
 * stay queryable for audit but are filtered from apportionment.
 */
export const Expenditure = z.object({
  id: Uuid,
  tenant_id: Uuid,
  subject_tenant_id: Uuid,
  source: ExpenditureSource,
  source_external_id: z.string().nullable(),
  vendor_name: z.string().min(1).max(500),
  reference: z.string().nullable(),
  expenditure_date: z.string().regex(ExpenditureDateRegex, 'must be YYYY-MM-DD'),
  total_amount: z.string().regex(NumericAmountRegex, 'must be N.NN (postgres NUMERIC(12,2))'),
  currency: z.string().min(3).max(3),
  reimbursed_to_user_id: Uuid.nullable(),
  ingested_at: Iso8601,
  voided_at: Iso8601.nullable(),
});
export type Expenditure = z.infer<typeof Expenditure>;

/**
 * POST /v1/expenditures body — manual entry capture.
 *
 * Xero-sourced rows arrive via the sync worker (not this endpoint), so
 * `source` is implicitly `'manual'` and not in the body. Likewise
 * `source_external_id` is null for manual entries.
 *
 * `currency` defaults to `'AUD'` (P4 is AUD-only; multi-currency may
 * return in P9). `reimbursed_to_user_id` is set when the entry
 * represents an employee expense claim.
 *
 * `tenant_id` is derived from the session.
 */
export const CreateManualExpenditureBody = z.object({
  subject_tenant_id: Uuid,
  vendor_name: z.string().min(1).max(500),
  reference: z.string().optional(),
  expenditure_date: z.string().regex(ExpenditureDateRegex, 'must be YYYY-MM-DD'),
  total_amount: z.string().regex(NumericAmountRegex, 'must be N.NN'),
  currency: z.string().min(3).max(3).default('AUD'),
  reimbursed_to_user_id: Uuid.optional(),
});
export type CreateManualExpenditureBody = z.infer<typeof CreateManualExpenditureBody>;
