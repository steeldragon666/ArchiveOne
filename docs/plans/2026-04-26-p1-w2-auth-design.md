# P1 W2 — Auth Layer Design (OIDC + JWT + Fastify Session Middleware)

**Status:** Approved 2026-04-26
**Builds on:** [ADR-0002](../decisions/0002-identity-and-tenancy.md), [P1 W1 plan](./2026-04-26-p1-w1-foundation-and-schemas.md)
**Authors:** Aaron Newson + AI pair (Claude Opus 4.7)

## Goal

Land the runtime authentication path that turns "user has Microsoft or Google credentials" into "user has a verified session with an active tenant context, RLS-scoped per request." W1 made the *shape* of identity. W2 makes the *flow* of identity.

## Decisions (locked from brainstorm)

### Q1 — OIDC client library: `openid-client` + `jose` (B)

ADR-0002 originally specified Auth.js. We now amend that for W2: Auth.js (`@auth/core`) is awkward outside Next.js, where its sweet spot lives. Since W2 is Fastify-only and the Next.js consultant portal doesn't land until W4, we use the lower-level `openid-client` for the OIDC dance and `jose` for our JWT signing/verification.

**Auth.js compatibility preserved.** The JWT format we issue from W2 will use claims compatible with what Auth.js expects to consume (per its JWT callback spec): `sub`, `email`, `iat`, `exp`, plus our custom `tenantId`, `userId`, `role`, `availableTenants`. When W4's Next.js portal lands, Auth.js can be the FRONTEND auth helper there while the BACKEND continues to issue and verify JWTs via this layer.

ADR-0002 §"Identity provider strategy (Q1)" updated as part of W2 implementation to document this clarification.

### Q2 — Session cookie: httpOnly + secure + sameSite=lax (A)

Standard OIDC web-app pattern. `lax` is required because the `Set-Cookie` from our `/callback` handler must be respected when the browser navigates to `/` immediately after; `strict` would block the cookie on cross-site nav back from Microsoft/Google. CSRF protection comes from the JWT being a credential-binding rather than an opaque session id (rotating it on every login).

**Cookie attributes:**
- `httpOnly` — JS can't read it; XSS can't exfiltrate
- `secure` — only over HTTPS in production (omitted in dev for localhost)
- `sameSite=lax` — sent on top-level GET navigations + same-site requests
- `path=/`
- `__Host-` prefix in production (forces same-origin, secure, no Domain attribute)
- 24-hour expiry (matches token lifetime)

### Q3 — Token lifetime: 24h JWT, no refresh, re-auth on expiry (B)

Single token, no refresh-token plumbing. Consultants log in daily as part of starting work; the daily click on "Continue with Microsoft" is a 1-step SSO experience. A stolen JWT lives at most 24 hours.

**Refresh tokens deferred to P3+** when usage patterns reveal whether the daily-login UX hurts retention. The schema already has `delegation_token` for federation use cases; refresh would be a separate `session_token` table or move JWTs into a stateful session row.

### Q4 — Active tenant on login: `is_default` if present, else first row (B)

Lookup query:
```sql
SELECT tu.tenant_id, tu.role
FROM tenant_user tu
WHERE tu.user_id = ? AND tu.deleted_at IS NULL
ORDER BY tu.is_default DESC, tu.created_at ASC
LIMIT 1
```

If the user has no tenant_user rows, the login completes BUT `activeTenantId` is null, and `/v1/whoami` returns `{ user, activeTenant: null, availableTenants: [] }`. The portal handles this case by routing the user to an "awaiting firm assignment" state. This avoids the brittle "reject login if no default" rule.

`/v1/tenants/switch` (W3) re-issues the JWT with a different `activeTenantId` claim from the user's `tenant_user` rows.

### Q5 — Tests: fixture-mock IdP `/token` + `/userinfo` (A)

Use `nock` (or equivalent) to intercept HTTP calls to `https://login.microsoftonline.com/...` and `https://oauth2.googleapis.com/...` inside the test process. Fixture responses pin to actual JWT shapes documented by Microsoft Entra and Google (claims: `sub`, `email`, `oid`/`hd`, `name`, etc.).

This gives us full callback-handler coverage (parse code → exchange → verify ID token → find-or-create user → look up tenant → sign our JWT → set cookie) without external dependencies. CI stays pure-Node.

## Architecture

### Request flow — login

```
1. Browser  GET /v1/auth/microsoft/login
2. Fastify  generates state, nonce, PKCE verifier+challenge
            stores {state, nonce, pkce_verifier} in a 5-min sameSite=lax cookie
            (separate from session cookie; carries the OIDC handshake)
            302 to https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?
              client_id=...&response_type=code&redirect_uri=...&
              code_challenge=...&code_challenge_method=S256&state=...&nonce=...
3. User authenticates at Microsoft
4. Microsoft  302 to https://api.cpa-platform/v1/auth/microsoft/callback?code=...&state=...
5. Fastify  reads handshake cookie, validates state matches
            exchanges code+pkce_verifier at https://login.microsoftonline.com/.../token
            verifies returned ID token (issuer, audience, nonce, signature via JWKS)
            extracts external_id from `oid` claim, email from `email` claim, name from `name`
            findOrCreateUser({primary_idp: 'microsoft', external_id, email, displayName})
            lookupActiveTenant(user_id) -> {tenantId, role} | null
            signs OUR JWT: {sub: user_id, email, tenantId, role, availableTenants[]}
            sets cookie `cpa_session` with httpOnly+secure+sameSite=lax+24h
            clears handshake cookie
            302 to /
```

### Request flow — authenticated request

```
1. Browser  GET /v1/whoami (cookie cpa_session=jwt)
2. Fastify  preHandler: read cpa_session cookie
            verify JWT signature + expiry via jose
            extract {userId, tenantId, role}
            db.transaction(async tx => {
              await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`)
              req.tx = tx
              req.user = {id: userId, tenantId, role}
              return route handler
            })
3. Route    reads via req.tx (RLS applies); returns response
4. Fastify  commits transaction; cookie unchanged; response sent
```

### Request flow — signout

```
1. Browser  POST /v1/auth/signout
2. Fastify  Set-Cookie cpa_session=; Max-Age=0; same flags as before
            204 No Content
```

## Components

### New package: `@cpa/auth`

```
packages/auth/
├── package.json
├── src/
│   ├── index.ts        — barrel
│   ├── oidc.ts         — OIDC client config + handshake helpers (PKCE, state, nonce)
│   ├── jwt.ts          — sign/verify our JWT via jose; key from env
│   ├── session.ts      — Fastify plugin: verify cookie, open tx, SET LOCAL, attach req.user
│   ├── users.ts        — findOrCreateUser + lookupActiveTenant queries
│   └── *.test.ts       — co-located tests
└── tsconfig.json
```

**Dependencies:** `openid-client@^5`, `jose@^5`, `@cpa/db`, `@cpa/schemas`, `fastify@^5`, `zod@^3`.

### New routes in `apps/api`

| Route | Purpose |
|---|---|
| `GET /v1/auth/microsoft/login` | Initiate OIDC flow with Microsoft Entra |
| `GET /v1/auth/microsoft/callback` | Handle Microsoft redirect, issue session JWT |
| `GET /v1/auth/google/login` | Initiate OIDC flow with Google Workspace |
| `GET /v1/auth/google/callback` | Handle Google redirect, issue session JWT |
| `POST /v1/auth/signout` | Clear session cookie |
| `GET /v1/whoami` | Return `{ user, activeTenant, availableTenants }` |

### Environment variables (added to `.env.example`)

```
# OIDC — Microsoft Entra
MICROSOFT_OIDC_TENANT=common
MICROSOFT_OIDC_CLIENT_ID=
MICROSOFT_OIDC_CLIENT_SECRET=
MICROSOFT_OIDC_REDIRECT_URI=http://localhost:3000/v1/auth/microsoft/callback

# OIDC — Google Workspace
GOOGLE_OIDC_CLIENT_ID=
GOOGLE_OIDC_CLIENT_SECRET=
GOOGLE_OIDC_REDIRECT_URI=http://localhost:3000/v1/auth/google/callback

# Session JWT signing key (base64url-encoded 32+ bytes)
SESSION_JWT_SECRET=

# Cookie + JWT options
SESSION_COOKIE_NAME=cpa_session
SESSION_COOKIE_SECURE=false       # dev only; prod sets true automatically via NODE_ENV
SESSION_TTL_SECONDS=86400         # 24h
```

## Data model

### JWT claims

```typescript
interface SessionJWT {
  // Standard JWT claims
  iss: 'cpa-platform';
  aud: 'cpa-api';
  sub: string;              // user.id (UUID)
  iat: number;              // issued-at epoch seconds
  exp: number;              // expiry epoch seconds (iat + 86400)

  // Our custom claims
  email: string;
  primaryIdp: 'microsoft' | 'google';
  activeTenantId: string | null;     // null when user has no tenant_user rows
  activeRole: 'admin' | 'consultant' | 'viewer' | null;
  availableTenants: Array<{
    tenantId: string;
    name: string;
    slug: string;
    role: 'admin' | 'consultant' | 'viewer';
  }>;                       // ≤ 50 typically; cap at 100 for cookie size
}
```

Cookie value: signed JWT (HS256 or EdDSA depending on key shape; HS256 is fine for single-service P1).

Cookie size budget: 4KB. With ~50 tenants at ~100 bytes each + 200 bytes overhead = ~5KB worst case. **Mitigation:** if `availableTenants.length > 20`, omit it from the JWT and have `/v1/whoami` query it separately. Bench-mark in T7 of W2 plan.

### `whoami` response shape

```typescript
interface WhoamiResponse {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    primaryIdp: 'microsoft' | 'google';
  };
  activeTenant: {
    id: string;
    name: string;
    slug: string;
    role: 'admin' | 'consultant' | 'viewer';
  } | null;
  availableTenants: Array<{
    id: string;
    name: string;
    slug: string;
    role: 'admin' | 'consultant' | 'viewer';
    isDefault: boolean;
  }>;
}
```

Validated via `@cpa/schemas` zod schema; response goes through the existing `fastify-type-provider-zod` envelope.

## Error handling

| Failure | Response |
|---|---|
| State cookie missing or mismatch on callback | 400 `{error: 'invalid_state', message: 'OIDC state did not match'}` |
| ID token signature invalid | 401 `{error: 'invalid_token', message: 'IdP token verification failed'}` |
| ID token issuer/audience wrong | 401 `{error: 'invalid_token'}` |
| Token exchange returns 4xx/5xx | 502 `{error: 'idp_error', message: 'Identity provider error'}` |
| User found but `tenant_user` empty | 200 success, JWT issued with `activeTenantId=null`, portal handles |
| Cookie missing on `/v1/whoami` | 401 `{error: 'unauthenticated'}` |
| Cookie present but JWT expired | 401 `{error: 'session_expired'}` |
| Cookie present but signature invalid | 401 `{error: 'invalid_session'}` (also clear the cookie) |

All error responses use the existing `{error, message, requestId}` envelope from P0.

## Testing

### Unit tests (~12 expected)

- `jwt.test.ts`: sign + verify roundtrip; expired token rejection; tampered signature rejection; missing claim rejection
- `oidc.test.ts`: PKCE verifier generation; state randomness; nonce uniqueness across calls
- `users.test.ts`: findOrCreateUser creates new; finds existing by (idp, external_id); lookupActiveTenant returns is_default first then created_at
- `session.test.ts`: middleware stub-test that opens tx, sets GUC, attaches req.user

### Integration tests (~6 expected)

Using `nock` to intercept Microsoft + Google IdP HTTP calls:

- Full Microsoft login flow: GET /login → 302 to MS → simulated callback → user row created → JWT cookie set → 302 to /
- Full Google login flow: same but for Google
- Login with existing user updates `last_login_at` only
- Login with no tenant_user creates JWT with `activeTenantId=null`
- `/v1/whoami` with valid JWT returns expected shape
- `/v1/whoami` with expired JWT returns 401 + clears cookie
- `/v1/auth/signout` clears cookie

### Test count target at end of W2

- Existing: 8 db (RLS) + 9 api (P0 routes) = 17
- New: ~12 auth unit + ~6 auth integration = 18
- Total: ~35 across 5 packages

## What W2 does NOT do (deferred)

| Feature | Lands in |
|---|---|
| `/v1/tenants/*` (list, switch active tenant) | W3 |
| `/v1/users/*` (admin endpoints to manage firm membership) | W3 |
| Refresh tokens / sliding session | P3+ |
| Token revocation list | P3+ |
| Multi-factor auth (TOTP, security keys) | P3+ |
| Auth.js wiring in the consultant portal frontend | W4 |
| End-to-end browser test (real Playwright run) | W5 |
| Email-based account linking (e.g., Microsoft user signs in later via Google) | P3+ |
| `cpa_oidc_state` cookie hardening (encrypted vs signed) | T6 of W2 plan; revisit if blocker |

## Open questions parked for W2 plan

1. **JWT signing key** — single secret (HS256) for P1 dev; do we want JWKS-style rotation in P3? Tracked, not for now.
2. **Audit logging** — login events should land in an `audit_log` table eventually. Schema and API don't exist yet (P2 scope). For W2 we just `app.log.info` with structured fields; the audit_log table consumes those logs in P2.
3. **Rate limiting on login endpoints** — Fastify's `@fastify/rate-limit` is straightforward to add. We'll include it in W2 plan if it doesn't bloat scope; otherwise deferred to P3 platform polish.

## References

- [ADR-0002 §Identity provider strategy](../decisions/0002-identity-and-tenancy.md#identity-provider-strategy-q1) — Microsoft + Google OIDC commitment
- [ADR-0002 §Tenancy data model](../decisions/0002-identity-and-tenancy.md#tenancy-data-model-q2) — `tenant_user` + `availableTenants` shape
- [ADR-0002 §RLS context-setting](../decisions/0002-identity-and-tenancy.md#rls-context-setting) — `SET LOCAL app.current_tenant_id` pattern (now via `set_config()` per migration 0003)
- [Auth.js JWT callback shape](https://authjs.dev/concepts/session-strategies#jwt-session) — for W4 Next.js compatibility
- [openid-client docs](https://github.com/panva/node-openid-client)
- [jose docs](https://github.com/panva/jose)

## Next step

Invoke the `superpowers:writing-plans` skill to translate this design into a bite-sized W2 implementation plan at `docs/plans/2026-04-26-p1-w2-implementation.md`.
