# P1 W5 — Playwright E2E + Tag + Merge Design

**Status:** Approved 2026-04-26
**Builds on:** [ADR-0002](../decisions/0002-identity-and-tenancy.md), [W4 design](./2026-04-26-p1-w4-consultant-portal-design.md)

## Goal

Close out P1 with browser-level end-to-end tests covering the consultant portal's full authenticated flow, then tag `p1-identity-tenancy` at the green CI commit and merge `p1/identity-tenancy` into `main`.

## Decisions

### Q1 — Browser scope: Chromium only (A)

The cpa-platform's user base is Australian R&D consultants on Chrome or Edge (both Chromium). Adding Firefox + WebKit triples CI runtime without catching real issues for our segment. Single-engine coverage matches the team Slack channel + Outlook + Teams reality of AU SME consultancies.

**If a future customer reports a Safari bug, we add WebKit then.** YAGNI for P1.

### Q2 — Test data: shared seeds + per-test cleanup with unique IDs (B)

Same pattern as the existing W2 nock integration tests and W3 RLS isolation tests. Each test creates fixtures with unique ID prefixes (e.g., `e2e-tenant-switch-...`, `e2e-add-user-...`) so concurrent tests don't collide, and `afterEach` cleans up via `privilegedSql`.

**Discipline rule:** every fixture insert is paired with a cleanup. Tests that fail mid-run leak data; the next run's seed must be ON-CONFLICT-DO-NOTHING-ish where applicable.

### Q3 — Auth flow: programmatic JWT injection (B)

The OIDC flow is already covered end-to-end by W2's 6 nock integration tests (`apps/api/src/routes/auth/microsoft.integration.test.ts` + Google). E2E tests focus on what's UNIQUE to the browser: cookie persistence across navigations, JS-driven mutations, optimistic UI, form submission, multi-page state.

**Implementation:** a Playwright fixture that:
1. Calls `@cpa/auth.signSession(claims, SESSION_JWT_SECRET)` to mint a JWT
2. Sets the `cpa_session` cookie via `context.addCookies([...])` before navigation
3. Navigates to the test path; the API accepts the JWT, the portal renders authenticated state

This means our e2e tests don't depend on real Microsoft/Google. They prove the post-login UX works end to end. The pre-login OIDC dance is W2's responsibility.

### Q4 — Test location: `apps/web/e2e/` (A)

Colocated with the portal. Tests refer to portal paths (`/users`, `/users/[id]`); colocation means a page rename triggers a clear test-path rename in the same workspace. Playwright config lives at `apps/web/playwright.config.ts`.

**No new workspace package** — Playwright is a devDependency of `@cpa/web`. The `apps/web/e2e/` directory holds tests + fixtures + the auth helper.

### Q5 — CI: block PR merge on green e2e (A)

The point of the gate is to catch wiring bugs. Non-blocking gates decay because no one feels the consequences when they break.

**CI workflow change:** add a `e2e` job to `.github/workflows/ci.yml` that runs after `build`, depends on Postgres + the API + the web app being up. Estimated added CI time: 5-10 minutes for the ~6-test suite.

## Architecture

### File layout

```
apps/web/
├── playwright.config.ts          (NEW — Playwright config; webServer: pnpm dev)
├── e2e/
│   ├── fixtures/
│   │   ├── auth.ts               (signSession + setCookie helper)
│   │   └── test-data.ts          (DB seed/cleanup helpers)
│   ├── login-redirect.spec.ts    (anon → /login)
│   ├── dashboard.spec.ts         (whoami + active tenant render)
│   ├── tenant-switch.spec.ts     (switcher dropdown changes active firm)
│   ├── users-admin-list.spec.ts  (admin sees firm members)
│   ├── users-admin-add.spec.ts   (POST /v1/users via form; 404 + 409 toasts)
│   ├── users-admin-edit.spec.ts  (PATCH role + last-admin guard)
│   └── users-admin-remove.spec.ts (DELETE soft-delete; last-admin guard)
```

7 spec files, ~6-8 tests total covering the W4 admin surface. Each spec is short (~30-50 lines).

### Auth fixture

```ts
// apps/web/e2e/fixtures/auth.ts
import type { Page, BrowserContext } from '@playwright/test';
import { signSession } from '@cpa/auth';

export interface SessionUser {
  id: string;
  email: string;
  primaryIdp: 'microsoft' | 'google';
  activeTenantId: string | null;
  activeRole: 'admin' | 'consultant' | 'viewer' | null;
  availableTenants: Array<{
    tenantId: string;
    name: string;
    slug: string;
    role: 'admin' | 'consultant' | 'viewer';
  }>;
}

const SESSION_SECRET =
  process.env.SESSION_JWT_SECRET ?? 'dev-only-32-bytes-of-entropy-pad!';

export async function signInAs(context: BrowserContext, user: SessionUser): Promise<void> {
  const jwt = await signSession(
    {
      sub: user.id,
      email: user.email,
      primaryIdp: user.primaryIdp,
      activeTenantId: user.activeTenantId,
      activeRole: user.activeRole,
      availableTenants: user.availableTenants,
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

  await context.addCookies([
    {
      name: 'cpa_session',
      value: jwt,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}
```

### Test data fixture

```ts
// apps/web/e2e/fixtures/test-data.ts
import { sql, privilegedSql } from '@cpa/db/client';

export async function seedTenant(slug: string, name = `E2E ${slug}`): Promise<string> {
  const id = crypto.randomUUID();
  await privilegedSql`INSERT INTO tenant (id, name, slug, primary_idp)
                       VALUES (${id}, ${name}, ${slug}, 'mixed')`;
  return id;
}

export async function seedUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await privilegedSql`INSERT INTO "user" (id, email, primary_idp, external_id)
                       VALUES (${id}, ${email}, 'microsoft', ${'microsoft:' + email})
                       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
                       RETURNING id`;
  return id;
}

export async function seedMembership(
  tenantId: string,
  userId: string,
  role: 'admin' | 'consultant' | 'viewer',
  isDefault: boolean,
): Promise<void> {
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${tenantId}, ${userId}, ${role}, ${isDefault})`;
}

export async function cleanupBySlug(slugPrefix: string): Promise<void> {
  await privilegedSql`DELETE FROM tenant_user
                       WHERE tenant_id IN (SELECT id FROM tenant WHERE slug LIKE ${slugPrefix + '%'})`;
  await privilegedSql`DELETE FROM tenant WHERE slug LIKE ${slugPrefix + '%'}`;
}

export async function cleanupByEmail(emailPrefix: string): Promise<void> {
  await privilegedSql`DELETE FROM tenant_user
                       WHERE user_id IN (SELECT id FROM "user" WHERE email LIKE ${emailPrefix + '%'})`;
  await privilegedSql`DELETE FROM "user" WHERE email LIKE ${emailPrefix + '%'}`;
}
```

### Playwright config

```ts
// apps/web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,         // RLS + shared DB; serialize for safety
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @cpa/api dev',
      url: 'http://localhost:3000/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cpa/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
  ],
});
```

## Test scope

| Spec | What it proves |
|---|---|
| `login-redirect.spec.ts` | Anon GET / → 401 from whoami → AuthGuard redirects to /login (1 test) |
| `dashboard.spec.ts` | Authenticated user sees email + active tenant name + role badge (1 test) |
| `tenant-switch.spec.ts` | Switcher dropdown click → cpa_session cookie updates → dashboard re-renders with new firm (1 test) |
| `users-admin-list.spec.ts` | Admin sees firm members table; non-admin sees "Admin role required" (2 tests) |
| `users-admin-add.spec.ts` | Admin adds existing user via email → success toast → user appears in list (1 test) |
| `users-admin-edit.spec.ts` | Admin demotes consultant; last-admin demote attempt → 409 toast (1 test) |
| `users-admin-remove.spec.ts` | Admin removes user via Dialog confirm → soft-deleted; last-admin remove attempt → 409 toast (1 test) |

**Total: ~8 e2e tests**, each with its own fixtures + cleanup.

## CI integration

Add to `.github/workflows/ci.yml`:

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: [build]
    services:
      postgres:
        image: pgvector/pgvector:0.8.0-pg16
        env:
          POSTGRES_USER: cpa
          POSTGRES_PASSWORD: cpa
          POSTGRES_DB: cpa_dev
        ports: ['5433:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: |
          docker exec -i $(docker ps -qf ancestor=pgvector/pgvector:0.8.0-pg16) \
            psql -U cpa -d cpa_dev -f - < tools/postgres/init.sql
      - run: pnpm --filter @cpa/db migrate
        env:
          DATABASE_URL: postgres://cpa:cpa@localhost:5433/cpa_dev
      - run: pnpm --filter @cpa/web exec playwright install chromium
      - run: pnpm --filter @cpa/web exec playwright test
        env:
          DATABASE_URL: postgres://cpa:cpa@localhost:5433/cpa_dev
          DATABASE_URL_APP: postgres://cpa_app:cpa_app_dev_pwd@localhost:5433/cpa_dev
```

The whole job adds 5-10 min to CI. Acceptable for the regression coverage.

## Tag + merge ceremony

After all 8 e2e tests + W1-W4 unit/integration suite pass on green CI on `p1/identity-tenancy`:

1. **Tag at the green commit:**
   ```bash
   git tag -a p1-identity-tenancy -m "P1 Identity, Tenancy, RLS, Portal — full identity stack shipped"
   git push origin p1-identity-tenancy
   ```

2. **Open PR** `p1/identity-tenancy` → `main` (no fast-forward; preserve the W1-W5 history as merge commits)

3. **Merge** via GitHub PR with `--no-ff` to keep the staged narrative.

4. **Post-merge cleanup** (optional): delete the local + remote `p1/identity-tenancy` branch. The tag preserves the work.

## What W5 does NOT do (carried)

| Item | Lands in |
|---|---|
| Mobile responsive layout polish | P2 UX hardening |
| Real Microsoft/Google E2E with test tenant creds | P3+ when needed |
| Visual regression (screenshot diff) testing | P2+ |
| Performance budget enforcement (Web Vitals) | P3+ |
| Accessibility audit (axe-core in tests) | P2+ |
| Audit log of admin actions | P2 schema |

## Estimated time

- 1 focused session, ~3 hours: Playwright install + config + auth fixture + test data fixture + 8 specs + CI workflow + tag + merge.
- Most-fragile bits: Playwright `webServer` startup race (waits for healthz), CI Postgres init.sql ordering, the auth fixture cookie domain matching (`localhost` not `127.0.0.1`).

## Next step

Invoke `superpowers:writing-plans` to translate this design into a bite-sized W5 implementation plan.
