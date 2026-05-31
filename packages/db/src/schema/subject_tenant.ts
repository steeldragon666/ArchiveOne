import { numeric, pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { tenant } from './tenant.js';

/**
 * Claimant or financier — the consultant firm's "client" entity.
 *
 * `kind` discriminates between:
 *   - 'claimant': owned by the firm; firm staff have direct access via
 *     subject_tenant_user roles (T7).
 *   - 'financier': granted scoped read access via delegation_token (T8 schema, P8 API);
 *     does not have firm-level membership.
 *
 * Migration 0098 layered multi-entity / corporate-group modelling on top:
 *   - `entity_kind` discriminates standalone vs head_company vs
 *     r_and_d_entity vs associate_entity within a consolidated group.
 *   - `head_company_id` self-FK points at the top of the group (NULL for
 *     standalone + head rows).
 *   - `aggregated_turnover_aud` + `aggregated_turnover_fy_label` capture
 *     the s.328-115 number that drives the 38.5/43.5% offset split.
 *
 * RLS-protected: tenant_id = current_setting('app.current_tenant_id')::uuid.
 */

/**
 * Role of this subject within its corporate group. Migration 0098.
 *
 * Keep in sync with the SQL CHECK constraint in 0098 AND the Zod
 * ENTITY_KINDS_LITERAL export in @cpa/schemas/subject-tenant.ts.
 */
export const ENTITY_KINDS = [
  'standalone',
  'head_company',
  'r_and_d_entity',
  'associate_entity',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const subjectTenant = pgTable(
  'subject_tenant',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['claimant', 'financier'] })
      .notNull()
      .default('claimant'),
    // Migration 0098 — multi-entity corporate-group modelling.
    entityKind: text('entity_kind', { enum: ENTITY_KINDS }).notNull().default('standalone'),
    headCompanyId: uuid('head_company_id').references((): AnyPgColumn => subjectTenant.id),
    aggregatedTurnoverAud: numeric('aggregated_turnover_aud', { precision: 14, scale: 2 }),
    aggregatedTurnoverFyLabel: text('aggregated_turnover_fy_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    headCompanyIdx: index('subject_tenant_head_company_idx')
      .on(t.headCompanyId)
      .where(sql`${t.headCompanyId} IS NOT NULL`),
  }),
);
