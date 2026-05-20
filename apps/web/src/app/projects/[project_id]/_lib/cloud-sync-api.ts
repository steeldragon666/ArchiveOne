/**
 * Typed fetchers for the cloud-sync connector endpoints.
 *
 * All functions use `apiFetch` from `@/lib/api` so the cpa_session cookie
 * is forwarded automatically and non-2xx responses throw typed errors.
 */

import { apiFetch } from '@/lib/api';
import type {
  CloudSyncConnection,
  InitiateConnectionResponse,
  ListConnectionsResponse,
  ListFoldersResponse,
  SetFolderBody,
} from '@cpa/schemas';

// ---------------------------------------------------------------------------
// Connection list
// ---------------------------------------------------------------------------

export async function listCloudSyncConnections(projectId: string): Promise<CloudSyncConnection[]> {
  const res = await apiFetch<ListConnectionsResponse>(`/v1/projects/${projectId}/cloud-sync`);
  return res.connections;
}

// ---------------------------------------------------------------------------
// Initiate OAuth flow
// ---------------------------------------------------------------------------

/**
 * POST /v1/projects/:id/cloud-sync/google-drive/initiate
 *
 * Returns the Google authorization URL. The caller should set
 * `window.location.href = authorization_url` to start the OAuth flow.
 */
export async function initiateGoogleDriveConnection(
  projectId: string,
): Promise<InitiateConnectionResponse> {
  return apiFetch<InitiateConnectionResponse>(
    `/v1/projects/${projectId}/cloud-sync/google-drive/initiate`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

// ---------------------------------------------------------------------------
// Folder picker
// ---------------------------------------------------------------------------

export interface FolderItem {
  id: string;
  name: string;
  parent_id: string | null;
}

export async function listDriveFolders(
  connectionId: string,
  parentId?: string,
): Promise<FolderItem[]> {
  const url = parentId
    ? `/v1/cloud-sync/${connectionId}/folders?parent_id=${encodeURIComponent(parentId)}`
    : `/v1/cloud-sync/${connectionId}/folders`;
  const res = await apiFetch<ListFoldersResponse>(url);
  return res.folders;
}

// ---------------------------------------------------------------------------
// Set folder
// ---------------------------------------------------------------------------

export async function setConnectionFolder(
  projectId: string,
  connectionId: string,
  body: SetFolderBody,
): Promise<CloudSyncConnection> {
  const res = await apiFetch<{ connection: CloudSyncConnection }>(
    `/v1/projects/${projectId}/cloud-sync/${connectionId}/folder`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return res.connection;
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

export async function disconnectCloudSync(projectId: string, connectionId: string): Promise<void> {
  await apiFetch<void>(`/v1/projects/${projectId}/cloud-sync/${connectionId}`, {
    method: 'DELETE',
  });
}
