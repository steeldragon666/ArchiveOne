/**
 * Google Drive API client.
 *
 * Uses Node's built-in `fetch` (no external dependencies). All calls go
 * through `driveGet` / `driveGetMedia` which attach the Bearer token and
 * handle 401 (token-expired) by refreshing and retrying once.
 *
 * The `DriveClientOptions` type mirrors the connection row columns that
 * carry the token state — callers pass this bag in and receive an updated
 * bag back when a token refresh occurred so they can persist the new
 * access_token + expires_at.
 */

import crypto from 'node:crypto';
import type { GoogleDriveOAuthConfig } from './types.js';
import { GOOGLE_DRIVE_API_BASE } from './types.js';
import type {
  DriveAboutResponse,
  DriveFolderListResponse,
  DriveFilesListResponse,
} from './types.js';
import { refreshDriveAccessToken } from './oauth.js';

export interface DriveClientOptions {
  /** Plaintext access token (possibly expired). */
  access_token: string;
  access_token_expires_at: Date;
  /** Plaintext refresh token (current — see TODO(security) in route). */
  refresh_token: string;
  oauth_config: GoogleDriveOAuthConfig;
}

export interface DriveTokenUpdate {
  access_token: string;
  access_token_expires_at: Date;
  /** Only present when Google issued a new refresh token during the refresh. */
  refresh_token?: string;
}

/**
 * Container returned by every Drive client method that may have refreshed
 * the access token. The caller is responsible for persisting `token_update`
 * when it is present.
 *
 * `token_update` is typed as `DriveTokenUpdate | undefined` (not optional
 * `DriveTokenUpdate?`) because `exactOptionalPropertyTypes` forbids assigning
 * `undefined` to an optional property. Use a `token_update: undefined`
 * spread or the `setTokenUpdate` helper when not refreshing.
 */
export interface DriveResult<T> {
  data: T;
  /** Set when the access token was refreshed during this call; undefined otherwise. */
  token_update: DriveTokenUpdate | undefined;
}

/**
 * Internal helper — makes a Drive API GET request, refreshing if 401.
 */
async function driveGet<T>(url: string, opts: DriveClientOptions): Promise<DriveResult<T>> {
  let tokenUpdate: DriveTokenUpdate | undefined;
  let accessToken = opts.access_token;

  // Pre-emptively refresh if the token is expired (or within 60s of expiry).
  if (opts.access_token_expires_at.getTime() <= Date.now()) {
    const refreshed = await refreshDriveAccessToken({
      ...opts.oauth_config,
      refresh_token: opts.refresh_token,
    });
    accessToken = refreshed.access_token;
    tokenUpdate = {
      access_token: refreshed.access_token,
      access_token_expires_at: refreshed.expires_at,
    };
    if (refreshed.refresh_token !== undefined) {
      tokenUpdate.refresh_token = refreshed.refresh_token;
    }
  }

  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // On 401, try one refresh + retry (handles races where token expired
  // between our pre-check and the actual request).
  if (res.status === 401 && !tokenUpdate) {
    const refreshed = await refreshDriveAccessToken({
      ...opts.oauth_config,
      refresh_token: opts.refresh_token,
    });
    accessToken = refreshed.access_token;
    tokenUpdate = {
      access_token: refreshed.access_token,
      access_token_expires_at: refreshed.expires_at,
    };
    if (refreshed.refresh_token !== undefined) {
      tokenUpdate.refresh_token = refreshed.refresh_token;
    }
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`google drive api: ${res.status} ${url} — ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as T;
  return { data, token_update: tokenUpdate };
}

/**
 * Fetch the authenticated user's email address via Drive's "about" endpoint.
 * Used immediately after token exchange to record which Google account authorised.
 */
export async function getDriveAccountEmail(opts: DriveClientOptions): Promise<DriveResult<string>> {
  const url = `${GOOGLE_DRIVE_API_BASE}/about?fields=user(emailAddress)`;
  const result = await driveGet<DriveAboutResponse>(url, opts);
  return { data: result.data.user.emailAddress, token_update: result.token_update };
}

/**
 * List Drive folders (mimeType = application/vnd.google-apps.folder) under
 * a given parent. When `parent_id` is 'root' or undefined, lists top-level
 * folders.
 *
 * Limited to 100 items per call — the folder-picker UI lazy-loads more
 * via `parent_id` navigation rather than showing a flat list of all folders.
 */
export async function listDriveFolders(
  opts: DriveClientOptions,
  parent_id?: string,
): Promise<DriveResult<DriveFolderListResponse>> {
  const parentClause =
    parent_id && parent_id !== 'root' ? `'${parent_id}' in parents` : `'root' in parents`;
  const q = encodeURIComponent(
    `${parentClause} and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${q}&fields=files(id,name,parents)&pageSize=100`;
  return driveGet<DriveFolderListResponse>(url, opts);
}

/**
 * List files (non-folders) directly in a Drive folder. Excludes trashed.
 * Returns up to 1000 files per page — the polling job pages through using
 * `nextPageToken` when the folder is large.
 */
export async function listDriveFiles(
  opts: DriveClientOptions,
  folder_id: string,
  page_token?: string,
): Promise<DriveResult<DriveFilesListResponse>> {
  const q = encodeURIComponent(
    `'${folder_id}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,size),nextPageToken');
  let url = `${GOOGLE_DRIVE_API_BASE}/files?q=${q}&fields=${fields}&pageSize=1000`;
  if (page_token) url += `&pageToken=${encodeURIComponent(page_token)}`;
  return driveGet<DriveFilesListResponse>(url, opts);
}

/**
 * Download a Drive file's binary content and compute its SHA-256 hash.
 *
 * Uses `crypto.subtle.digest` (Web Crypto API — available in Node 22+).
 * Google Docs / Sheets / Slides (application/vnd.google-apps.*) cannot be
 * downloaded via alt=media and are skipped by the caller before reaching
 * this function.
 *
 * Returns `{ bytes, sha256_hex, token_update? }`.
 */
export async function downloadDriveFile(
  opts: DriveClientOptions,
  file_id: string,
): Promise<{ bytes: Uint8Array; sha256_hex: string; token_update: DriveTokenUpdate | undefined }> {
  let tokenUpdate: DriveTokenUpdate | undefined;
  let accessToken = opts.access_token;

  // Pre-emptive refresh
  if (opts.access_token_expires_at.getTime() <= Date.now()) {
    const refreshed = await refreshDriveAccessToken({
      ...opts.oauth_config,
      refresh_token: opts.refresh_token,
    });
    accessToken = refreshed.access_token;
    tokenUpdate = {
      access_token: refreshed.access_token,
      access_token_expires_at: refreshed.expires_at,
    };
    if (refreshed.refresh_token !== undefined) {
      tokenUpdate.refresh_token = refreshed.refresh_token;
    }
  }

  const url = `${GOOGLE_DRIVE_API_BASE}/files/${file_id}?alt=media`;
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401 && !tokenUpdate) {
    const refreshed = await refreshDriveAccessToken({
      ...opts.oauth_config,
      refresh_token: opts.refresh_token,
    });
    accessToken = refreshed.access_token;
    tokenUpdate = {
      access_token: refreshed.access_token,
      access_token_expires_at: refreshed.expires_at,
    };
    if (refreshed.refresh_token !== undefined) {
      tokenUpdate.refresh_token = refreshed.refresh_token;
    }
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `google drive download: ${res.status} file_id=${file_id} — ${errText.slice(0, 200)}`,
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // SHA-256 via Node's built-in Web Crypto (Node 22+)
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
  const sha256_hex = Buffer.from(hashBuf).toString('hex');

  return { bytes, sha256_hex, token_update: tokenUpdate };
}
