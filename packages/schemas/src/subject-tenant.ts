import { z } from 'zod';
import { Iso8601, Uuid } from './primitives.js';

/**
 * Subject-tenant kind discriminator.
 *
 * - claimant: owned by the firm; firm staff have access via subject_tenant_user
 *   roles (T7 schema). The default kind for the create endpoint.
 * - financier: granted scoped read access via delegation_token (T8 schema, P8
 *   API surface). Does not have firm-level membership.
 *
 * Mirrors the DB-level enum on `subject_tenant.kind` (packages/db/src/schema/
 * subject_tenant.ts).
 */
export const subjectTenantKind = z.enum(['claimant', 'financier']);
export type SubjectTenantKind = z.infer<typeof subjectTenantKind>;

/**
 * Role of this subject within its corporate group. Migration 0098.
 *
 * Dual SOT pattern — keep in sync with the SQL CHECK in migration 0098
 * AND the Drizzle ENTITY_KINDS export in @cpa/db.
 *
 *   standalone        — single entity claiming on its own (default).
 *   head_company      — top of a consolidated group; aggregates subsidiary
 *                       turnover for the s.328-115 test.
 *   r_and_d_entity    — subsidiary actually performing the R&D work.
 *   associate_entity  — subsidiary whose payments to the R&D entity trigger
 *                       the s.355-220 associate rule.
 */
export const ENTITY_KINDS_LITERAL = [
  'standalone',
  'head_company',
  'r_and_d_entity',
  'associate_entity',
] as const;
export const entityKind = z.enum(ENTITY_KINDS_LITERAL);
export type EntityKind = z.infer<typeof entityKind>;

/** Postgres NUMERIC(14,2) wire-format. */
const Numeric14_2Regex = /^-?\d{1,12}\.\d{2}$/;

/**
 * Public shape of a subject_tenant row over the API. Timestamps are
 * ISO-8601 with offset (matches the audit-anchor convention used across
 * @cpa/schemas).
 */
export const subjectTenant = z.object({
  id: Uuid,
  tenant_id: Uuid,
  name: z.string(),
  kind: subjectTenantKind,
  created_at: Iso8601,
  updated_at: Iso8601,
  // Migration 0098 — multi-entity / corporate-group fields. Optional on
  // the wire so legacy rows + older clients round-trip cleanly.
  entity_kind: entityKind.default('standalone'),
  head_company_id: Uuid.nullable().optional(),
  aggregated_turnover_aud: z.string().regex(Numeric14_2Regex).nullable().optional(),
  aggregated_turnover_fy_label: z.string().nullable().optional(),
});
export type SubjectTenant = z.infer<typeof subjectTenant>;

/**
 * POST /v1/subject-tenants body. Defaults `kind` to 'claimant' since that's
 * the dominant case (financier subject-tenants are created via a separate
 * delegation flow in P8).
 */
export const createSubjectTenantBody = z.object({
  name: z.string().min(1).max(200),
  kind: subjectTenantKind.default('claimant'),
});
export type CreateSubjectTenantBody = z.infer<typeof createSubjectTenantBody>;

/**
 * GET /v1/subject-tenants query — optional `kind` filter for narrowing.
 * Omit to list all kinds in the active firm.
 */
export const listSubjectTenantsQuery = z.object({
  kind: subjectTenantKind.optional(),
});
export type ListSubjectTenantsQuery = z.infer<typeof listSubjectTenantsQuery>;

/**
 * PATCH /v1/subject-tenants/:id body — partial update.
 *
 * `name` and `kind` are the only consultant-editable fields on a
 * subject_tenant. Identity (`id`, `tenant_id`) and lifecycle
 * timestamps (`created_at`, `updated_at`) are server-managed.
 * Soft-delete uses DELETE /v1/subject-tenants/:id (sets `deleted_at`).
 *
 * `.strict()` rejects unknown keys — protects against silent typos.
 */
export const updateSubjectTenantBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    kind: subjectTenantKind.optional(),
    // Migration 0098 — multi-entity fields editable via PATCH.
    entity_kind: entityKind.optional(),
    head_company_id: Uuid.nullable().optional(),
    aggregated_turnover_aud: z.string().regex(Numeric14_2Regex).nullable().optional(),
    aggregated_turnover_fy_label: z.string().min(1).max(20).nullable().optional(),
  })
  .strict();
export type UpdateSubjectTenantBody = z.infer<typeof updateSubjectTenantBody>;

/**
 * Helper: compute the R&DTI offset rate (43.5% small / 38.5% large) per
 * s.328-115. Returns null when the entity has no aggregated_turnover_aud
 * yet — the caller surfaces a UI prompt to capture it.
 *
 *   <  $20,000,000  → 0.435 (refundable small-entity rate)
 *   >= $20,000,000  → 0.385 (non-refundable corporate-tax-rate plus 8.5pp)
 *
 * Pure projection on the wire shape so both the API + UI can share the
 * derivation without diverging.
 */
export const OFFSET_RATE_SMALL = 0.435;
export const OFFSET_RATE_LARGE = 0.385;
export const AGGREGATED_TURNOVER_THRESHOLD_AUD = 20_000_000;

export function offsetRateForAggregatedTurnover(
  aggregated_turnover_aud: string | null | undefined,
): typeof OFFSET_RATE_SMALL | typeof OFFSET_RATE_LARGE | null {
  if (aggregated_turnover_aud == null || aggregated_turnover_aud === '') return null;
  const n = Number(aggregated_turnover_aud);
  if (!Number.isFinite(n)) return null;
  return n < AGGREGATED_TURNOVER_THRESHOLD_AUD ? OFFSET_RATE_SMALL : OFFSET_RATE_LARGE;
}
