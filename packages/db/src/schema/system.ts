import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';

/**
 * System table — sanity check for the migration runner.
 *
 * Establishes the audit-column convention used by every domain table
 * in this platform: `created_at`, `updated_at` (NOT NULL, default now()),
 * and a nullable `deleted_at` for soft-delete. Tables that don't need
 * soft-delete still carry the column for uniform shape.
 *
 * UUID v4 is generated app-side via crypto.randomUUID(), matching the
 * @cpa/schemas Uuid contract (regex /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-...$/).
 */
export const system = pgTable('system', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  key: text('key').notNull(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
