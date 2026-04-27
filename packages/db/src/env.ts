// Port 5433 (not 5432) to coexist with any native Postgres install on the host.
const DEV_DATABASE_URL = 'postgres://cpa:cpa@localhost:5433/cpa_dev';

/**
 * Resolve the Postgres connection URL.
 *
 * In production (NODE_ENV=production) DATABASE_URL is required — we
 * throw rather than fall back, because a silent fallback to a dev URL
 * would be a silent connect-to-the-wrong-thing bug.
 *
 * In dev/test, fall back to the canonical local docker compose URL.
 */
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production');
  }
  return DEV_DATABASE_URL;
}

/**
 * Resolve the application-runtime Postgres connection URL.
 *
 * Migrations run as the privileged `cpa` role (superuser, table owner —
 * bypasses RLS by both paths). Application runtime connects as the
 * non-superuser `cpa_app` role so RLS policies actually apply to it.
 * The `cpa_app` role is created by migration 0002.
 *
 * Resolution order:
 *   1. DATABASE_URL_APP    — the cpa_app connection string (preferred)
 *   2. DATABASE_URL        — legacy fallback (cpa). Lets pre-migration
 *                            P0 paths still work; safe because before
 *                            0002 ran there's no RLS to bypass.
 *
 * In production we require an explicit value rather than silently
 * falling back to a dev URL.
 */
export function getAppDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL_APP (or DATABASE_URL) is required in production');
  }
  return DEV_DATABASE_URL;
}

/**
 * Postgres connection pool size. Defaults to 10. Override with
 * DATABASE_POOL_MAX for higher-concurrency deployments.
 */
export function getDatabasePoolMax(): number {
  const v = Number(process.env.DATABASE_POOL_MAX ?? '10');
  return Number.isFinite(v) && v > 0 ? v : 10;
}
