#!/usr/bin/env tsx
/**
 * Mint a session JWT for the dev-seed user, bypassing OIDC.
 *
 * The seed at `dev-seed-aaron-001` (user_id ...001, tenant_id ...010) is
 * inserted by the manual SQL block in this session. Anyone running this
 * after the seed lands gets a printable cookie value to paste into the
 * browser, granting an "as-if-Google-logged-in" dev session for ~1 hour.
 *
 * Run with:
 *   pnpm exec tsx --env-file=../../.env tools/scripts/mint-dev-cookie.ts
 *
 * Why standalone: the OIDC flow is broken locally because no Google client
 * is configured. This script produces an equivalent session JWT directly,
 * so we can smoke-test the consultant dashboard without unblocking auth.
 */
import { signSession } from '@cpa/auth';

// MUST read SESSION_JWT_SECRET — same env var apps/api/src/app.ts:174 reads.
// If you set SESSION_SECRET instead, the API falls back to its hardcoded dev
// default and no minted JWT will verify (silent signature mismatch -> 401).
const SESSION_SECRET = process.env['SESSION_JWT_SECRET'];
const SESSION_COOKIE_NAME = process.env['SESSION_COOKIE_NAME'] ?? 'cpa_session';
const SESSION_TTL_SECONDS = Number(process.env['SESSION_TTL_SECONDS'] ?? 3600);

if (!SESSION_SECRET) {
  console.error('SESSION_JWT_SECRET must be set in .env');
  process.exit(1);
}

const userId = '00000000-0000-0000-0000-000000000001';
const tenantId = '00000000-0000-0000-0000-000000000010';

const jwt = await signSession(
  {
    sub: userId,
    email: 'aaron@carbonproject.com.au',
    primaryIdp: 'google',
    activeTenantId: tenantId,
    activeRole: 'admin',
    availableTenants: [
      {
        tenantId,
        name: 'Claimsure Demo',
        slug: 'claimsure-demo',
        role: 'admin',
      },
    ],
  },
  SESSION_SECRET,
  { ttlSeconds: SESSION_TTL_SECONDS },
);

const expiresInMin = Math.round(SESSION_TTL_SECONDS / 60);
process.stdout.write(
  [
    '',
    '=== Dev session cookie minted ===',
    '',
    `Cookie name : ${SESSION_COOKIE_NAME}`,
    `User        : aaron@carbonproject.com.au (${userId})`,
    `Tenant      : Claimsure Demo (${tenantId}, role=admin)`,
    `Expires     : in ~${expiresInMin} min`,
    '',
    '--- Paste in browser DevTools console at http://localhost:5173/ ---',
    '',
    `document.cookie = "${SESSION_COOKIE_NAME}=${jwt}; Path=/; Max-Age=${SESSION_TTL_SECONDS}";`,
    '',
    '--- Then refresh the page or navigate to / ---',
    '',
    'Raw JWT (if you need to inspect it on jwt.io):',
    jwt,
    '',
  ].join('\n'),
);
