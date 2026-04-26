import { createHash, randomBytes } from 'node:crypto';

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

const base64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Generate a PKCE verifier + S256 challenge pair per RFC 7636.
 * Verifier: 32 bytes of entropy → 43-char base64url string.
 * Challenge: SHA-256 of verifier → 43-char base64url string.
 *
 * The verifier is held in the OIDC handshake cookie; the challenge
 * goes to the IdP in the authorization request. On callback, the
 * verifier is sent in the token-exchange request — proves possession
 * of the original ask without sharing the secret over the wire.
 */
export function generatePkce(): PkcePair {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

/**
 * Generate a CSRF state token. Held in handshake cookie + sent to IdP;
 * we verify on callback that returned state matches what we issued
 * (per RFC 6749 §10.12 — prevents login-csrf attacks).
 */
export function generateState(): string {
  return base64url(randomBytes(32));
}

/**
 * Generate a one-time nonce included in the OIDC ID token (per OIDC
 * Core §3.1.2.1). Verifying it on callback prevents replay of an old
 * ID token issued in a different login flow.
 */
export function generateNonce(): string {
  return base64url(randomBytes(32));
}
