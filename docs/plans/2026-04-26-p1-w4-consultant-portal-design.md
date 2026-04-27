# P1 W4 — Consultant Portal + Onboarding CLI Design

**Status:** Approved 2026-04-26
**Builds on:** [ADR-0002](../decisions/0002-identity-and-tenancy.md), [W2 design](./2026-04-26-p1-w2-auth-design.md), [W3 design](./2026-04-26-p1-w3-tenant-and-user-endpoints-design.md)

## Goal

Ship a Next.js 15 portal that consultants can actually log into, switch firms, and manage users from. Plus the platform-admin CLI script that seeds a brand-new firm with its first admin user.

This is **not** a "scaffold" — Q4 was answered A (full admin), so the portal exposes the complete W3 endpoint surface end-to-end. Consultants should be able to do their full firm admin work without ever curling the API.

## Decisions

### Q1 — Auth integration: pure consumer of the Fastify API (B)

The portal calls our existing W2 endpoints (`/v1/auth/microsoft/login`, `/v1/auth/google/login`, `/v1/auth/signout`). The OIDC dance, JWT issuance, and cookie management all stay in the API. The portal only knows: redirect to `/v1/auth/<provider>/login` to start auth, call `/v1/whoami` to find out who's signed in, call `/v1/auth/signout` to end the session.

**Same-origin requirement.** The session cookie is `httpOnly + sameSite=Lax` (W2 design). For the portal to send it on `/v1/*` requests, both must be same-origin. Solution:

- **Dev:** Next.js `rewrites` config proxies `/v1/*` → `http://localhost:3000` (the Fastify API). Portal runs at `localhost:5173` (or whatever Next.js picks).
- **Prod:** single deployment, single domain. Reverse proxy (Caddy / nginx / load balancer) routes `/v1/*` to API and `/` to Next.js.

This keeps the cookie domain story trivial. No CORS, no `__Host-` prefix subtleties, no shared-domain cookies.

### Q2 — Styling: Tailwind + shadcn/ui (B)

Tailwind 3.4+ for utilities. shadcn/ui for accessible Radix-based primitives (Button, Input, Dialog, Table, Toast, DropdownMenu, Card, Form). shadcn components are copy-paste, not a runtime dep — we own the code. Theme via `globals.css` CSS variables (default light + dark via `next-themes`).

### Q3 — Data fetching: client-side `@tanstack/react-query` (B)

All data fetching from React Components on the client side via `@tanstack/react-query@^5`:
- `useQuery` for reads (whoami, tenants, users)
- `useMutation` for writes (switch tenant, add user, edit user, delete user)
- `queryClient.invalidateQueries(['users'])` after mutations for clean optimistic UI

We deliberately skip Server Components for fetches in this phase — the consultant portal isn't SEO-sensitive, the request waterfall is short (just one whoami call gates render), and cookie-forwarding from RSC adds complexity we don't need yet.

A typed fetch helper at `apps/web/src/lib/api.ts` wraps `fetch` with:
- `credentials: 'include'`
- Automatic JSON parse + typed return
- Error envelope handling (`{error, message, requestId}` from API)
- Auto-redirect to `/login` on 401

### Q4 — Page scope: FULL admin (A)

| Path | Purpose | Auth |
|---|---|---|
| `/login` | Buttons for "Continue with Microsoft" + "Continue with Google" | Public |
| `/` | Dashboard — shows current user, active firm, tenant switcher dropdown | Authenticated |
| `/tenants` | Full list of user's firm memberships (alternative tenant-switcher entry) | Authenticated |
| `/users` | Admin: list firm members, search/filter, link to add/edit | Admin only |
| `/users/new` | Add user by email form (calls POST /v1/users) | Admin only |
| `/users/[userId]` | Edit user — change role, set isDefault, soft-delete button | Admin only |

The portal hard-redirects to `/login` on any 401 from `/v1/whoami`. Non-admin users land on `/` and only see the tenant switcher; the `/users` link is conditionally hidden when `req.user.role !== 'admin'`. If they navigate to `/users` directly, they get a "Forbidden" empty state (or redirect home with a toast).

### Q5 — Onboarding CLI: flags-only (C)

`tools/scripts/onboard-tenant.ts`:

```bash
pnpm tsx tools/scripts/onboard-tenant.ts \
  --name "Firm Foo" \
  --slug "firm-foo" \
  --admin-email "alice@firmfoo.com" \
  --primary-idp microsoft
```

Behaviour:
1. Validate flags (slug regex, email format, idp enum)
2. Look up user by email via `privilegedSql`. **If not found: error with hint** ("User must sign in once via Microsoft/Google before being made an admin")
3. Insert tenant via `privilegedSql` (no RLS on tenant table); on slug conflict, error
4. Insert `tenant_user` row (admin role, is_default=true) via `privilegedSql`
5. Print summary: tenant_id, user_id, admin email
6. Exit 0 on success, exit 1 with structured error on any failure

CLI parsing via Node 22's stdlib `parseArgs` from `node:util` (no extra dep).

## Architecture

### Workspace layout

```
apps/
├── api/        (existing, W1-W3)
└── web/        (NEW — W4)
    ├── package.json
    ├── next.config.ts
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── components.json   (shadcn config)
    ├── public/
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   ├── globals.css
        │   ├── page.tsx
        │   ├── login/page.tsx
        │   ├── tenants/page.tsx
        │   └── users/
        │       ├── page.tsx
        │       ├── new/page.tsx
        │       └── [userId]/page.tsx
        ├── components/
        │   ├── ui/                   (shadcn primitives — copy-paste)
        │   ├── auth-guard.tsx        (HOC: redirect to /login on 401)
        │   ├── tenant-switcher.tsx   (dropdown)
        │   ├── users-table.tsx
        │   ├── add-user-form.tsx
        │   └── edit-user-form.tsx
        ├── lib/
        │   ├── api.ts                (typed fetch wrapper)
        │   ├── query-client.ts       (react-query setup)
        │   └── types.ts              (re-exports from @cpa/schemas)
        └── hooks/
            ├── use-whoami.ts
            ├── use-switch-tenant.ts
            └── use-users.ts

tools/
└── scripts/
    └── onboard-tenant.ts             (NEW — W4 CLI)
```

### Data flow — login

```
1. Browser GET /login
2. Portal renders 2 buttons; user clicks "Continue with Microsoft"
3. Browser navigates to /v1/auth/microsoft/login (same-origin via Next.js rewrites)
4. Fastify generates PKCE+state+nonce, sets handshake cookie, 302 to login.microsoftonline.com
5. User authenticates at Microsoft
6. Microsoft 302 to /v1/auth/microsoft/callback
7. Fastify exchanges code, finds-or-creates user, signs JWT, sets cpa_session cookie, 302 to /
8. Browser navigates to / (carries cpa_session cookie)
9. Portal RootLayout's QueryProvider triggers useWhoami() → fetch /v1/whoami → 200 with user data
10. Dashboard renders
```

### Data flow — tenant switch

```
1. User clicks tenant in dropdown
2. useSwitchTenant.mutate(tenantId) → POST /v1/tenants/switch
3. API verifies membership, re-signs JWT with new activeTenantId, sets new cpa_session cookie
4. queryClient.invalidateQueries() refreshes whoami + users + tenants
5. UI re-renders with new active firm context
```

### Data flow — admin: add user

```
1. Admin clicks "Add User" on /users; navigates to /users/new
2. AddUserForm renders email + role + isDefault inputs (zod-validated client-side)
3. On submit, useAddUser.mutate(payload) → POST /v1/users
4. On success: toast("Added Alice"), invalidate users query, navigate back to /users
5. On 404 user_not_found: toast("Ask Alice to sign in once via Microsoft first")
6. On 409 already_member: toast("Alice is already a member")
```

## Error handling

The typed `api.ts` wrapper handles 5 cases:
1. **2xx success:** parse JSON, return typed result
2. **401 unauthenticated / invalid_session:** clear local query cache, redirect to `/login`
3. **403 forbidden / no_active_tenant:** throw a typed `ForbiddenError`; UI renders "Admin role required" or "No active firm"
4. **404 not_found:** throw a typed `NotFoundError`; calling code handles (most show toast)
5. **409 conflict (e.g. last_admin, already_member):** throw a typed `ConflictError`; UI shows the message
6. **5xx / network:** throw a generic `ApiError`; UI shows toast with retry button

### Toast strategy

shadcn/ui's `useToast` hook (Radix-based). Success toasts auto-dismiss after 3s, error toasts after 6s, with X to dismiss. No queue overflow — limit to 3 simultaneous.

## Testing

For W4 we add **light test coverage**:

- **Unit:** `lib/api.ts` typed-fetch behaviour (success / 401 redirect / 4xx throw / network error). Mock global fetch.
- **Component:** Tenant switcher renders memberships + invokes mutation on click. Use `@testing-library/react` + jsdom.
- **CLI:** `onboard-tenant.ts` integration test — actually inserts a tenant + tenant_user against the dev DB; verifies row counts; cleans up.

Heavy E2E (Playwright clicking through the real portal) lands in **W5**. W4's tests prove the unit-level wiring works; W5 proves the full browser flow.

**Test count target end of W4:** ~95 (W3) + ~12 (W4 web + CLI) = **~107 across 6 packages**.

## What W4 does NOT do (deferred)

| Feature | Lands in |
|---|---|
| Real browser end-to-end test | W5 |
| Production deployment config (Caddy/nginx + container build) | P2 |
| Email-based user invitations | P3+ |
| Audit log UI | P2+ |
| Tenant CREATE / UPDATE / DELETE in portal (just CLI for now) | P2 admin UI |
| Theme picker / dark mode toggle (just defaults to system) | P2+ |
| User profile page (edit own displayName) | P2+ |
| Notifications / activity feed | P2+ |
| 2FA / step-up auth | P3+ |

## Workspace package count after W4

- `@cpa/api` (W0-W3)
- `@cpa/auth` (W2-W3)
- `@cpa/db` (W0-W3)
- `@cpa/observability` (W0)
- `@cpa/schemas` (W0-W3)
- `@cpa/web` ← NEW (W4)

Six packages. The `tools/scripts/` directory remains as it is — not a package.

## Open questions parked for the plan

1. **`@tanstack/react-query` SSR hydration:** since we use App Router but no RSC fetches, the `QueryProvider` lives in a `'use client'` boundary. Standard pattern; no SSR-hydration plumbing needed.
2. **Form validation library:** `react-hook-form` + `@hookform/resolvers` + zod. `@cpa/schemas`'s zod schemas re-used for client-side validation.
3. **CSP and other security headers:** Next.js's default headers are fine for W4. Production hardening (CSP, HSTS, Permissions-Policy) lands in P2 platform polish.

## References

- [Next.js App Router docs](https://nextjs.org/docs/app)
- [shadcn/ui docs](https://ui.shadcn.com)
- [@tanstack/react-query v5 docs](https://tanstack.com/query/latest)

## Next step

Invoke `superpowers:writing-plans` to translate this design into a bite-sized W4 implementation plan.
