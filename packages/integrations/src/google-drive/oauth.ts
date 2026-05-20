/**
 * Google Drive OAuth 2.0 helpers (PKCE flow).
 *
 * Mirrors the shape of `xero-accounting/oauth.ts`:
 *   - `buildAuthUrl` — constructs the Google authorization URL with PKCE.
 *   - `exchangeCode` — exchanges an authorization code for tokens.
 *   - `refreshAccessToken` — refreshes an expired access token.
 *   - `revokeToken` — best-effort token revocation on disconnect.
 *
 * SECURITY — plaintext-token boundary: `exchangeCode` and
 * `refreshAccessToken` return PLAINTEXT tokens. Callers MUST handle
 * encryption before persisting. Currently the route stores plaintext
 * with a TODO(security) comment — see migration 0075 and route handler.
 *
 * PKCE primitives live in `runtime/oauth.ts`. The route layer generates
 * the verifier with `generatePkceVerifier()`, derives the challenge with
 * `pkceChallengeFromVerifier()`, stores them in the handshake cookie, and
 * feeds the verifier back here on the callback.
 */

import type { GoogleDriveOAuthConfig, GoogleTokenResponse } from './types.js';
import {
  GOOGLE_DRIVE_OAUTH_AUTHORIZE_URL,
  GOOGLE_DRIVE_OAUTH_TOKEN_URL,
  GOOGLE_DRIVE_OAUTH_REVOKE_URL,
  GOOGLE_DRIVE_SCOPES,
} from './types.js';

/** Subtracted from token expiry for clock-skew tolerance (60 seconds). */
const SKEW_BUFFER_MS = 60_000;

export interface DriveOAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: Date;
  scopes?: string[];
}

/**
 * Build the Google OAuth 2.0 authorization URL with PKCE.
 */
export function buildDriveAuthUrl(
  opts: GoogleDriveOAuthConfig & {
    state: string;
    pkce_challenge: string;
    /** Optionally request a refresh token via access_type=offline. Defaults true. */
    offline?: boolean;
  },
): string {
  const u = new URL(GOOGLE_DRIVE_OAUTH_AUTHORIZE_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', opts.client_id);
  u.searchParams.set('redirect_uri', opts.redirect_uri);
  u.searchParams.set('scope', GOOGLE_DRIVE_SCOPES.join(' '));
  u.searchParams.set('state', opts.state);
  u.searchParams.set('code_challenge', opts.pkce_challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  // access_type=offline is required to receive a refresh_token on the
  // first consent. prompt=consent forces the consent screen even if the
  // user has already granted — necessary to get a fresh refresh_token on
  // re-auth (Google only issues one on the initial grant otherwise).
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  return u.toString();
}

/**
 * Exchange an authorization code (PKCE flow) for OAuth tokens.
 *
 * Returns PLAINTEXT tokens — caller must encrypt before persisting.
 */
export async function exchangeDriveCode(
  opts: GoogleDriveOAuthConfig & { code: string; pkce_verifier: string },
): Promise<DriveOAuthTokens> {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', opts.client_id);
  body.set('client_secret', opts.client_secret);
  body.set('code', opts.code);
  body.set('redirect_uri', opts.redirect_uri);
  body.set('code_verifier', opts.pkce_verifier);

  const res = await fetch(GOOGLE_DRIVE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = (await res.json()) as GoogleTokenResponse;
  if (!res.ok || data.error) {
    throw new Error(
      `google drive oauth exchange: ${res.status} ${data.error ?? ''} ${data.error_description ?? ''}`.trim(),
    );
  }

  const tokens: DriveOAuthTokens = {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000 - SKEW_BUFFER_MS),
  };
  if (data.refresh_token !== undefined) tokens.refresh_token = data.refresh_token;
  if (data.scope !== undefined) tokens.scopes = data.scope.split(' ');
  return tokens;
}

/**
 * Refresh an expired Google access token using the refresh_token grant.
 *
 * Google does NOT always rotate refresh tokens (unlike Xero). The caller
 * should update the access_token + expires_at columns but keep the
 * existing refresh_token unless a new one is returned.
 *
 * Returns PLAINTEXT tokens — caller must encrypt before persisting.
 */
export async function refreshDriveAccessToken(
  opts: GoogleDriveOAuthConfig & { refresh_token: string },
): Promise<DriveOAuthTokens> {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', opts.client_id);
  body.set('client_secret', opts.client_secret);
  body.set('refresh_token', opts.refresh_token);

  const res = await fetch(GOOGLE_DRIVE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = (await res.json()) as GoogleTokenResponse;
  if (!res.ok || data.error) {
    throw new Error(
      `google drive oauth refresh: ${res.status} ${data.error ?? ''} ${data.error_description ?? ''}`.trim(),
    );
  }

  const tokens: DriveOAuthTokens = {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000 - SKEW_BUFFER_MS),
  };
  // Google may or may not rotate the refresh token — only update if returned.
  if (data.refresh_token !== undefined) tokens.refresh_token = data.refresh_token;
  if (data.scope !== undefined) tokens.scopes = data.scope.split(' ');
  return tokens;
}

/**
 * Revoke a Google OAuth token (best-effort; ignore failure).
 *
 * Called during disconnect. Google accepts either the access_token or the
 * refresh_token — we use the refresh_token so the revocation is durable
 * (revoking an access_token only invalidates that short-lived token).
 */
export async function revokeDriveToken(token: string): Promise<void> {
  const u = new URL(GOOGLE_DRIVE_OAUTH_REVOKE_URL);
  u.searchParams.set('token', token);
  // Best-effort — caller ignores the result.
  await fetch(u.toString(), { method: 'POST' }).catch(() => undefined);
}
