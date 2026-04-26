import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { subjectTenant } from './subject_tenant.js';
import { user } from './user.js';

/**
 * Per-claimant access control. M:N — a user can have access to many
 * claimants, and a claimant can be worked on by many users.
 *
 * Roles (per-claimant, distinct from firm-level role on tenant_user):
 *   - 'lead': primary consultant on this claimant.
 *   - 'observer': read access only.
 *
 * Default-access semantics (set by application layer when adding a user
 * to a firm — schema does not enforce):
 *   - 'admin' role on tenant_user: implicitly has access to all claimants
 *     in the firm regardless of subject_tenant_user rows.
 *   - 'consultant' / 'viewer' on tenant_user: needs explicit
 *     subject_tenant_user row to access a claimant.
 *
 * RLS-protected (T11): subject_tenant_id IN (SELECT id FROM subject_tenant
 * WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)
 *
 * Naming convention: camelCase TS / snake_case SQL (per T5/T6 chain).
 */
export const subjectTenantUser = pgTable(
  'subject_tenant_user',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    subjectTenantId: uuid('subject_tenant_id')
      .notNull()
      .references(() => subjectTenant.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role', { enum: ['lead', 'observer'] })
      .notNull()
      .default('observer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    uniqAcl: uniqueIndex('subject_tenant_user_uniq').on(t.subjectTenantId, t.userId),
  }),
);
