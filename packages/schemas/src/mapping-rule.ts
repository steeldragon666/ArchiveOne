import { z } from 'zod';
import { Iso8601, Uuid } from './primitives.js';

/**
 * Wire-format Zod schemas for the mapping_rule REST surface (T-B9).
 *
 * **Layering**: `@cpa/schemas` is a leaf package (zod only, no @cpa/*
 * deps). `@cpa/integrations` depends on `@cpa/schemas` for Zod types,
 * so the canonical TypeScript types `RuleCondition` / `RuleAction` in
 * B8 cannot be imported here (would invert the layering and create a
 * cycle). Instead the Zod shapes here are the source of truth at the
 * wire boundary, and a TypeScript identity assertion in
 * `apps/api/src/routes/mapping-rules.ts` pins them against B8's runtime
 * types — drift surfaces at typecheck time in the API package without
 * polluting the schemas-package dependency graph.
 *
 * **Two layers of defence at the API boundary**:
 *
 *   1. Zod (this file) catches malformed request bodies — wrong field
 *      name, wrong op for a field, missing required keys.
 *   2. B8's `evaluateRule` catches semantic violations — apportion sum
 *      != 100, regex compile failure, inverted between range. The route
 *      layer triggers it by calling `evaluateRule(rule, dummy)` against
 *      a synthetic expenditure before the INSERT/UPDATE.
 */

// ---------------------------------------------------------------------------
// Condition schemas — one per (field, op) pair B8 accepts. The outer
// discriminated union is on `field`; for fields with multiple ops we
// nest a second `discriminatedUnion` on `op`. Total: 16 leaf shapes
// matching the 16 branches of B8's `RuleCondition` union.
// ---------------------------------------------------------------------------

const stringOpsSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('eq'), value: z.string(), case_insensitive: z.boolean().optional() }),
  z.object({
    op: z.literal('contains'),
    value: z.string(),
    case_insensitive: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('matches'),
    value: z.string(),
    case_insensitive: z.boolean().optional(),
  }),
]);

const contactNameConditionSchema = z
  .object({ field: z.literal('contact_name') })
  .and(stringOpsSchema);
const referenceConditionSchema = z.object({ field: z.literal('reference') }).and(stringOpsSchema);
const descriptionConditionSchema = z
  .object({ field: z.literal('description') })
  .and(stringOpsSchema);

const accountCodeConditionSchema = z.discriminatedUnion('op', [
  z.object({ field: z.literal('account_code'), op: z.literal('eq'), value: z.string() }),
  z.object({
    field: z.literal('account_code'),
    op: z.literal('in'),
    // `readonly string[]` on B8's side — z.array narrows to writable
    // string[]. Both are assignable to `readonly string[]` (the engine
    // never mutates), so the runtime contract holds.
    value: z.array(z.string()).min(1),
  }),
]);

const amountConditionSchema = z.discriminatedUnion('op', [
  z.object({
    field: z.literal('amount'),
    op: z.enum(['gt', 'gte', 'lt', 'lte']),
    value: z.number().finite(),
  }),
  z.object({
    field: z.literal('amount'),
    op: z.literal('between'),
    // [min, max] tuple — B8's engine throws InvalidRuleError if min > max
    // at evaluate time, so we don't pre-validate the order here.
    value: z.tuple([z.number().finite(), z.number().finite()]),
  }),
]);

const expenditureKindLiteral = z.enum(['INVOICE', 'BANK_TX', 'RECEIPT']);

const kindConditionSchema = z.discriminatedUnion('op', [
  z.object({ field: z.literal('kind'), op: z.literal('eq'), value: expenditureKindLiteral }),
  z.object({
    field: z.literal('kind'),
    op: z.literal('in'),
    value: z.array(expenditureKindLiteral).min(1),
  }),
]);

const currencyConditionSchema = z.discriminatedUnion('op', [
  z.object({ field: z.literal('currency'), op: z.literal('eq'), value: z.string() }),
  z.object({
    field: z.literal('currency'),
    op: z.literal('in'),
    value: z.array(z.string()).min(1),
  }),
]);

const dateConditionSchema = z.discriminatedUnion('op', [
  z.object({
    field: z.literal('date'),
    op: z.enum(['before', 'after']),
    // ISO date `YYYY-MM-DD` — lex-comparable, matches B8's contract.
    value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date'),
  }),
  z.object({
    field: z.literal('date'),
    op: z.literal('between'),
    value: z.tuple([
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ]),
  }),
]);

/**
 * Combined condition schema. Discriminated on `field` via a manual
 * `z.union` (Zod's discriminatedUnion can't compose with the
 * `z.object().and(z.discriminatedUnion('op', …))` patterns used above,
 * since `field` carries multiple ops on the string-field side). The
 * leaf type union still matches B8's `RuleCondition` exactly — pinned
 * by the identity assertion at the bottom of this file.
 */
export const ruleConditionSchema = z.union([
  contactNameConditionSchema,
  referenceConditionSchema,
  descriptionConditionSchema,
  accountCodeConditionSchema,
  amountConditionSchema,
  kindConditionSchema,
  currencyConditionSchema,
  dateConditionSchema,
]);

// ---------------------------------------------------------------------------
// Action schemas — one per `type` discriminant in B8's `RuleAction`.
// ---------------------------------------------------------------------------

export const ruleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('map_to_activity'), activity_id: Uuid }),
  z.object({
    type: z.literal('apportion'),
    allocations: z
      .array(z.object({ activity_id: Uuid, percentage: z.number().positive().finite() }))
      .min(1),
  }),
  z.object({ type: z.literal('flag_for_review'), reason: z.string().min(1) }),
]);

// ---------------------------------------------------------------------------
// Request bodies + list query.
// ---------------------------------------------------------------------------

/**
 * POST /v1/mapping-rules body. `enabled` defaults to `true` server-side
 * if omitted (matches the column default in 0018_mapping_rule.sql).
 * `conditions` may be empty — B8's engine treats `[]` as the catch-all
 * "match everything" rule (vacuous truth), useful at the bottom of the
 * priority stack.
 */
export const createMappingRuleBody = z.object({
  name: z.string().min(1).max(200),
  priority: z.number().int().nonnegative(),
  enabled: z.boolean().optional(),
  conditions: z.array(ruleConditionSchema),
  action: ruleActionSchema,
});
// Type name disambiguated from the legacy `CreateMappingRuleBody` in
// expenditure_mapping_rule.ts (F4/F5 era, different shape) — both
// schemas live until the F4/F5 surface is retired.
export type CreateMappingRuleApiBody = z.infer<typeof createMappingRuleBody>;

/**
 * PATCH /v1/mapping-rules/:id body. All fields optional; the route
 * layer rejects empty patches with a 400 (mirrors brand-config PATCH).
 */
export const updateMappingRuleBody = createMappingRuleBody.partial();
export type UpdateMappingRuleApiBody = z.infer<typeof updateMappingRuleBody>;

/**
 * GET /v1/mapping-rules query. `enabled` filters on the soft-delete /
 * disable flag; omitting it returns both. `cursor` is opaque base64url
 * JSON — clients shouldn't introspect.
 *
 * `enabled` MUST be a value-aware transformer rather than
 * `z.coerce.boolean()` — the latter calls `Boolean(value)`, which
 * returns `true` for ANY non-empty string (including the literal
 * string `'false'`). A naive coerce would silently flip
 * `?enabled=false` into a filter for enabled=true rows. The enum +
 * transform pattern locks the contract to the two valid wire values.
 */
export const listMappingRulesQuery = z.object({
  enabled: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});
export type ListMappingRulesQuery = z.infer<typeof listMappingRulesQuery>;

/**
 * Wire-format response for a single mapping rule. The route's `toApi`
 * helper constructs this from the raw row. Note `tenant_id` is included
 * for the consumer's convenience — it always equals the active firm
 * (RLS guarantees no cross-firm rows escape the query).
 */
export const mappingRuleApi = z.object({
  id: Uuid,
  tenant_id: Uuid,
  name: z.string(),
  priority: z.number().int().nonnegative(),
  enabled: z.boolean(),
  conditions: z.array(ruleConditionSchema),
  action: ruleActionSchema,
  created_at: Iso8601,
  created_by_user_id: Uuid,
  updated_at: Iso8601,
});
export type MappingRuleApi = z.infer<typeof mappingRuleApi>;

// Identity assertions against B8's runtime types live in
// apps/api/src/routes/mapping-rules.ts (the API package depends on both
// @cpa/schemas and @cpa/integrations, so the assertion can be expressed
// there without inverting the schemas-package layering).
