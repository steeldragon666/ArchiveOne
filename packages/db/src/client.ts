import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getAppDatabaseUrl, getDatabasePoolMax } from './env.js';

// Application runtime connects as cpa_app (non-superuser, non-owner)
// so RLS policies actually apply. Migrations are a separate path:
// `pnpm --filter @cpa/db migrate` (src/migrate.ts) connects via
// getDatabaseUrl() which resolves to DATABASE_URL (the cpa role).
//
// NB: caller is responsible for `await sql.end()` in short-lived scripts.
// Long-lived processes (apps/api) leave this open intentionally.
export const sql = postgres(getAppDatabaseUrl(), { max: getDatabasePoolMax() });
export const db = drizzle(sql);
export type Db = typeof db;
