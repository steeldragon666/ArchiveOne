# P1 W5 — E2E + Tag + Merge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task.

**Goal:** Ship Playwright e2e coverage for the W4 portal, lock the green commit with tag `p1-identity-tenancy`, and merge `p1/identity-tenancy` → `main` to close P1.

**Architecture:** Playwright as devDep of `@cpa/web`. Auth via programmatic JWT injection through a Playwright fixture (uses `signSession` from `@cpa/auth`). Test data via `privilegedSql` seed/cleanup helpers. CI runs Postgres service + applies migrations + installs Chromium + runs the suite. Tag ceremony at the end.

**Tech Stack:** `@playwright/test@^1.49`, `@cpa/auth.signSession`, `@cpa/db/client.privilegedSql`. No new packages — `apps/web/e2e/` directory.

**Source design:** [P1 W5 design](./2026-04-26-p1-w5-e2e-and-tag-design.md), all 5 decisions locked.

**Branch:** Continue on `p1/identity-tenancy` at `7861cf1`.

---

## Task graph (14 tasks)

```
T1 Install Playwright + Chromium (solo)
T2 playwright.config.ts (solo)
Batch A: T3 + T4 in parallel (auth fixture + test-data fixture)
Batch B: T5-T11 in parallel (7 specs, all independent)
T12 CI workflow update (can run during Batch B)
T13 Cold-start + push
T14 Tag p1-identity-tenancy + open PR
```

Estimated wall-clock: 2-3 hours.

---

## Pre-flight

- `git rev-parse HEAD` should match `7861cf1` (W5 design commit) or later
- Postgres up: `docker ps --filter name=cpa-postgres` returns Up
- All W4 gates green: `pnpm typecheck && lint && test && format:check` clean
- `apps/web/.env` (gitignored) carries `SESSION_JWT_SECRET=dev-only-32-bytes-of-entropy-pad!` — required for auth fixture to sign matching JWTs

---

## Task 1: Install Playwright + Chromium

**Files:**
- Modify: `apps/web/package.json` (add devDep)
- Add: `apps/web/.gitignore` (Playwright artifacts)

**Step 1: Add Playwright as devDep**

```bash
cd /c/Users/Aaron/cpa-platform-worktrees/p1
pnpm --filter @cpa/web add -D @playwright/test@^1.49
```

**Step 2: Install Chromium browser**

```bash
pnpm --filter @cpa/web exec playwright install chromium
```

(Downloads ~140 MB. CI does this fresh per run.)

**Step 3: Add a script to `apps/web/package.json`**

Add to `scripts`:
```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui",
```

**Step 4: Append to `apps/web/.gitignore` (create if missing)**

```
# Playwright
/test-results/
/playwright-report/
/playwright/.cache/
/blob-report/
```

**Step 5: Commit**

```bash
git add apps/web/package.json apps/web/.gitignore pnpm-lock.yaml
git commit -m "chore(web): add Playwright + Chromium for W5 e2e

Test runner: @playwright/test@^1.49 as devDep. Chromium installed via
'playwright install chromium' (CI installs fresh per run).

Scripts: 'pnpm --filter @cpa/web e2e' (headless), '...e2e:ui'
(interactive). Test artifacts gitignored.

P1 W5 task 1 of 14."
```

---

## Task 2: Playwright config

**Files:** Create `apps/web/playwright.config.ts`

**Step 1: Write the config**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // RLS + shared dev DB; serialize for safety
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cpa/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env['CI'],
      timeout: 90_000,
    },
  ],
});
```

**Step 2: Verify the file builds**

```bash
pnpm --filter @cpa/web typecheck
```

(Should pass — `@playwright/test` provides the types.)

**Step 3: Commit**

```bash
git add apps/web/playwright.config.ts
git commit -m "feat(web): playwright.config.ts — single Chromium project, serialized workers

webServer auto-starts pnpm dev for both API (3000) and web (5173)
before tests; reuses existing server in dev for fast iteration.
Serialized workers (workers: 1, fullyParallel: false) because the
shared dev DB makes parallel test runs collide on RLS GUC + cleanup.

P1 W5 task 2 of 14."
```

---

## Task 3: Auth fixture (`apps/web/e2e/fixtures/auth.ts`)

Per design doc §Q3 — programmatic JWT injection.

```ts
import type { BrowserContext } from '@playwright/test';
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
  process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';

/**
 * Drop a valid cpa_session cookie into the BrowserContext so subsequent
 * navigations are authenticated. Must be called BEFORE page.goto.
 */
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

Commit:
```bash
git add apps/web/e2e/fixtures/auth.ts
git commit -m "feat(web): e2e auth fixture — sign + setCookie for JWT injection

Bypasses the OIDC dance (already covered by W2 nock tests). Tests call
signInAs(context, sessionUser) BEFORE page.goto; the cpa_session cookie
travels with subsequent navigations and the API + portal both accept it.

P1 W5 task 3 of 14."
```

---

## Task 4: Test data fixture (`apps/web/e2e/fixtures/test-data.ts`)

```ts
import { privilegedSql } from '@cpa/db/client';

export async function seedTenant(slug: string, name = `E2E ${slug}`): Promise<string> {
  const id = crypto.randomUUID();
  await privilegedSql`INSERT INTO tenant (id, name, slug, primary_idp)
                       VALUES (${id}, ${name}, ${slug}, 'mixed')`;
  return id;
}

export async function seedUser(email: string, displayName: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  await privilegedSql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
                       VALUES (${id}, ${email}, 'microsoft', ${'microsoft:' + email}, ${displayName})`;
  return id;
}

export async function seedMembership(
  tenantId: string,
  userId: string,
  role: 'admin' | 'consultant' | 'viewer',
  isDefault = false,
): Promise<string> {
  const id = crypto.randomUUID();
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (${id}, ${tenantId}, ${userId}, ${role}, ${isDefault})`;
  return id;
}

export async function cleanupBySlugPrefix(prefix: string): Promise<void> {
  await privilegedSql`DELETE FROM tenant_user
                       WHERE tenant_id IN (SELECT id FROM tenant WHERE slug LIKE ${prefix + '%'})`;
  await privilegedSql`DELETE FROM tenant WHERE slug LIKE ${prefix + '%'}`;
}

export async function cleanupByEmailPrefix(prefix: string): Promise<void> {
  await privilegedSql`DELETE FROM tenant_user
                       WHERE user_id IN (SELECT id FROM "user" WHERE email LIKE ${prefix + '%'})`;
  await privilegedSql`DELETE FROM "user" WHERE email LIKE ${prefix + '%'}`;
}
```

Commit:
```bash
git add apps/web/e2e/fixtures/test-data.ts
git commit -m "feat(web): e2e test-data fixture — seed/cleanup via privilegedSql

Helpers: seedTenant(slug, name?), seedUser(email, displayName?),
seedMembership(tenantId, userId, role, isDefault), and cleanup-by-prefix
companions. All via privilegedSql (RLS-bypassing cpa role) to keep
tests fast — they're not testing RLS, just browser flow.

Each spec uses unique prefixes (e2e-T5-, e2e-T9-, etc.) so concurrent
test runs don't collide.

P1 W5 task 4 of 14."
```

---

## Tasks 5–11: Spec files (parallel batch)

Each spec follows the pattern:

```ts
import { test, expect } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import { seedTenant, seedUser, seedMembership, cleanupBySlugPrefix, cleanupByEmailPrefix } from './fixtures/test-data';

test.describe('<Spec name>', () => {
  test.afterAll(async () => {
    await cleanupBySlugPrefix('e2e-<TASK>-');
    await cleanupByEmailPrefix('e2e-<TASK>-');
  });

  test('<assertion>', async ({ page, context }) => {
    // 1. Seed fixtures
    // 2. signInAs
    // 3. page.goto
    // 4. Assertions
  });
});
```

### Task 5: `login-redirect.spec.ts`

Anonymous user hitting / redirects to /login.

```ts
import { test, expect } from '@playwright/test';

test('anonymous user is redirected to /login from /', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL('**/login', { timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Continue with Microsoft/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Continue with Google/i })).toBeVisible();
});
```

Commit: `feat(web): e2e login-redirect — anon → /login. P1 W5 task 5 of 14.`

### Task 6: `dashboard.spec.ts`

Authenticated admin sees email + active firm name + role.

```ts
import { test, expect } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import { seedTenant, seedUser, seedMembership, cleanupBySlugPrefix, cleanupByEmailPrefix } from './fixtures/test-data';

test.describe('Dashboard', () => {
  test.afterAll(async () => {
    await cleanupBySlugPrefix('e2e-T6-');
    await cleanupByEmailPrefix('e2e-T6-');
  });

  test('admin sees own email + active firm name + role badge', async ({ page, context }) => {
    const tenantId = await seedTenant('e2e-T6-firm-alpha', 'E2E T6 Firm Alpha');
    const userId = await seedUser('e2e-T6-admin@example.com', 'T6 Admin');
    await seedMembership(tenantId, userId, 'admin', true);

    await signInAs(context, {
      id: userId,
      email: 'e2e-T6-admin@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: tenantId,
      activeRole: 'admin',
      availableTenants: [
        { tenantId, name: 'E2E T6 Firm Alpha', slug: 'e2e-T6-firm-alpha', role: 'admin' },
      ],
    });

    await page.goto('/');
    await expect(page.getByText('e2e-T6-admin@example.com')).toBeVisible();
    await expect(page.getByText('E2E T6 Firm Alpha')).toBeVisible();
    await expect(page.getByText(/admin/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /Manage firm members/i })).toBeVisible();
  });
});
```

Commit: `feat(web): e2e dashboard. P1 W5 task 6 of 14.`

### Task 7: `tenant-switch.spec.ts`

User with 2 firms switches active tenant via dropdown.

Pattern: seed 2 tenants + 1 user with admin in both. signInAs with tenant A as active. Click switcher → click tenant B → assert dashboard re-renders showing tenant B name.

(Implementer: write the spec following the pattern in T6, with prefix `e2e-T7-`.)

Commit: `feat(web): e2e tenant-switch. P1 W5 task 7 of 14.`

### Task 8: `users-admin-list.spec.ts`

Admin sees firm members table; consultant gets "Admin role required" empty state.

Two tests: (a) admin views /users and sees both members listed; (b) consultant views /users and sees the empty state.

Use prefix `e2e-T8-`.

Commit: `feat(web): e2e users-admin-list. P1 W5 task 8 of 14.`

### Task 9: `users-admin-add.spec.ts`

Admin opens /users/new, enters email, submits, success toast, navigates back to /users, new member visible.

Pattern: seed admin + a second user (so the email exists). Sign in as admin. Navigate to /users/new. Fill form. Submit. Wait for `/users`. Assert second user's row is in the table.

Use prefix `e2e-T9-`.

Commit: `feat(web): e2e users-admin-add. P1 W5 task 9 of 14.`

### Task 10: `users-admin-edit.spec.ts`

Admin edits another user's role; last-admin demote of self → 409 toast.

Two scenarios in one spec file:
1. Admin demotes consultant to viewer → success toast → users list shows new role.
2. Admin (only admin in firm) tries to demote self → 409 toast "Cannot demote the only firm admin".

Use prefix `e2e-T10-`.

Commit: `feat(web): e2e users-admin-edit. P1 W5 task 10 of 14.`

### Task 11: `users-admin-remove.spec.ts`

Admin removes a member via Dialog confirm; last-admin remove → 409 toast.

Two scenarios:
1. Admin removes consultant via Dialog → 204 → toast → user no longer in list.
2. Admin (only admin) tries to remove self → 409 toast "Cannot remove the only firm admin".

Use prefix `e2e-T11-`.

Commit: `feat(web): e2e users-admin-remove. P1 W5 task 11 of 14.`

---

## Task 12: CI workflow update

**File:** Modify `.github/workflows/ci.yml`

Add a new `e2e` job that depends on `build`. See design doc §"CI integration" for the full YAML. Key bits:

- `services: postgres:` with pgvector image, port 5433
- After install, apply init.sql + migrations
- `pnpm --filter @cpa/web exec playwright install chromium`
- `pnpm --filter @cpa/web exec playwright test`
- Env: `DATABASE_URL`, `DATABASE_URL_APP`, `SESSION_JWT_SECRET=ci-test-32-bytes-of-entropy-padd!`

Commit: `ci(web): add e2e job — Postgres service + Playwright chromium. P1 W5 task 12 of 14.`

---

## Task 13: Cold-start verify + push

```bash
cd /c/Users/Aaron/cpa-platform-worktrees/p1
pnpm install --frozen-lockfile
pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm format:check
pnpm --filter @cpa/web e2e        # all 8 tests pass locally
git push origin p1/identity-tenancy
```

Watch CI go green. If anything red, fix forward.

---

## Task 14: Tag + merge ceremony

After CI is green on the latest `p1/identity-tenancy` commit:

```bash
# 1. Tag
git tag -a p1-identity-tenancy -m "P1 Identity, Tenancy, RLS, Portal — full identity stack shipped

W1 Foundation + schemas + RLS
W2 OIDC + JWT + session middleware
W3 Tenant + user endpoints
W4 Consultant portal + onboard CLI
W5 Playwright e2e + tag

~110 tests across 6 packages. 6 user-facing endpoints.
1 consultant portal Next.js app. 1 platform-admin CLI.
Migrations 0000-0005. ADRs 0001 + 0002."

git push origin p1-identity-tenancy

# 2. Open PR via gh CLI
gh pr create \
  --title "P1: Identity, Tenancy, RLS, Portal" \
  --body "$(cat <<'EOF'
## Summary
P1 — full identity, tenancy, RLS, portal, and onboarding CLI stack.

- **W1** Foundation: monorepo + observability + Postgres + 6 schemas + RLS migrations 0001–0003
- **W2** Auth: cpa_app role + OIDC (Microsoft + Google) + JWT-cookie session middleware + WITH CHECK policies (migration 0004)
- **W3** Endpoints: GET/POST /v1/tenants/* + GET/POST/PATCH/DELETE /v1/users/* with admin-gating + last-admin guards (migration 0005)
- **W4** Portal: Next.js 15 + Tailwind + shadcn + react-query consultant portal with full admin UX, plus tools/scripts/onboard-tenant.ts
- **W5** E2E: 8 Playwright tests proving the browser flow end-to-end

Tagged: `p1-identity-tenancy`

## Test plan
- [x] All unit + integration suites pass: ~110 tests across 6 packages
- [x] All 8 Playwright e2e tests pass against the dev stack
- [x] Cold-start: pnpm install --frozen-lockfile && build && typecheck && lint && test && format:check + e2e all green
- [x] CI green on latest commit
EOF
)" \
  --base main \
  --head p1/identity-tenancy

# 3. Merge via GitHub UI with --no-ff to preserve W1–W5 history
# (Web UI: select "Create a merge commit", not squash/rebase)
```

After merge, optionally delete the local + remote branch:
```bash
git branch -d p1/identity-tenancy
git push origin --delete p1/identity-tenancy
```

The tag `p1-identity-tenancy` preserves history forever.

---

## W5 Acceptance criteria

- [x] T1–T2: Playwright + config in place
- [x] T3–T4: auth + test-data fixtures
- [x] T5–T11: 8 e2e specs, all pass locally
- [x] T12: CI workflow runs e2e job
- [x] T13: Full gates green from cold-start; pushed
- [x] T14: Tag pushed; PR open + merged

End-of-W5 stats:
- ~118 tests (W4's 107 + ~8 e2e + minor adjustments) across 6 packages + 1 e2e dir
- 1 release tag (`p1-identity-tenancy`)
- 1 merged PR
- `main` carries P1's full identity stack

---

## What W5 does NOT do (carried)

- Real Microsoft/Google OIDC e2e (P3+ when needed for staging validation)
- Mobile responsive layout (P2 UX)
- Visual regression / screenshot diff (P2+)
- Accessibility audit (P2+)
- Audit log + assurance report hash chain (P2 schema)

## Estimated time

- 1 focused session ~3 hours: install (15 min), config + 2 fixtures (30 min), 7 specs in parallel (60 min), CI workflow (15 min), cold-start + push (15 min), tag + merge ceremony (15 min). The fragile bits are Playwright's webServer race conditions and the auth fixture cookie-domain matching `localhost` exactly.
