import { z } from 'zod';
import { Iso8601, Uuid } from './primitives.js';

// ---------------------------------------------------------------------------
// Connection wire shape
// ---------------------------------------------------------------------------

/**
 * Wire shape returned by GET /v1/projects/:id/cloud-sync.
 *
 * Token fields are deliberately omitted — refresh/access tokens never leave
 * the API boundary. `status` drives the UI state machine:
 *   - pending_folder_selection: OAuth done, folder not yet chosen
 *   - active: folder selected, polling runs every 15 min
 *   - error: last poll encountered an unrecoverable error
 */
export const CloudSyncConnection = z.object({
  id: Uuid,
  tenant_id: Uuid,
  project_id: Uuid,
  provider: z.literal('google_drive'),
  provider_account_email: z.string(),
  provider_folder_id: z.string(),
  provider_folder_name: z.string(),
  status: z.enum(['pending_folder_selection', 'active', 'error']),
  last_synced_at: Iso8601.nullable(),
  last_sync_status: z.enum(['success', 'error']).nullable(),
  last_sync_error: z.string().nullable(),
  files_synced_count: z.number().int().nonnegative(),
  created_at: Iso8601,
  updated_at: Iso8601,
  deleted_at: Iso8601.nullable(),
});
export type CloudSyncConnection = z.infer<typeof CloudSyncConnection>;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/**
 * POST /v1/projects/:id/cloud-sync/google-drive/initiate
 * Empty body — the project_id is in the path param.
 */
export const InitiateDriveConnectionBody = z.object({}).strict();
export type InitiateDriveConnectionBody = z.infer<typeof InitiateDriveConnectionBody>;

/**
 * PATCH /v1/projects/:id/cloud-sync/:connection_id/folder
 * The frontend sends the user-selected folder after the OAuth callback.
 */
export const SetFolderBody = z
  .object({
    provider_folder_id: z.string().min(1).max(512),
    provider_folder_name: z.string().min(1).max(500),
  })
  .strict();
export type SetFolderBody = z.infer<typeof SetFolderBody>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** GET /v1/projects/:id/cloud-sync */
export const ListConnectionsResponse = z.object({
  connections: z.array(CloudSyncConnection),
});
export type ListConnectionsResponse = z.infer<typeof ListConnectionsResponse>;

/** POST initiate */
export const InitiateConnectionResponse = z.object({
  authorization_url: z.string().url(),
  connection_id: Uuid,
});
export type InitiateConnectionResponse = z.infer<typeof InitiateConnectionResponse>;

/** GET /v1/cloud-sync/:connection_id/folders?parent_id= */
export const DriveFolder = z.object({
  id: z.string(),
  name: z.string(),
  parent_id: z.string().nullable(),
});
export type DriveFolder = z.infer<typeof DriveFolder>;

export const ListFoldersResponse = z.object({
  folders: z.array(DriveFolder),
});
export type ListFoldersResponse = z.infer<typeof ListFoldersResponse>;

// ---------------------------------------------------------------------------
// Chain event payload schemas
// ---------------------------------------------------------------------------

/**
 * CLOUD_SYNC_CONNECTED — emitted by PATCH .../folder when the folder is
 * successfully set and the connection transitions to `active`.
 */
export const CloudSyncConnectedPayload = z.object({
  connection_id: Uuid,
  project_id: Uuid,
  provider: z.literal('google_drive'),
  provider_account_email: z.string(),
  provider_folder_id: z.string(),
  provider_folder_name: z.string(),
});
export type CloudSyncConnectedPayload = z.infer<typeof CloudSyncConnectedPayload>;

/**
 * CLOUD_SYNC_DISCONNECTED — emitted by DELETE .../cloud-sync/:connection_id.
 */
export const CloudSyncDisconnectedPayload = z.object({
  connection_id: Uuid,
  project_id: Uuid,
  provider: z.literal('google_drive'),
  provider_account_email: z.string(),
  disconnected_by_user_id: Uuid,
});
export type CloudSyncDisconnectedPayload = z.infer<typeof CloudSyncDisconnectedPayload>;

/**
 * EVIDENCE_UPLOADED — emitted per file ingested by the polling job.
 * Mirrors the shape produced by `upload-evidence-button.tsx` for direct
 * uploads so downstream assurance views treat all evidence uniformly.
 */
export const EvidenceUploadedPayload = z.object({
  source: z.literal('google_drive'),
  connection_id: Uuid,
  filename: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex chars'),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  drive_file_id: z.string(),
  drive_modified_time: z.string(),
});
export type EvidenceUploadedPayload = z.infer<typeof EvidenceUploadedPayload>;
