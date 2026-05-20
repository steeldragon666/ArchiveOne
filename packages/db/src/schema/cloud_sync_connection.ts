import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { project } from './project.js';
import { tenant } from './tenant.js';

/**
 * cloud_sync_connection — one row per (project, cloud folder) pair.
 *
 * A connection starts life in `pending_folder_selection` status immediately
 * after the OAuth callback exchanges the authorization code for tokens.
 * The user then selects a Drive folder via the folder-picker UI, which
 * PATCH-es the connection to `active` status and starts the 15-minute
 * polling cycle.
 *
 * Token storage: `refresh_token_encrypted` is currently stored as
 * plaintext. TODO(security): rotate to pgcrypto pgp_sym_encrypt with
 * master key from CLOUD_SYNC_TOKEN_KEY env var before handling production
 * data. See migration comment in 0075_cloud_sync_connection.sql.
 *
 * RLS-protected: tenant_id = current_setting('app.current_tenant_id').
 */
export const cloudSyncConnection = pgTable(
  'cloud_sync_connection',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    provider: text('provider').notNull().default('google_drive'),
    providerAccountEmail: text('provider_account_email').notNull().default(''),
    providerFolderId: text('provider_folder_id').notNull().default(''),
    providerFolderName: text('provider_folder_name').notNull().default(''),
    /** Plaintext for now — see TODO(security) above. */
    refreshTokenEncrypted: text('refresh_token_encrypted').notNull().default(''),
    accessTokenCached: text('access_token_cached'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    /** pending_folder_selection | active | error */
    status: text('status').notNull().default('pending_folder_selection'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /** null | success | error */
    lastSyncStatus: text('last_sync_status'),
    lastSyncError: text('last_sync_error'),
    filesSyncedCount: integer('files_synced_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    projectIdx: index('cloud_sync_connection_project_idx').on(t.tenantId, t.projectId),
    uniqActiveFolder: uniqueIndex('cloud_sync_connection_uniq_active_folder').on(
      t.tenantId,
      t.projectId,
      t.providerFolderId,
    ),
  }),
);

/**
 * cloud_sync_synced_file — de-duplication ledger for the polling job.
 *
 * The polling job inserts a row here for every file it successfully
 * ingests. Subsequent poll runs use `ON CONFLICT DO NOTHING` against
 * the (connection_id, provider_file_id) unique key to skip already-seen
 * files — preventing re-ingestion and double-counting.
 *
 * NOT RLS-protected: accessed only by the privileged polling job. The
 * connection_id FK indirectly scopes each row to a tenant.
 */
export const cloudSyncSyncedFile = pgTable(
  'cloud_sync_synced_file',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => cloudSyncConnection.id, { onDelete: 'cascade' }),
    providerFileId: text('provider_file_id').notNull(),
    sha256Hex: text('sha256_hex').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    /** FK to event.id — the chain event created for this file ingestion. */
    eventId: uuid('event_id'),
  },
  (t) => ({
    connectionIdx: index('cloud_sync_synced_file_connection_idx').on(t.connectionId),
  }),
);
