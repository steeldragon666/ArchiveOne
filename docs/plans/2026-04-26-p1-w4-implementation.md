# P1 W4 — Consultant Portal + Onboarding CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task.

**Goal:** Ship the Next.js 15 consultant portal that exposes the full W3 admin surface (login, dashboard, tenant switcher, user CRUD) plus the `tools/scripts/onboard-tenant.ts` CLI that platform admins use to seed brand-new firms.

**Architecture:** New `apps/web/` workspace package — Next.js 15 + App Router, Tailwind 3.4 + shadcn/ui, `@tanstack/react-query` for all data fetching. Pure client of the Fastify API: redirects to `/v1/auth/<idp>/login` for auth, calls `/v1/whoami` + W3 endpoints for everything else. Same-origin via Next.js `rewrites` config in dev. CLI script uses Node's `parseArgs` stdlib + `privilegedSql` from `@cpa/db/client`.

**Tech Stack:** Next.js 15, React 19 (or 18 if 19 not stable), TypeScript 5.6, Tailwind 3.4, shadcn/ui (Radix-based), `@tanstack/react-query@^5`, `react-hook-form` + `@hookform/resolvers`, `lucide-react` (icons). No new deps for the API or schemas packages.

**Source design:** [P1 W4 design](./2026-04-26-p1-w4-consultant-portal-design.md), all 5 decisions locked.

**Branch:** Continue on `p1/identity-tenancy` at `626f0dc`. No new branch.

---

## Task graph

```
T1 (scaffold @cpa/web)             — solo (foundation)
T2 (Tailwind + shadcn init)         — solo (after T1)
T3 (react-query provider + api.ts)  — solo (after T2)
T4 (useWhoami + AuthGuard)          — solo (after T3)
T5 (/login page)                    — solo (after T4)
T6 (/ dashboard + tenant switcher)  — solo (after T5; uses T4)
T7 (/tenants list + switcher dup)   — solo (after T6, small)
T8 (/users admin list)              — solo (after T6)
T9 (/users/new add form)            — solo (after T8)
T10 (/users/[userId] edit + delete) — solo (after T8)
T11 (onboard-tenant CLI)            — solo, INDEPENDENT (can run any time)
T12 (cold-start + push)             — solo (after all)
```

12 tasks, mostly sequential due to layered dependencies (auth → react-query → pages). T11 (CLI) is independent and could run in parallel with any of T1-T10. T7 is very small once T6's switcher exists.

---

## Pre-flight

- [ ] Working in `cpa-platform-worktrees/p1` on `p1/identity-tenancy` at `626f0dc`+ later
- [ ] Postgres up; all 5 migrations applied
- [ ] Sequential test counts: api 41, auth 30, db 8, observability 5, schemas 11 (=95)
- [ ] `.env` has DATABASE_URL_APP set

---

## Task 1: Scaffold `apps/web/` Next.js workspace

**Why first:** Every other task adds files inside this package.

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx` (placeholder)
- Create: `apps/web/src/app/globals.css` (placeholder; populated in T2)
- Create: `apps/web/.eslintrc.cjs` or extend repo eslint config
- Create: `apps/web/next-env.d.ts` (auto-generated; commit)

**Step 1: Read sibling apps/api/package.json + observability/tsconfig for workspace conventions**

```bash
cat apps/api/package.json
cat packages/observability/tsconfig.json
cat tsconfig.base.json
```

**Step 2: Write `apps/web/package.json`**

```json
{
  "name": "@cpa/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "next build",
    "dev": "next dev --port 5173",
    "start": "next start --port 5173",
    "test": "cross-env LOG_LEVEL=silent tsx --env-file=../../.env --test --test-force-exit \"src/**/*.test.{ts,tsx}\"",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@cpa/schemas": "workspace:*",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "cross-env": "^7.0.3",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

If `react@19` is unstable, fall back to `react@18.3.1`. Try 19 first; document the fallback in the commit if needed.

**Step 3: Write `apps/web/tsconfig.json`**

Extends the base config. Next.js 15 + App Router needs specific lib + jsx settings:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "src/**/*", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next", "dist"]
}
```

**Step 4: Write `apps/web/next.config.ts`**

This is the critical config — proxies `/v1/*` to the Fastify API on `localhost:3000`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/v1/:path*',
        destination: 'http://localhost:3000/v1/:path*',
      },
    ];
  },
  // Strict React mode for dev correctness checks
  reactStrictMode: true,
};

export default nextConfig;
```

**Step 5: Minimal `src/app/layout.tsx`**

```tsx
import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'CPA Platform',
  description: 'Australian R&D Tax Incentive consultant portal',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

**Step 6: Placeholder `src/app/page.tsx`**

```tsx
export default function Home() {
  return (
    <main style={{ padding: 24 }}>
      <h1>CPA Platform — scaffolding</h1>
      <p>Replaced in T6 with the real dashboard.</p>
    </main>
  );
}
```

**Step 7: Empty `globals.css` (Tailwind directives land in T2)**

```css
/* W4 T1 placeholder. Tailwind base/components/utilities directives land in T2. */
```

**Step 8: Install + verify**

```bash
cd /c/Users/Aaron/cpa-platform-worktrees/p1
pnpm install
pnpm --filter @cpa/web typecheck   # exit 0
pnpm --filter @cpa/web build       # exit 0 — produces .next/
```

**Step 9: Add `apps/web` to root tsconfig references if needed**

Read `tsconfig.json` at root; if it has `references`, add `{ "path": "./apps/web" }`. If not, skip.

**Step 10: Commit**

```bash
git add apps/web/ pnpm-lock.yaml
git commit -m "feat(web): scaffold @cpa/web Next.js 15 workspace package

Empty Next.js App Router skeleton:
- next.config.ts: rewrites /v1/* to http://localhost:3000 (the Fastify
  API) so portal + API are same-origin in dev — session cookie travels
  with portal-originated /v1/* fetches.
- layout.tsx + page.tsx placeholder; replaced by real UI in T5+.
- tsconfig.json with paths alias '@/*' to src/*.

Subsequent tasks: T2 Tailwind+shadcn, T3 react-query+api.ts,
T4-T10 pages, T11 CLI, T12 cold-start.

P1 W4 task 1 of 12."
```

---

## Task 2: Tailwind 3.4 + shadcn/ui

**Files:**
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/components.json` (shadcn config)
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/src/lib/utils.ts` (shadcn `cn` helper)
- Modify: `apps/web/package.json` (deps)

**Step 1: Add Tailwind + autoprefixer + tailwindcss-animate**

```bash
pnpm --filter @cpa/web add -D tailwindcss@^3.4.0 autoprefixer postcss tailwindcss-animate
pnpm --filter @cpa/web add clsx tailwind-merge class-variance-authority lucide-react
```

**Step 2: Run shadcn init**

shadcn init writes `components.json`, updates `tailwind.config.ts`, and writes `globals.css` with the Radix-compatible CSS variables. Run interactively:

```bash
cd apps/web
pnpm dlx shadcn@latest init -d -y \
  --base-color slate \
  --css-variables \
  --tailwind-config tailwind.config.ts \
  --tailwind-css src/app/globals.css \
  --components @/components \
  --utils @/lib/utils
```

If that flag set isn't supported by the latest shadcn CLI, fall back to interactive:
```bash
pnpm dlx shadcn@latest init
```

Pick: TypeScript yes, base color slate, CSS variables yes, tailwind path tailwind.config.ts, components @/components, utils @/lib/utils.

**Step 3: Install initial shadcn components we'll need**

```bash
cd apps/web
pnpm dlx shadcn@latest add button input label dialog card table dropdown-menu toast form select
```

This adds files under `apps/web/src/components/ui/`. shadcn emits the actual component code (we own it).

**Step 4: Verify gates**

```bash
cd /c/Users/Aaron/cpa-platform-worktrees/p1
pnpm --filter @cpa/web typecheck   # exit 0
pnpm --filter @cpa/web build       # exit 0; .next/ rebuilt with Tailwind
pnpm --filter @cpa/web lint        # exit 0
```

If lint complains about generated shadcn files, add them to `.eslintignore` or the lint config's `ignorePatterns` — they're vendored.

**Step 5: Smoke-test the Tailwind setup**

Replace `src/app/page.tsx` placeholder:
```tsx
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">CPA Platform</h1>
        <Button>shadcn button works</Button>
      </div>
    </main>
  );
}
```

`pnpm --filter @cpa/web dev` and visit `http://localhost:5173`. The Button should be Radix-styled. Stop the dev server.

**Step 6: Commit**

```bash
git add apps/web/ pnpm-lock.yaml
git commit -m "feat(web): Tailwind 3.4 + shadcn/ui foundation

Adds Tailwind via shadcn init, slate base color, CSS variables.
Initial component set: Button, Input, Label, Dialog, Card, Table,
DropdownMenu, Toast, Form, Select. All vendored under
apps/web/src/components/ui/ (we own the code per shadcn's copy-paste
philosophy).

src/lib/utils.ts has the canonical cn() helper.
src/app/page.tsx smoke-tests with a styled Button (replaced in T6).

P1 W4 task 2 of 12."
```

---

## Task 3: `@tanstack/react-query` provider + typed `lib/api.ts`

**Files:**
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/api.test.ts`
- Create: `apps/web/src/lib/query-client.ts`
- Create: `apps/web/src/components/providers.tsx`
- Modify: `apps/web/src/app/layout.tsx` (wrap with providers)
- Modify: `apps/web/package.json` (deps)

**Step 1: Add @tanstack/react-query**

```bash
pnpm --filter @cpa/web add @tanstack/react-query @tanstack/react-query-devtools
```

**Step 2: Write `lib/api.ts` with TDD tests first**

Test file `apps/web/src/lib/api.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, ConflictError, ForbiddenError, NotFoundError, apiFetch } from './api.js';

const mockFetch = (status: number, body: unknown): typeof fetch => {
  return (async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
};

test('apiFetch: 200 returns parsed JSON', async () => {
  globalThis.fetch = mockFetch(200, { ok: true });
  const r = await apiFetch<{ ok: boolean }>('/v1/healthz');
  assert.deepEqual(r, { ok: true });
});

test('apiFetch: 401 throws ApiError with redirect flag', async () => {
  globalThis.fetch = mockFetch(401, { error: 'unauthenticated' });
  await assert.rejects(
    () => apiFetch('/v1/whoami'),
    (err: unknown) => err instanceof ApiError && (err as ApiError).status === 401,
  );
});

test('apiFetch: 403 throws ForbiddenError', async () => {
  globalThis.fetch = mockFetch(403, { error: 'forbidden' });
  await assert.rejects(() => apiFetch('/v1/users'), ForbiddenError);
});

test('apiFetch: 404 throws NotFoundError', async () => {
  globalThis.fetch = mockFetch(404, { error: 'user_not_found' });
  await assert.rejects(() => apiFetch('/v1/users/abc'), NotFoundError);
});

test('apiFetch: 409 throws ConflictError', async () => {
  globalThis.fetch = mockFetch(409, { error: 'last_admin' });
  await assert.rejects(() => apiFetch('/v1/users/abc', { method: 'DELETE' }), ConflictError);
});
```

**Step 3: Implement `apps/web/src/lib/api.ts`**

```ts
export class ApiError extends Error {
  constructor(public status: number, public errorCode: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
export class UnauthenticatedError extends ApiError {
  constructor(errorCode: string, message: string) {
    super(401, errorCode, message);
    this.name = 'UnauthenticatedError';
  }
}
export class ForbiddenError extends ApiError {
  constructor(errorCode: string, message: string) {
    super(403, errorCode, message);
    this.name = 'ForbiddenError';
  }
}
export class NotFoundError extends ApiError {
  constructor(errorCode: string, message: string) {
    super(404, errorCode, message);
    this.name = 'NotFoundError';
  }
}
export class ConflictError extends ApiError {
  constructor(errorCode: string, message: string) {
    super(409, errorCode, message);
    this.name = 'ConflictError';
  }
}

interface ApiErrorBody {
  error: string;
  message: string;
  requestId?: string;
}

/**
 * Typed fetch wrapper for the Fastify API.
 * - Always sends credentials so the cpa_session cookie travels along.
 * - On non-2xx, parses the error envelope and throws a typed error.
 * - On 401, signals the caller (typically a query hook) to redirect to /login.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  let body: ApiErrorBody = { error: 'unknown', message: `HTTP ${res.status}` };
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // non-JSON error body; keep defaults
  }

  switch (res.status) {
    case 401:
      throw new UnauthenticatedError(body.error, body.message);
    case 403:
      throw new ForbiddenError(body.error, body.message);
    case 404:
      throw new NotFoundError(body.error, body.message);
    case 409:
      throw new ConflictError(body.error, body.message);
    default:
      throw new ApiError(res.status, body.error, body.message);
  }
}
```

**Step 4: Run test, expect 5/5 pass**

```bash
pnpm --filter @cpa/web test
```

**Step 5: Write `apps/web/src/lib/query-client.ts`**

```ts
'use client';
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,             // 1 min — typical B2B admin tool
      retry: (failureCount, error: unknown) => {
        // Don't retry on auth errors — caller handles redirect
        if (error instanceof Error && /401|403|404|409/.test(error.message)) return false;
        return failureCount < 3;
      },
      refetchOnWindowFocus: false,
    },
  },
});
```

**Step 6: Write `apps/web/src/components/providers.tsx`**

```tsx
'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from '@/lib/query-client';
import { Toaster } from '@/components/ui/toaster';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
      {process.env.NODE_ENV !== 'production' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
```

**Step 7: Wrap layout.tsx with Providers**

```tsx
import './globals.css';
import { Providers } from '@/components/providers';
// ...
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

**Step 8: Verify gates + commit**

---

## Task 4: `useWhoami` hook + `AuthGuard` component

**Files:**
- Create: `apps/web/src/hooks/use-whoami.ts`
- Create: `apps/web/src/components/auth-guard.tsx`

**Step 1: useWhoami**

```ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface WhoamiResponse {
  user: {
    id: string;
    email: string;
    tenantId: string | null;
    role: 'admin' | 'consultant' | 'viewer' | null;
  };
  availableTenants: Array<{
    tenantId: string;
    name: string;
    slug: string;
    role: 'admin' | 'consultant' | 'viewer';
    isDefault: boolean;
  }>;
}

export function useWhoami() {
  return useQuery({
    queryKey: ['whoami'],
    queryFn: () => apiFetch<WhoamiResponse>('/v1/whoami'),
  });
}
```

**Step 2: AuthGuard**

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useWhoami } from '@/hooks/use-whoami';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error } = useWhoami();
  const router = useRouter();

  useEffect(() => {
    if (error && error.message.includes('401')) router.push('/login');
  }, [error, router]);

  if (isLoading) return <div className="p-8">Loading…</div>;
  if (error) return <div className="p-8">Authentication error. Redirecting…</div>;
  if (!data) return null;

  return <>{children}</>;
}
```

**Step 3: Commit**

---

## Task 5: `/login` page

**Files:**
- Create: `apps/web/src/app/login/page.tsx`

**Implementation:**

```tsx
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in to CPA Platform</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild className="w-full" variant="default">
            <a href="/v1/auth/microsoft/login">Continue with Microsoft</a>
          </Button>
          <Button asChild className="w-full" variant="outline">
            <a href="/v1/auth/google/login">Continue with Google</a>
          </Button>
          <p className="text-sm text-slate-500 text-center pt-2">
            Your firm administrator must add you to a firm before you can log in.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

These are plain `<a>` tags, NOT `next/link` — we want a full browser navigation to the API endpoint. `next/link` would do client-side routing.

Commit.

---

## Task 6: `/` dashboard + tenant switcher

**Files:**
- Create: `apps/web/src/app/page.tsx` (replace placeholder)
- Create: `apps/web/src/components/tenant-switcher.tsx`
- Create: `apps/web/src/hooks/use-switch-tenant.ts`

**tenant-switcher.tsx:** dropdown listing `availableTenants`, click to call mutation.

**use-switch-tenant.ts:**
```ts
'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export function useSwitchTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) =>
      apiFetch('/v1/tenants/switch', { method: 'POST', body: JSON.stringify({ tenantId }) }),
    onSuccess: () => {
      void qc.invalidateQueries(); // refresh everything
    },
  });
}
```

**page.tsx:**

```tsx
'use client';
import { AuthGuard } from '@/components/auth-guard';
import { TenantSwitcher } from '@/components/tenant-switcher';
import { useWhoami } from '@/hooks/use-whoami';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function Dashboard() {
  return (
    <AuthGuard>
      <DashboardInner />
    </AuthGuard>
  );
}

function DashboardInner() {
  const { data } = useWhoami();
  if (!data) return null;

  const activeTenant = data.availableTenants.find((t) => t.tenantId === data.user.tenantId);

  return (
    <main className="container mx-auto py-8 px-4">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">CPA Platform</h1>
        <div className="flex gap-3 items-center">
          <TenantSwitcher
            tenants={data.availableTenants}
            activeTenantId={data.user.tenantId}
          />
          <SignoutButton />
        </div>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold mb-2">Welcome, {data.user.email}</h2>
          {activeTenant ? (
            <p className="text-slate-600">
              Active firm: <strong>{activeTenant.name}</strong> · Role: {activeTenant.role}
            </p>
          ) : (
            <p className="text-slate-600">No active firm — contact your firm admin.</p>
          )}
        </div>

        {data.user.role === 'admin' && (
          <div>
            <h2 className="text-lg font-semibold mb-2">Admin actions</h2>
            <Button asChild variant="outline"><Link href="/users">Manage users</Link></Button>
          </div>
        )}
      </section>
    </main>
  );
}

function SignoutButton() {
  // POST /v1/auth/signout then full reload to /login
  return (
    <form action="/v1/auth/signout" method="POST" onSubmit={(e) => {
      e.preventDefault();
      void fetch('/v1/auth/signout', { method: 'POST', credentials: 'include' })
        .then(() => { window.location.href = '/login'; });
    }}>
      <Button type="submit" variant="ghost">Sign out</Button>
    </form>
  );
}
```

The TenantSwitcher component lives in `components/tenant-switcher.tsx` — uses shadcn DropdownMenu. Click an item → `useSwitchTenant.mutate(tenantId)` → on success, `qc.invalidateQueries()` refreshes the dashboard.

Commit.

---

## Task 7: `/tenants` page

Same component but full-page version of the switcher. Renders a table/list of all `availableTenants` with a "Switch to this firm" button per row. ~50 lines. Commit.

---

## Task 8: `/users` admin list

**Files:**
- Create: `apps/web/src/app/users/page.tsx`
- Create: `apps/web/src/hooks/use-users.ts`
- Create: `apps/web/src/components/users-table.tsx`

**use-users.ts:**
```ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface UserRef {
  id: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'consultant' | 'viewer';
  isDefault: boolean;
  addedAt: string;
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: UserRef[] }>('/v1/users'),
    select: (d) => d.users,
  });
}
```

**users-table.tsx:** uses shadcn `Table` to render the list. Columns: email, displayName, role (badge), isDefault, addedAt, actions (Edit + Delete buttons that navigate to `/users/[userId]`).

**page.tsx:**

```tsx
'use client';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { useWhoami } from '@/hooks/use-whoami';
import { useUsers } from '@/hooks/use-users';
import { UsersTable } from '@/components/users-table';
import { Button } from '@/components/ui/button';

export default function UsersPage() {
  return (
    <AuthGuard>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const whoami = useWhoami();
  const users = useUsers();

  if (whoami.data?.user.role !== 'admin') {
    return <main className="p-8">Admin role required.</main>;
  }
  if (users.isLoading) return <main className="p-8">Loading…</main>;
  if (users.error) return <main className="p-8">Error loading users.</main>;

  return (
    <main className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Firm members</h1>
        <Button asChild><Link href="/users/new">Add user</Link></Button>
      </div>
      <UsersTable users={users.data ?? []} />
    </main>
  );
}
```

Commit.

---

## Task 9: `/users/new` add form

**Files:**
- Create: `apps/web/src/app/users/new/page.tsx`
- Create: `apps/web/src/hooks/use-add-user.ts`
- Create: `apps/web/src/components/add-user-form.tsx`

Form: email + role (select) + isDefault (checkbox). On submit, `useAddUser.mutate({email, role, isDefault})` → on success toast + invalidate users query + navigate back to `/users`. On 404 user_not_found: toast "Ask them to sign in once first". On 409: toast "Already a member".

react-hook-form + zod schema mirroring the API's expected body.

Commit.

---

## Task 10: `/users/[userId]` edit + delete

**Files:**
- Create: `apps/web/src/app/users/[userId]/page.tsx`
- Create: `apps/web/src/hooks/use-update-user.ts`
- Create: `apps/web/src/hooks/use-remove-user.ts`
- Create: `apps/web/src/components/edit-user-form.tsx`

**Behavior:**
- GET `/v1/users/:userId` for current state
- PATCH /v1/users/:userId on form submit
- DELETE /v1/users/:userId via "Remove from firm" button (with confirmation Dialog)
- Last-admin 409 surfaces as a clear toast

Commit.

---

## Task 11: `tools/scripts/onboard-tenant.ts` CLI

**Files:**
- Create: `tools/scripts/onboard-tenant.ts`
- Create: `tools/scripts/onboard-tenant.test.ts`

**Step 1: Write the test FIRST**

Tests run via `tsx --test tools/scripts/onboard-tenant.test.ts`. Test scenarios:
1. Happy path: existing user + valid args → tenant created + tenant_user inserted with admin role
2. User-not-found: --admin-email matches no user → exits 1 with clear message
3. Slug collision: tenant with slug already exists → exits 1
4. Already-member: user is already in this tenant → exits 1 with hint

Use a fresh test tenant prefix like `test-cli-xxx` and clean up in `after()`.

**Step 2: Implement the CLI**

```ts
#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
import { privilegedSql } from '@cpa/db/client';

interface Args {
  name: string;
  slug: string;
  adminEmail: string;
  primaryIdp: 'microsoft' | 'google' | 'mixed';
}

function parseArgsOrExit(): Args {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      slug: { type: 'string' },
      'admin-email': { type: 'string' },
      'primary-idp': { type: 'string', default: 'mixed' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.log(`Usage:
  pnpm tsx tools/scripts/onboard-tenant.ts \\
    --name "Firm Foo" \\
    --slug firm-foo \\
    --admin-email alice@firmfoo.com \\
    [--primary-idp microsoft|google|mixed]
`);
    process.exit(0);
  }

  const errors: string[] = [];
  if (!values.name) errors.push('--name is required');
  if (!values.slug || !/^[a-z0-9-]{2,64}$/.test(values.slug)) {
    errors.push('--slug is required (lowercase, digits, hyphens; 2-64 chars)');
  }
  if (!values['admin-email'] || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values['admin-email'] as string)) {
    errors.push('--admin-email is required (valid email)');
  }
  const idp = values['primary-idp'] ?? 'mixed';
  if (!['microsoft', 'google', 'mixed'].includes(idp as string)) {
    errors.push("--primary-idp must be 'microsoft', 'google', or 'mixed'");
  }

  if (errors.length) {
    console.error('Validation errors:');
    errors.forEach((e) => console.error('  - ' + e));
    process.exit(1);
  }

  return {
    name: values.name as string,
    slug: values.slug as string,
    adminEmail: values['admin-email'] as string,
    primaryIdp: idp as 'microsoft' | 'google' | 'mixed',
  };
}

async function main() {
  const args = parseArgsOrExit();

  // 1. Look up admin user by email
  const userRows = await privilegedSql<{ id: string }[]>`
    SELECT id FROM "user" WHERE email = ${args.adminEmail} AND deleted_at IS NULL
  `;
  if (!userRows[0]) {
    console.error(`User '${args.adminEmail}' not found.`);
    console.error('Ask them to sign in once via Microsoft or Google, then re-run this command.');
    await privilegedSql.end();
    process.exit(1);
  }
  const userId = userRows[0].id;

  // 2. Create tenant
  const tenantId = crypto.randomUUID();
  try {
    await privilegedSql`
      INSERT INTO tenant (id, name, slug, primary_idp)
      VALUES (${tenantId}, ${args.name}, ${args.slug}, ${args.primaryIdp})
    `;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      console.error(`Tenant slug '${args.slug}' already exists.`);
      await privilegedSql.end();
      process.exit(1);
    }
    throw err;
  }

  // 3. Add admin tenant_user row
  const tenantUserId = crypto.randomUUID();
  try {
    await privilegedSql`
      INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
      VALUES (${tenantUserId}, ${tenantId}, ${userId}, 'admin', true)
    `;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      console.error(`User '${args.adminEmail}' is already a member of this tenant.`);
      // Roll back the tenant create
      await privilegedSql`DELETE FROM tenant WHERE id = ${tenantId}`;
      await privilegedSql.end();
      process.exit(1);
    }
    throw err;
  }

  // 4. Print summary
  console.log('Tenant created:');
  console.log('  tenant_id:    ' + tenantId);
  console.log('  name:         ' + args.name);
  console.log('  slug:         ' + args.slug);
  console.log('  primary_idp:  ' + args.primaryIdp);
  console.log('Admin assigned:');
  console.log('  user_id:      ' + userId);
  console.log('  email:        ' + args.adminEmail);

  await privilegedSql.end();
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(2);
});
```

Verify gates + commit.

---

## Task 12: Cold-start verification + push

```bash
cd /c/Users/Aaron/cpa-platform-worktrees/p1
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test       # ~107 tests across 6 packages
pnpm format:check
git push origin p1/identity-tenancy
```

Watch CI. If green, W4 done.

---

## W4 Acceptance criteria

- [x] T1-T4: @cpa/web scaffolded; Tailwind+shadcn; react-query+api.ts; AuthGuard
- [x] T5-T7: /login, /, /tenants pages
- [x] T8-T10: /users admin surface (list, new, edit/delete)
- [x] T11: tools/scripts/onboard-tenant.ts CLI with help + 4 validation paths
- [x] T12: cold-start green; pushed; CI green

End of W4 stats:
- 6 packages (added @cpa/web)
- ~107 tests across the workspace
- 1 onboarding CLI
- Browser-loadable consultant portal at `localhost:5173`

---

## What W4 does NOT do (carried)

- Real browser end-to-end test (W5 with Playwright)
- Production deployment config (P2)
- Email-based invitations (P3+)
- Audit log UI (P2+)
- Tenant CRUD in portal (P2 admin UI)
- User profile self-edit (P2+)
- Notifications (P2+)

## Estimated time

- 1 focused session (4-6 hours) — Next.js scaffolding + 6 pages + CLI
- T2 (shadcn init) is the "tutorial-style" task; T8-T10 (users admin) is most code-heavy
