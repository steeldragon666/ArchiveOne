import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './user.js';

/**
 * Magic-link login tokens for existing users.
 *
 * Mirrors migration 0091 verbatim. Backs the
 * `POST /v1/auth/login` + `GET /v1/auth/login/callback` pair, which is
 * the **only** public sign-in path while `publicLoginRoutesEnabled =
 * false` in app.ts (OIDC / Auth0 / dev-login are all gated off).
 *
 * Lifecycle:
 *   1. POST /v1/auth/login generates a 32-byte base64url token and
 *      INSERTs a row with `token_hash = sha256(token)`,
 *      `expires_at = now() + 15min`.
 *   2. User receives `${PUBLIC_BASE_URL}/login/callback?token=<raw>`.
 *   3. GET /v1/auth/login/callback hashes the inbound token, looks up
 *      this row, atomically sets `consumed_at` via
 *      `UPDATE … WHERE consumed_at IS NULL RETURNING …` (race-safe).
 *
 * Storage notes:
 *   - `token_hash` is the sha256 hex of the raw token. We never store
 *     the raw token, so an op who reads the DB can't replay links.
 *   - `ip` uses PostgreSQL `inet` (stored as text on the Drizzle side —
 *     postgres-js encodes JS strings directly into inet, mirror of
 *     `engagement_letter.signed_by_claimant_ip`).
 *   - No `tenant_id`: a magic-link request is pre-session, so there's
 *     no active tenant. The user → tenant lookup happens at consumption
 *     time via `lookupActiveTenant(user.id)`.
 *
 * **No RLS**. Auth infra (sibling of `user` / `tenant_user`), accessed
 * only by token-gated public routes via `privilegedSql`. The session
 * this row is about to MINT doesn't exist yet, so the
 * `app.current_tenant_id` GUC can't be set. Same rationale as
 * `dev-login.ts` uses `privilegedSql`. cpa_app has no grants on this
 * table — migration 0091 REVOKE ALLs.
 *
 * Naming convention: camelCase TS / snake_case SQL (per existing
 * tenant / claim / signup_decision precedent).
 */

export const authMagicLink = pgTable(
  'auth_magic_link',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** sha256(raw_token) hex. UNIQUE at the SQL layer. */
    tokenHash: text('token_hash').notNull().unique(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Non-null once the link has been redeemed. Set atomically in
     * the callback's UPDATE to make replays a no-op. */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /** Stored as text on the Drizzle side — postgres-js encodes JS
     * strings directly into the inet column. Validate format at the
     * API layer if needed. */
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => ({
    userIdx: index('auth_magic_link_user_idx').on(t.userId, t.sentAt),
    ipIdx: index('auth_magic_link_ip_idx').on(t.ip, t.sentAt),
  }),
);
