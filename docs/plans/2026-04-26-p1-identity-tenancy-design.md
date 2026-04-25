# P1 — Identity, Tenancy & Consultant Portal Scaffold — Design

**Date:** 2026-04-26
**Status:** Approved — proceeding to implementation plan
**Author:** Aaron Newson + AI pair (Claude Opus 4.7)
**Builds on:** [P0 Foundation](./2026-04-25-p0-foundation.md) (tag `p0-foundation`, merged at `97b67fb`)
**Source spec:** [Architecture design](./2026-04-25-rdti-grants-platform-design.md) §6 P1 row

---

## 0. Decision summary

| Question | Locked decision |
|---|---|
| Q1 — Identity provider strategy | Microsoft Entra ID + Google Workspace OIDC from day 1, both via Auth.js |
| Q2 — Tenancy model | Full: multi-firm users (`tenant_user` M:N), per-claimant ACLs (`subject_tenant_user`), `subject_tenant.kind ∈ {claimant, financier}` |
| Q3 — Schema layout | Flat `packages/db/src/schema/*.ts` for the platform's lifetime, snake_case.ts naming |
| Q4 — Federation depth | Schema primitives only (`delegation_token` table); API + UX deferred to P8 |
| Q5 — Consultant onboarding | No formal onboarding flow — CLI seed script (`tools/scripts/onboard-tenant.ts`) for early customers |

P1 also folds in the 6 P0 final-review items (tracer-init load order, `/readyz` DB-down test, `App` type cast tightening, ADR-2 schema layout convention, reqId-vs-traceparent decision, watch first CI run).

## 1. Repo structure additions

```
apps/consultant-portal/                 # NEW: Next.js 15 App Router
  src/app/login/page.tsx
  src/app/(authed)/layout.tsx           # auth gate
  src/app/(authed)/dashboard/page.tsx   # empty state
  src/app/(authed)/settings/team/page.tsx
  src/app/api/auth/[...nextauth]/route.ts
  next.config.ts, package.json, tsconfig.json, tsconfig.test.json

packages/auth/                          # NEW: SSO + session
  src/providers.ts                      # Microsoft Entra + Google config
  src/session.ts                        # custom Fastify session
  src/jwt.ts                            # signing/verification
  src/rls.ts                            # current_tenant_id context-setter
  src/index.ts, package.json, tsconfig.json, tsconfig.test.json

packages/db/src/schema/                 # 6 new schema files (flat, snake_case)
  tenant.ts
  subject_tenant.ts
  user.ts
  tenant_user.ts
  subject_tenant_user.ts
  delegation_token.ts                   # primitive only — populated in P8

packages/db/migrations/0001_<adj>_<noun>.sql

docs/decisions/0002-identity-and-tenancy.md   # NEW ADR

tools/scripts/onboard-tenant.ts         # NEW CLI seed script
```

## 2. Data model

### 2.1 `tenant` — consultant firm (white-label root)

```ts
export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),                                  // URL-safe identifier
  primary_idp: text('primary_idp', { enum: ['microsoft', 'google', 'mixed'] })
    .notNull().default('mixed'),
  created_at: timestamp(...).notNull().defaultNow(),
  updated_at: timestamp(...).notNull().defaultNow().$onUpdate(() => new Date()),
  deleted_at: timestamp(...),
});
```

### 2.2 `subject_tenant` — claimant or financier (the firm's "client")

```ts
export const subject_tenant = pgTable('subject_tenant', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenant_id: uuid('tenant_id').notNull().references(() => tenant.id),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['claimant', 'financier'] }).notNull().default('claimant'),
  created_at, updated_at, deleted_at,
});
```

### 2.3 `user` — global; not bound to any single tenant

```ts
export const user = pgTable('user', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),                                // canonical, lowercased
  display_name: text('display_name'),
  primary_idp: text('primary_idp', { enum: ['microsoft', 'google'] }).notNull(),
  external_id: text('external_id').notNull(),                             // 'microsoft:<oid>' or 'google:<sub>'
  last_login_at: timestamp(...),
  created_at, updated_at, deleted_at,
});
```

### 2.4 `tenant_user` — M:N membership (a user can be in multiple firms)

```ts
export const tenant_user = pgTable('tenant_user', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenant_id: uuid('tenant_id').notNull().references(() => tenant.id),
  user_id: uuid('user_id').notNull().references(() => user.id),
  role: text('role', { enum: ['admin', 'consultant', 'viewer'] }).notNull().default('consultant'),
  is_default: boolean('is_default').notNull().default(false),             // auto-active firm at login
  created_at, updated_at, deleted_at,
}, (t) => ({ uniq: uniqueIndex().on(t.tenant_id, t.user_id) }));
```

### 2.5 `subject_tenant_user` — per-claimant ACL

```ts
export const subject_tenant_user = pgTable('subject_tenant_user', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  subject_tenant_id: uuid('subject_tenant_id').notNull().references(() => subject_tenant.id),
  user_id: uuid('user_id').notNull().references(() => user.id),
  role: text('role', { enum: ['lead', 'observer'] }).notNull().default('observer'),
  created_at, updated_at, deleted_at,
}, (t) => ({ uniq: uniqueIndex().on(t.subject_tenant_id, t.user_id) }));
```

### 2.6 `delegation_token` — federation primitive (P1 schema only; populated in P8)

```ts
export const delegation_token = pgTable('delegation_token', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  issuer_tenant_id: uuid('issuer_tenant_id').notNull().references(() => tenant.id),
  subject_tenant_id: uuid('subject_tenant_id').notNull().references(() => subject_tenant.id),
  issued_to_email: text('issued_to_email').notNull(),
  scope: jsonb('scope').notNull(),                                        // {"read": ["assurance_report"]}
  issued_by_user_id: uuid('issued_by_user_id').notNull().references(() => user.id),
  expires_at: timestamp(...).notNull(),
  revoked_at: timestamp(...),
  created_at, updated_at,                                                 // append-only — no deleted_at
});
```

### 2.7 Audit-column convention

All P1 tables follow the convention from T10: `created_at`/`updated_at`/`deleted_at` (notNull/notNull/nullable), with `$onUpdate(() => new Date())` on `updated_at`. `delegation_token` skips `deleted_at` because it's append-only by design.

## 3. Row-Level Security

`subject_tenant`, `tenant_user`, `subject_tenant_user`, and `delegation_token` get RLS policies. `tenant` and `user` are global tables — access is gated at the API layer.

```sql
ALTER TABLE subject_tenant ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subject_tenant
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE tenant_user ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_user
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE subject_tenant_user ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subject_tenant_user
  USING (subject_tenant_id IN (
    SELECT id FROM subject_tenant
    WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
  ));

ALTER TABLE delegation_token ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delegation_token
  USING (issuer_tenant_id = current_setting('app.current_tenant_id')::uuid);
```

The Fastify preHandler middleware sets the context per request:

```ts
app.addHook('preHandler', async (req) => {
  const { activeTenantId } = req.session;
  await req.dbConnection.execute(sql`SET LOCAL app.current_tenant_id = ${activeTenantId}`);
});
```

`SET LOCAL` scopes the variable to the current transaction; `postgres-js` runs each query on a connection pool member that's released back to the pool after the response. We use `SET LOCAL` inside an explicit transaction (or rely on the postgres-js default transaction) to ensure the variable doesn't leak across requests.

## 4. Auth flow

```
1. User clicks "Sign in with Microsoft" on /login
   → Auth.js redirects to Entra OIDC authorize URL

2. Entra authenticates, redirects to /api/auth/callback/microsoft
   → Auth.js validates the OIDC token, extracts:
     email, oid (Entra object ID), tid (Entra tenant ID), name

3. Custom callback in @cpa/auth handles tenant resolution:
   a) Look up user by (email, primary_idp = 'microsoft')
   b) If no user: registration is denied (no self-serve in P1)
      → redirect to error page "Contact your administrator for access"
   c) If user found: load their tenant_user rows
   d) Pick active tenant:
      - JWT cookie has activeTenantId AND user is a member → use it
      - Else use is_default = true tenant
      - Else use first tenant (smallest id, deterministic)

4. Issue JWT cookie {
     userId, email, displayName,
     activeTenantId, activeTenantRole,
     availableTenants: [{ id, name, role }, ...]
   }

5. Fastify middleware on every authed request:
   - Verify JWT
   - SET LOCAL app.current_tenant_id = activeTenantId
   - Populate req.session
```

## 5. API contract additions

```
/v1/auth/login/microsoft         GET   redirect to Entra
/v1/auth/login/google            GET   redirect to Google
/v1/auth/callback/{idp}          GET   OIDC callback (handled by Auth.js)
/v1/auth/logout                  POST  clear session
/v1/auth/session                 GET   current session info (or 401)

/v1/tenants/me                   GET   active tenant + role + available[]
/v1/tenants/switch               POST  body: { tenantId } → updated session

/v1/subject-tenants              GET   list claimants the user can access (RLS-filtered)
/v1/subject-tenants/:id          GET   single (admin sees all firm's; consultant by ACL)
/v1/subject-tenants              POST  create (admin only)

/v1/users                        GET   users in active tenant (admin only)

/readyz                          GET   { status, checks: { db, idp_microsoft, idp_google } }
```

## 6. Consultant Portal (Next.js 15 App Router)

Routes:

| Route | Auth | Purpose |
|---|---|---|
| `/login` | Public | Sign in with Microsoft / Google buttons |
| `/` | Authed | Redirect to `/dashboard` |
| `/dashboard` | Authed | Empty state: "No claimants yet — talk to your admin" |
| `/settings/team` | Authed (admin) | Team member list, roles |
| `/api/auth/[...nextauth]` | — | Auth.js handler (login, callback, session, signout) |

Layout shell on authed pages: tenant-switcher dropdown if `availableTenants.length > 1`, sign-out button, active tenant name in header.

Style: shadcn/ui + Tailwind CSS. Decided when scaffolding (W4); aligns with future UI work in P3+.

## 7. Phasing within P1

P1 spans approximately **5 weeks** at solo+AI pace.

| Week | Focus | Includes P0 review items |
|---|---|---|
| **W1** | P0 review fixes + DB schemas + RLS | I1 tracer-init load order, I2 /readyz down-test, I3 App cast tightening, I5 reqId ADR; tenant + subject_tenant + user schemas; migrations; RLS policies; RLS isolation tests |
| **W2** | `@cpa/auth` package | Auth.js setup, Entra + Google providers, JWT signing/verification, custom Fastify session middleware |
| **W3** | Tenant resolution + RLS context | Auth.js callback wiring, RLS context-setter middleware, `/v1/tenants/me`, `/v1/tenants/switch` |
| **W4** | Consultant Portal scaffold | Next.js skeleton, login page, authed layout shell, empty state, tenant switcher; onboarding CLI seed script |
| **W5** | Integration tests + cold-restart + tag | End-to-end auth tests, P1 cold-restart verification, tag `p1-identity-tenancy` |

I6 (watch first CI run) lands at the first push of W1's work. ADR-0002 (identity & tenancy) lands at end of W1.

## 8. Risks & watch-outs

1. **OIDC tenant resolution edge cases** — user signs in with no matching pre-seeded user. P1 says "registration denied." Need clean error UX directing them to admin. Don't silently 500.
2. **JWT secret rotation** — single signing secret in env for P1. Rotation infrastructure deferred to P3.
3. **Auth.js ↔ Fastify integration** — Auth.js is Next.js-centric; the Fastify side uses a custom JWT-verify middleware that reuses Auth.js's signing config. Verify shape contract early in W2.
4. **RLS test fixtures** — substantial test file proving cross-tenant isolation for every RLS-protected table. Don't shortcut.
5. **Per-claimant ACL N+1 risk** — every list endpoint filtering via `subject_tenant_user` needs EXPLAIN sanity check in W5.
6. **Multi-firm session UX** — `availableTenants[]` and `/v1/tenants/switch` are small but interlocked; needs explicit end-to-end test.
7. **`SET LOCAL` and connection pooling** — postgres-js's pool reuses connections; ensure each request's RLS context is set inside a transaction so it doesn't bleed.

## 9. Out of scope for P1

- Self-serve signup
- Team-invite UX
- Email sending
- Stripe / billing
- Federation API or UX (P8)
- Per-tenant branding (logos, colors)
- Multi-IdP per user (one user → one IdP for P1; can swap providers via re-seeding in P2+)
- Mobile app (P3)
- Anything requiring P2's event ledger or P5's documents

## 10. Next step

Invoke `superpowers:writing-plans` skill to produce the detailed W1 implementation plan with file-level tasks, test specs, and acceptance criteria. Subsequent weeks (W2–W5) get their own plan documents written just-in-time, not all upfront — same pattern P0 used.
