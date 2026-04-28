import { z } from 'zod';
import { Iso8601, Uuid } from './primitives.js';
import { ExpenditureSource } from './expenditure.js';

/**
 * Public shape of an `expenditure_mapping_rule` row over the API.
 *
 * Predicate columns (each independently nullable; NULL means "any"):
 *   - `source` — match by Xero source. `null` = wildcard ("any source").
 *   - `vendor_pattern` — POSIX regex against `expenditure.vendor_name`;
 *     `null` = "any vendor".
 *   - `account_code` — exact match against `expenditure_line.account_code`;
 *     `null` = "any code".
 *   - `description_pattern` — POSIX regex against
 *     `expenditure_line.description`; `null` = "any description".
 *
 * Action columns:
 *   - `activity_id` — FK to the `activity` row whose narrative this
 *     expenditure should attach to.
 *   - `rd_percent` — apportionment percentage to suggest (0-100).
 *
 * `priority` is an integer; higher values win. Ties are broken in
 * insertion order (id ordering) — but the route layer does not rely
 * on that.
 */
export const ExpenditureMappingRule = z.object({
  id: Uuid,
  tenant_id: Uuid,
  source: ExpenditureSource.nullable(),
  vendor_pattern: z.string().nullable(),
  account_code: z.string().nullable(),
  description_pattern: z.string().nullable(),
  activity_id: Uuid,
  rd_percent: z.number().int().min(0).max(100),
  priority: z.number().int(),
  created_at: Iso8601,
  updated_at: Iso8601,
});
export type ExpenditureMappingRule = z.infer<typeof ExpenditureMappingRule>;

/**
 * POST /v1/expenditure-mapping-rules body. All predicate columns are
 * independently optional / nullable — at least one should be set in
 * practice (a rule with every predicate `null` would match every
 * expenditure line, which the route layer rejects), but the schema
 * itself does not enforce that.
 *
 * `tenant_id` and timestamps are derived from the session / clock,
 * not the body.
 */
export const CreateMappingRuleBody = z.object({
  source: ExpenditureSource.nullable().optional(),
  vendor_pattern: z.string().nullable().optional(),
  account_code: z.string().nullable().optional(),
  description_pattern: z.string().nullable().optional(),
  activity_id: Uuid,
  rd_percent: z.number().int().min(0).max(100),
  priority: z.number().int(),
});
export type CreateMappingRuleBody = z.infer<typeof CreateMappingRuleBody>;
