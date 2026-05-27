/**
 * Magic-link login for existing users — the only public sign-in path
 * while `publicLoginRoutesEnabled = false` keeps OIDC + dev-login gated
 * off (see app.ts).
 *
 * Two endpoints:
 *
 *   POST /v1/auth/login            — request a magic link.
 *     Body: { email: string }
 *     Always returns 200 with a generic message (existence-leak
 *     defense). If the user is registered, we mint a 32-byte
 *     base64url token, store sha256(token) in `auth_magic_link`
 *     (expires_at = now() + 15min), and queue the email via
 *     `@cpa/email` (lazy-imported, mirror of signup verification
 *     pattern). If unknown, we await ~50ms to match the email-send
 *     latency before responding.
 *
 *     503 + log line if RESEND_API_KEY is unset — without it we can't
 *     send anything, and silently 200-ing would let an attacker bring
 *     down login by depriving the env of the key without any signal.
 *
 *     Rate-limited: max 5 requests / hour, enforced INDEPENDENTLY by
 *     (user_id) and by (ip). Both windows are queried against
 *     `auth_magic_link.sent_at` directly — no separate table needed.
 *     A user under the per-user cap but over the per-IP cap (or
 *     vice versa) is rejected with a generic 200 anyway (the response
 *     shape doesn't leak which limit fired).
 *
 *   GET /v1/auth/login/callback?token=<raw>&next=<path>  — consume.
 *     Looks up by sha256(token) via privilegedSql (the session we're
 *     about to mint doesn't exist yet, so we can't set the
 *     `app.current_tenant_id` GUC that cpa_app's RLS policies need —
 *     same rationale dev-login.ts cites for using privilegedSql).
 *     Atomic consumption via `UPDATE … WHERE consumed_at IS NULL
 *     RETURNING …` — replays land on a 0-row result and 401.
 *
 *     On success: looks up user + active tenant + memberships,
 *     mints a session JWT via `signSession()`, sets the cookie
 *     (HttpOnly, SameSite=Lax, Secure-when-prod), 302 redirect
 *     to the `next` param (sanitised) or `/subject-tenants`.
 *
 * Security notes:
 *   - We never store the raw token. token_hash is sha256 hex.
 *   - No constant-time comparison needed: the DB lookup keys on
 *     token_hash, and a non-matching hash returns 0 rows. The hash
 *     itself is a uniform 256-bit value; timing on token_hash !=
 *     token_hash differs by ≤ 1 cycle and reveals nothing.
 *   - `next` is sanitised to same-origin paths (reuses dev-login.ts's
 *     contract: any non-`/`-prefixed or `//`-prefixed value collapses
 *     to `/`).
 *   - Existence-leak defense: a 50ms sleep on unknown-email matches
 *     the email-queue dispatch budget for the registered case. This
 *     is a coarse defense — a network-level adversary can still
 *     distinguish via finer measurements — but it closes the
 *     observable channel in the route's own response body.
 */

import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { privilegedSql } from '@cpa/db/client';
import { signSession, type AvailableTenant } from '@cpa/auth';
import { publicUrl } from '../../lib/public-base-url.js';

export interface MagicLinkLoginConfig {
  sessionSecret: string;
  cookieName: string;
  cookieSecure: boolean;
  ttlSeconds: number;
  /** TTL for the magic-link token itself (NOT the session). Defaults to
   * 15 minutes per the spec. */
  linkTtlSeconds?: number;
  /** Max sends per (user_id) AND per (ip) per hour. Defaults to 5. */
  rateLimitPerHour?: number;
  /** Existence-leak defense — sleep this many ms before responding when
   * the email is unknown. Tuned to match the registered-email send
   * latency. Set to 0 in tests for speed. */
  unknownEmailDelayMs?: number;
}

const loginBody = z.object({
  email: z.string().email(),
});

const GENERIC_OK_MESSAGE = 'If that email is registered, a sign-in link has been sent.';
const REDIRECT_AFTER_LOGIN = '/subject-tenants';
const DEFAULT_LINK_TTL_SECONDS = 15 * 60;
const DEFAULT_RATE_LIMIT_PER_HOUR = 5;
const DEFAULT_UNKNOWN_EMAIL_DELAY_MS = 50;

function sanitizeNext(raw: string | undefined): string {
  if (!raw) return REDIRECT_AFTER_LOGIN;
  if (!raw.startsWith('/')) return REDIRECT_AFTER_LOGIN;
  if (raw.startsWith('//')) return REDIRECT_AFTER_LOGIN;
  return raw;
}

/** Hash a raw token with sha256 → hex. Used both at insert (storage)
 * and at callback (lookup). */
function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  primary_idp: string;
}

interface TenantRow {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  role: string;
  is_default: boolean;
}

interface ConsumeRow {
  id: string;
  user_id: string;
}

/**
 * Send the magic-link email via the @cpa/email transport. Lazy-imports
 * so the test harness (which doesn't set RESEND_API_KEY) never resolves
 * the dependency at boot — mirrors the signup-verification-email
 * pattern in server.ts.
 */
async function sendMagicLinkEmail(args: {
  to: string;
  displayName: string | null;
  magicLinkUrl: string;
  expiresInMinutes: number;
  resendApiKey: string;
}): Promise<void> {
  const { createResendClient, createEmailSender, magicLinkEmail } = await import('@cpa/email');
  const client = createResendClient({ apiKey: args.resendApiKey });
  const sender = createEmailSender(client, {
    fromAddress:
      process.env['LOGIN_FROM_ADDRESS'] ??
      process.env['SIGNUP_FROM_ADDRESS'] ??
      process.env['BETA_FROM_ADDRESS'] ??
      'ArchiveOne <noreply@archiveone.com.au>',
  });
  const { subject, html, text } = magicLinkEmail({
    ...(args.displayName !== null ? { name: args.displayName } : {}),
    magicLinkUrl: args.magicLinkUrl,
    expiresInMinutes: args.expiresInMinutes,
    portalType: 'consultant',
  });
  await sender.send({ to: args.to, subject, html, text });
}

export function registerLoginRoutes(app: FastifyInstance, cfg: MagicLinkLoginConfig): void {
  const linkTtlSeconds = cfg.linkTtlSeconds ?? DEFAULT_LINK_TTL_SECONDS;
  const rateLimitPerHour = cfg.rateLimitPerHour ?? DEFAULT_RATE_LIMIT_PER_HOUR;
  const unknownEmailDelayMs = cfg.unknownEmailDelayMs ?? DEFAULT_UNKNOWN_EMAIL_DELAY_MS;

  // -------------------------------------------------------------------------
  // POST /v1/auth/login — request a magic link
  // -------------------------------------------------------------------------

  app.post('/v1/auth/login', async (req, reply) => {
    const parseResult = loginBody.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(422).send({
        error: 'invalid_body',
        message: 'email is required',
        issues: parseResult.error.issues,
        requestId: req.id,
      });
    }

    // Email transport is required for this route to do useful work. If
    // unset, fail loudly rather than silently 200-ing — an attacker
    // unsetting RESEND_API_KEY would otherwise be invisible.
    const resendApiKey = process.env['RESEND_API_KEY'];
    if (!resendApiKey || resendApiKey.length === 0) {
      req.log.warn('magic-link login disabled, RESEND_API_KEY unset');
      return reply.status(503).send({
        error: 'email_transport_disabled',
        message: 'Magic-link login is not configured on this deployment.',
        requestId: req.id,
      });
    }

    const normalizedEmail = parseResult.data.email.trim().toLowerCase();
    const clientIp = req.ip ?? null;
    const userAgent = req.headers['user-agent'] ?? null;

    // Look up the user. We deliberately DO NOT branch our response on
    // existence — both paths return the same generic 200 message.
    const userRows = await privilegedSql<UserRow[]>`
      SELECT id::text, email, display_name, primary_idp
        FROM "user"
       WHERE email = ${normalizedEmail}
       LIMIT 1
    `;
    const user = userRows[0] ?? null;

    if (user === null) {
      // Existence-leak defense: match the email-send latency budget
      // before responding so the client can't distinguish from the
      // registered-email path by response time alone.
      await sleep(unknownEmailDelayMs);
      return reply.status(200).send({ message: GENERIC_OK_MESSAGE });
    }

    // Rate limit, on both axes (per-user-id AND per-ip). Either being
    // exceeded short-circuits with the SAME generic 200 — we don't
    // surface "rate limited" to the client; the audit trail (logs +
    // auth_magic_link.sent_at rows) is the operator-side signal.
    const userCountRows = await privilegedSql<{ c: string }[]>`
      SELECT count(*)::text AS c
        FROM auth_magic_link
       WHERE user_id = ${user.id}
         AND sent_at > (now() - interval '1 hour')
    `;
    const userCount = Number(userCountRows[0]?.c ?? 0);

    let ipCount = 0;
    if (clientIp) {
      const ipCountRows = await privilegedSql<{ c: string }[]>`
        SELECT count(*)::text AS c
          FROM auth_magic_link
         WHERE ip = ${clientIp}::inet
           AND sent_at > (now() - interval '1 hour')
      `;
      ipCount = Number(ipCountRows[0]?.c ?? 0);
    }

    if (userCount >= rateLimitPerHour || ipCount >= rateLimitPerHour) {
      req.log.warn(
        { email: normalizedEmail, userCount, ipCount, clientIp },
        'magic-link login rate-limited',
      );
      // Same generic 200 so the response body doesn't leak which limit
      // fired (or, for that matter, that any limit fired at all).
      return reply.status(200).send({ message: GENERIC_OK_MESSAGE });
    }

    // Mint the raw token (32 bytes base64url → 43 chars, ~256 bits of
    // entropy). Hash with sha256 for storage so a DB read can't replay
    // outstanding links.
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + linkTtlSeconds * 1000).toISOString();

    await privilegedSql`
      INSERT INTO auth_magic_link (user_id, token_hash, expires_at, ip, user_agent)
      VALUES (
        ${user.id},
        ${tokenHash},
        ${expiresAt},
        ${clientIp},
        ${userAgent}
      )
    `;

    const magicLinkUrl = publicUrl(`/login/callback?token=${encodeURIComponent(rawToken)}`);

    try {
      await sendMagicLinkEmail({
        to: normalizedEmail,
        displayName: user.display_name,
        magicLinkUrl,
        expiresInMinutes: Math.round(linkTtlSeconds / 60),
        resendApiKey,
      });
    } catch (err) {
      // Email failure must not leak existence either. Log loudly so the
      // operator sees the failure, then return the same generic 200.
      // The auth_magic_link row stays — if the user retries within the
      // rate limit, they'll get a new row and we'll try again.
      req.log.error(
        { err: err instanceof Error ? err.message : String(err), email: normalizedEmail },
        'magic-link email send failed',
      );
    }

    return reply.status(200).send({ message: GENERIC_OK_MESSAGE });
  });

  // -------------------------------------------------------------------------
  // GET /v1/auth/login/callback — consume a magic link
  // -------------------------------------------------------------------------

  app.get<{
    Querystring: { token?: string; next?: string };
  }>('/v1/auth/login/callback', async (req, reply) => {
    const { token } = req.query;
    const next = sanitizeNext(req.query.next);

    if (!token || token.length === 0) {
      return reply.status(401).send({
        error: 'invalid_token',
        message: 'Sign-in link is missing or invalid.',
        requestId: req.id,
      });
    }

    const tokenHash = hashToken(token);

    // Atomic consume. The predicate `consumed_at IS NULL AND expires_at
    // > now()` and the UNIQUE constraint on token_hash mean at most one
    // concurrent caller can win the race — the loser sees 0 rows
    // returned and falls through to the generic 401.
    const consumed = await privilegedSql<ConsumeRow[]>`
      UPDATE auth_magic_link
         SET consumed_at = now()
       WHERE token_hash  = ${tokenHash}
         AND consumed_at IS NULL
         AND expires_at  > now()
      RETURNING id::text, user_id::text
    `;
    if (consumed.length === 0) {
      // Indistinguishable response for: token not found, expired, or
      // already consumed. We deliberately don't tell the user which —
      // an attacker probing tokens learns nothing about whether a hash
      // exists.
      return reply.status(401).send({
        error: 'invalid_token',
        message: 'Sign-in link is invalid or has expired.',
        requestId: req.id,
      });
    }
    const consumedRow = consumed[0]!;

    // Look up the user + their memberships. Same shape as dev-login.ts.
    const userRows = await privilegedSql<UserRow[]>`
      SELECT id::text, email, display_name, primary_idp
        FROM "user"
       WHERE id = ${consumedRow.user_id}
       LIMIT 1
    `;
    if (userRows.length === 0) {
      // The user was deleted between request and callback. Treat as
      // invalid token — don't reveal the user-state change.
      req.log.warn(
        { consumedRowId: consumedRow.id, userId: consumedRow.user_id },
        'magic-link callback: user row missing after consume',
      );
      return reply.status(401).send({
        error: 'invalid_token',
        message: 'Sign-in link is invalid or has expired.',
        requestId: req.id,
      });
    }
    const user = userRows[0]!;

    const tenantRows = await privilegedSql<TenantRow[]>`
      SELECT tu.tenant_id::text,
             t.name  AS tenant_name,
             t.slug  AS tenant_slug,
             tu.role,
             tu.is_default
        FROM tenant_user tu
        JOIN tenant t ON t.id = tu.tenant_id
       WHERE tu.user_id    = ${user.id}
         AND tu.deleted_at IS NULL
         AND t.deleted_at  IS NULL
       ORDER BY tu.is_default DESC, t.created_at ASC
    `;
    if (tenantRows.length === 0) {
      // User exists but has no tenant memberships — same condition
      // dev-login.ts also refuses, with the same status. The session
      // would have nothing to bind to.
      return reply.status(403).send({
        error: 'no_tenant_membership',
        message: 'Your account is not yet attached to a workspace. Please complete signup.',
        requestId: req.id,
      });
    }
    const active = tenantRows.find((t) => t.is_default) ?? tenantRows[0]!;

    const availableTenants: AvailableTenant[] = tenantRows.map((t) => ({
      tenantId: t.tenant_id,
      name: t.tenant_name,
      slug: t.tenant_slug,
      role: t.role as 'admin' | 'consultant' | 'viewer',
    }));

    const jwt = await signSession(
      {
        sub: user.id,
        email: user.email,
        primaryIdp: (user.primary_idp as 'microsoft' | 'google' | 'email' | 'auth0') ?? 'email',
        activeTenantId: active.tenant_id,
        activeRole: active.role as 'admin' | 'consultant' | 'viewer',
        availableTenants,
      },
      cfg.sessionSecret,
      { ttlSeconds: cfg.ttlSeconds },
    );

    const cookieAttrs = [
      `${cfg.cookieName}=${jwt}`,
      'Path=/',
      `Max-Age=${cfg.ttlSeconds}`,
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (cfg.cookieSecure) cookieAttrs.push('Secure');
    void reply.header('set-cookie', cookieAttrs.join('; '));

    req.log.info(
      {
        event: 'magic_link_login.success',
        user_id: user.id,
        active_tenant_id: active.tenant_id,
      },
      'magic-link login: session minted',
    );

    return reply.redirect(next, 302);
  });
}
