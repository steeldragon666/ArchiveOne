import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenant } from './tenant.js';
import { user } from './user.js';

/**
 * User's membership in a consultant firm. M:N — a user can belong to
 * multiple firms (rare but real for consultant partners across firms).
 *
 * `isDefault` marks which firm the user lands in at login when no
 * activeTenantId is in the session cookie. Exactly one row per user
 * SHOULD have isDefault=true; nothing in the schema enforces this
 * (the application layer manages it during user provisioning).
 *
 * Roles:
 *   - 'admin': can manage firm settings, billing, users, claimants.
 *   - 'consultant': default; works on claimants per subject_tenant_user ACL.
 *   - 'viewer': read-only across the firm.
 *
 * RLS-protected (T11): tenant_id = current_setting('app.current_tenant_id', true)::uuid
 *
 * Naming convention: camelCase TS / snake_case SQL (per T5/T6 chain
 * 2aa8e18 → 1149b17). Imports alphabetical (per T6 precedent).
 */
export const tenantUser = pgTable(
  'tenant_user',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role', { enum: ['admin', 'consultant', 'viewer'] })
      .notNull()
      .default('consultant'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    uniqMembership: uniqueIndex('tenant_user_uniq').on(t.tenantId, t.userId),
  }),
);
