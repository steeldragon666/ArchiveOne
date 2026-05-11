/**
 * Google Drive cloud-sync integration.
 *
 * Subpath export `@cpa/integrations/google-drive` — mirrors the pattern
 * used by xero-accounting, regulatory, and other integrations.
 *
 * The OAuth primitives (buildDriveAuthUrl, exchangeDriveCode, etc.) are
 * consumed by the cloud-sync route. The Drive API client
 * (getDriveAccountEmail, listDriveFolders, listDriveFiles, downloadDriveFile)
 * is consumed by both the cloud-sync route (folder picker) and the
 * google-drive-poll job (file ingestion).
 */
export * from './types.js';
export * from './oauth.js';
export * from './client.js';
