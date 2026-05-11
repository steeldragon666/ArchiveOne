/**
 * Google Drive integration types.
 *
 * Purposefully narrow — only the fields the cloud-sync connector needs.
 * The full Drive API surface is much larger; we fetch only what we use to
 * keep the wire-type surface minimal and easy to type-check without a
 * generated SDK.
 */

export const GOOGLE_DRIVE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_DRIVE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_DRIVE_OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

/** OAuth scopes required by the connector. */
export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

/** Config passed through from environment variables. */
export interface GoogleDriveOAuthConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

/** Token response from Google's token endpoint. */
export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Drive files.list item (fields we request). */
export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

/** Drive files.list response shape. */
export interface DriveFilesListResponse {
  files: DriveFileItem[];
  nextPageToken?: string;
}

/** Drive about response (for account email). */
export interface DriveAboutResponse {
  user: {
    emailAddress: string;
    displayName?: string;
  };
}

/** Drive folder item returned by the folder-picker API. */
export interface DriveFolderItem {
  id: string;
  name: string;
  parents?: string[];
}

/** Drive files.list response for folder listing. */
export interface DriveFolderListResponse {
  files: DriveFolderItem[];
  nextPageToken?: string;
}
