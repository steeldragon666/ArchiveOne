import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getAppDatabaseUrl, getDatabasePoolMax, getDatabaseUrl } from './env.js';

/**
 * Resolve SSL config for managed-Postgres connections.
 *
 * Supabase's pooler (`*.pooler.supabase.com`) presents a certificate chain
 * that includes an intermediate Node doesn't ship in its default trust
 * store, so `tls.connect()` rejects it as "self-signed certificate in
 * certificate chain". The standard fix for managed Postgres services is
 * to keep TLS encryption but skip CA-chain validation — the connection
 * is still TLS, just trust-on-first-use.
 *
 * Triggered when:
 *   - URL contains `sslmode=require|verify-ca|verify-full|prefer`, OR
 *   - NODE_ENV is `production` (assume all prod connections are over TLS)
 * Otherwise (local docker pg on 5433) returns `false` → plain TCP.
 */
function resolveSsl(url: string): { rejectUnauthorized: false } | false {
  const hasSslMode = /[?&]sslmode=(?!disable)/.test(url);
  if (hasSslMode || process.env['NODE_ENV'] === 'production') {
    return { rejectUnauthorized: false };
  }
  return false;
}

const APP_URL = getAppDatabaseUrl();
const PRIV_URL = getDatabaseUrl();

// Application runtime connects as cpa_app (non-superuser, non-owner)
// so RLS policies actually apply. Migrations are a separate path:
// `pnpm --filter @cpa/db migrate` (src/migrate.ts) connects via
// getDatabaseUrl() which resolves to DATABASE_URL (the cpa role).
//
// NB: caller is responsible for `await sql.end()` in short-lived scripts.
// Long-lived processes (apps/api) leave this open intentionally.
export const sql = postgres(APP_URL, {
  max: getDatabasePoolMax(),
  ssl: resolveSsl(APP_URL),
});
export const db = drizzle(sql);
export type Db = typeof db;

/**
 * Privileged DB client — connects as cpa (the migration role).
 * RLS-bypassing because cpa is the bootstrap superuser AND the table owner;
 * Postgres skips RLS for both, so policies don't apply to this client.
 *
 * Use ONLY for queries that must transcend tenant scope:
 *   - Auth lookups (lookupActiveTenant — needs to see all tenant_user
 *     rows for a user across all tenants to determine the active one)
 *   - System-admin tooling (P3+; not user-facing)
 *
 * NEVER hand this to a route handler that runs after session middleware.
 * The middleware switches us to cpa_app for a reason.
 *
 * Pool capped at 5 — auth flows are infrequent compared to runtime queries.
 */
export const privilegedSql = postgres(PRIV_URL, {
  max: 5,
  ssl: resolveSsl(PRIV_URL),
});
