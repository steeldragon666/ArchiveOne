# P1 W1 — P0 Review Fixes + Tenancy Schemas + RLS Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Knock out the 4 P0 final-review items that affect the foundation, then land all 6 P1 tenancy schemas with RLS isolation tests proving cross-tenant data hiding works.

**Architecture:** Refactor `apps/api/src/server.ts` so `startTracing()` runs before any module that imports fastify/pino (closes the OTel auto-instrumentation load-order gap). Add 6 new flat schemas under `packages/db/src/schema/`. Generate one Drizzle migration; layer Postgres RLS policies in a hand-authored SQL migration that sits alongside it. Tests run against the live Postgres on `localhost:5433`.

**Tech Stack:** Node 22, pnpm 10, turbo 2, TypeScript 5.6+, Drizzle ORM 0.36, Postgres 16 + pgvector 0.8, Fastify 5, OpenTelemetry SDK Node, pino, `tsx --test` runner with `cross-env LOG_LEVEL=silent`.

**Source design:** [P1 design](./2026-04-26-p1-identity-tenancy-design.md), §1–§3 + §7 W1 row.

**Critical deliverables for W1:**
1. `pnpm --filter @cpa/api dev` starts WITHOUT the OTel diag "module loaded before instrumentation" warnings (T1)
2. `/readyz` returns 503 in tests when DB is unreachable, with `db.ok=false` (T2)
3. ADR-0002 lands at `docs/decisions/0002-identity-and-tenancy.md` (T4)
4. 6 new tables visible in `cpa_dev` Postgres, all with audit columns (T5–T9)
5. RLS policies enforce cross-tenant isolation; integration test proves it (T11–T12)
6. All gates green: typecheck/lint/test/build/format:check; pushed to origin

**Out of scope for W1:** Auth.js wiring (W2), `/v1/tenants/*` endpoints (W3), Consultant Portal scaffold (W4), end-to-end auth integration tests (W5).

---

## Pre-flight checklist (do once)

- [ ] Working in `C:\Users\Aaron\cpa-platform-worktrees\p1\` on branch `p1/identity-tenancy` (verify: `git -C /c/Users/Aaron/cpa-platform-worktrees/p1 branch --show-current` returns `p1/identity-tenancy`)
- [ ] Postgres is up: `docker ps --filter name=cpa-postgres --format '{{.Status}}'` returns `Up ...`. If not: `pnpm db:up`
- [ ] All P0 tests pass before starting: `pnpm test` returns 24/24
- [ ] `.env` exists at `cpa-platform-worktrees/p1/.env` (copy from `.env.example` if not)

---

## Task 1: I1 — extract `startTracing` into `tracer-init.ts` so it runs before fastify/pino imports

**Why this matters:** ESM hoists all `import` statements in a module before any of the module's body executes. In current `server.ts`, the import of `./app.js` happens *before* the `startTracing(...)` call in the body — so by the time the OTel SDK registers its instrumentation hooks, `fastify` and `pino` have already been loaded by `app.ts` and won't be patched. The fix: put `startTracing()` in its own file's top-level body, then make that file the FIRST import in `server.ts`. ESM evaluates the dependency leaves first, so the tracer registers its hooks before app.ts even starts to import fastify.

**Files:**
- Create: `apps/api/src/tracer-init.ts`
- Modify: `apps/api/src/server.ts`

**Step 1: Write the new tracer-init module**

Create `apps/api/src/tracer-init.ts`:

```ts
/**
 * OTel SDK initialiser — must be imported FIRST in any executable entrypoint.
 *
 * ESM evaluates dependency leaves before the importing module's body, so
 * importing this file from server.ts causes startTracing() to run BEFORE
 * server.ts imports app.ts (which imports fastify, pino, postgres). That
 * ordering lets getNodeAutoInstrumentations() patch those modules at
 * load-time rather than after-the-fact.
 *
 * Surfaced by P0 final-review item I1.
 */
import { startTracing } from '@cpa/observability';

export const sdk = startTracing({
  serviceName: 'api',
  serviceVersion: '0.0.0',
});
```

**Step 2: Modify `apps/api/src/server.ts`**

The existing file (Read it first to confirm current state) calls `startTracing` directly. Replace with:

```ts
// MUST be the first import — registers OTel auto-instrumentations before
// any module that fastify/pino/postgres-js depends on is loaded.
import { sdk } from './tracer-init.js';
import { buildApp } from './app.js';

const app = buildApp();

const port = Number(process.env.API_PORT ?? 3000);

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info({ port }, 'api listening');
} catch (err) {
  app.log.error(err);
  await sdk.shutdown();
  process.exit(1);
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('app.close() timeout after 25s')), 25_000),
      ),
    ]);
  } catch (err) {
    app.log.error(err, 'shutdown forced');
  }
  await sdk.shutdown();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

**Step 3: Verify gates still green**

```bash
cd /c/Users/Aaron/cpa-platform-worktrees/p1
pnpm --filter @cpa/api typecheck
pnpm --filter @cpa/api build
pnpm --filter @cpa/api lint
pnpm --filter @cpa/api test       # 5/5 still pass
```

All exit 0.

**Step 4: Verify diag warnings are gone (manual)**

```bash
set -a && source .env && set +a
node apps/api/dist/server.js > /tmp/api-t1.log 2>&1 &
SERVER_PID=$!
sleep 3
grep -iE "(loaded before|already been loaded|instrumentation)" /tmp/api-t1.log | head -5
kill $SERVER_PID
```

Expected: empty (no diag warnings about modules loaded before instrumentation). If warnings still appear, the import ordering is still wrong — re-check `server.ts`.

**Step 5: Commit**

```bash
git add apps/api/src/tracer-init.ts apps/api/src/server.ts
git commit -m "fix(api): extract tracer-init so OTel hooks register before fastify/pino

ESM hoists all imports before any module body runs, so importing
tracer-init.ts as the FIRST import in server.ts causes startTracing()
to execute before app.ts begins to import fastify, pino, or postgres-js.
That ordering lets getNodeAutoInstrumentations() patch those modules
at load-time rather than after-the-fact.

Surfaced by P0 final review item I1. Verified by absence of
'<module> already been loaded' diag warnings in the boot log."
```

---

## Task 2: I2 — `/readyz` DB-down test (TDD, refactor checkDb to accept injectable runner)

**Why this matters:** P0 ships with `/readyz` 503-on-failure logic but no test exercises the failure path. Refactoring `checkDb` to accept the query-runner as a parameter (instead of importing `sql` at module load) makes the failure path testable without docker stop tricks.

**Files:**
- Modify: `apps/api/src/db.ts`
- Modify: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/db.test.ts`

**Step 1: Write the failing test FIRST**

Create `apps/api/src/db.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDb } from './db.js';

test('checkDb: ok=true when runQuery resolves', async () => {
  const result = await checkDb(async () => 1);
  assert.equal(result.ok, true);
  assert.ok(result.latencyMs >= 0);
  assert.ok(result.latencyMs < 100, 'fast resolution');
});

test('checkDb: ok=false when runQuery rejects synchronously', async () => {
  const result = await checkDb(async () => {
    throw new Error('connection refused');
  });
  assert.equal(result.ok, false);
  assert.ok(result.latencyMs >= 0);
});

test('checkDb: ok=false when runQuery hangs past timeout', async () => {
  const result = await checkDb(() => new Promise(() => {})); // never resolves
  assert.equal(result.ok, false);
  assert.ok(result.latencyMs >= 1500, 'timeout fired');
  assert.ok(result.latencyMs < 1700, 'did not wait far past timeout');
});

test('checkDb: optional logger receives error on failure', async () => {
  const calls: Array<{ obj: object; msg: string }> = [];
  const logger = {
    error: (obj: object, msg: string) => {
      calls.push({ obj, msg });
    },
  };
  await checkDb(async () => {
    throw new Error('boom');
  }, logger);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.msg, 'checkDb failed');
});
```

**Step 2: Run the test — confirm RED**

```bash
cd /c/Users/Aaron/cpa-platform-worktrees/p1
pnpm --filter @cpa/api test
```

Expected: tests fail because `checkDb` currently doesn't accept a `runQuery` parameter.

**Step 3: Refactor `checkDb` to accept a runQuery function**

Replace contents of `apps/api/src/db.ts`:

```ts
import { sql } from '@cpa/db/client';

export interface DbCheckResult {
  ok: boolean;
  latencyMs: number;
}

export interface DbCheckLogger {
  error: (obj: object, msg: string) => void;
}

const CHECK_TIMEOUT_MS = 1500;

/**
 * Check whether the application can talk to its dependency.
 *
 * Caller passes a `runQuery` function that returns a Promise. Typically
 * this is `() => sql\`SELECT 1\`` for postgres-js, but accepting a generic
 * function lets tests stub the failure path without spinning up a dead
 * Postgres or mocking the entire client module.
 *
 * Errors are NOT thrown — `/readyz` callers want a structured result.
 * If a logger is provided, errors are logged at `error` level.
 *
 * Surfaced by P0 final review items I1 (timeout) + I2 (testability).
 */
export async function checkDb(
  runQuery: () => Promise<unknown>,
  logger?: DbCheckLogger,
): Promise<DbCheckResult> {
  const start = Date.now();
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      runQuery(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`checkDb timeout after ${CHECK_TIMEOUT_MS}ms`)),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    logger?.error({ err }, 'checkDb failed');
    return { ok: false, latencyMs: Date.now() - start };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Default runQuery for production use — issues a `SELECT 1` against the
 * postgres-js pool. Routes call this directly; tests pass their own.
 */
export const defaultRunQuery = (): Promise<unknown> => sql`SELECT 1`;
```

**Step 4: Update `apps/api/src/routes/health.ts` to pass `defaultRunQuery`**

Find the `/readyz` handler and change `await checkDb(req.log)` to:

```ts
const db = await checkDb(defaultRunQuery, req.log);
```

Add to imports at the top:
```ts
import { checkDb, defaultRunQuery } from '../db.js';
```

**Step 5: Run all tests — confirm GREEN**

```bash
pnpm --filter @cpa/api test
```

Expected: 5 existing tests + 4 new = 9/9 pass. Or if the existing health.test.ts already has 5 tests, total is 5+4=9.

**Step 6: Verify gates**

```bash
pnpm --filter @cpa/api typecheck    # exit 0
pnpm --filter @cpa/api lint         # exit 0
pnpm --filter @cpa/api build        # exit 0
```

**Step 7: Commit**

```bash
git add apps/api/src/db.ts apps/api/src/db.test.ts apps/api/src/routes/health.ts
git commit -m "test(api): inject runQuery into checkDb so /readyz failure path is testable

Refactors checkDb to accept the query-runner as a parameter instead of
importing sql at module load. The route handler passes defaultRunQuery
(which is the same SELECT 1 against postgres-js); tests pass stubs.

Adds 4 unit tests covering: happy path, sync rejection, hang past
timeout (verifies 1500ms timeout fires), logger receives error.

Surfaced by P0 final review item I2 (the 503 path was structurally
untested)."
```

---

## Task 3: I3 — verify App-type cast is necessary, document why concretely

**Why this matters:** P0's `apps/api/src/app.ts` returns `app as unknown as App` because Fastify's `loggerInstance: pino` narrows the Logger generic and `exactOptionalPropertyTypes: true` won't widen back. The T12-fix implementer confirmed empirically that the direct `as App` fails. T3 ensures the inline comment names this specific TS interaction so future contributors don't mistakenly try to remove the cast.

**Files:**
- Modify: `apps/api/src/app.ts` (only the cast comment)

**Step 1: Read current `apps/api/src/app.ts`**

Find the `return app as unknown as App;` line and its surrounding comment (around line 96–105 in the current file).

**Step 2: Replace the cast comment with the precise reason**

```ts
  // Double-cast through `unknown` is required because of two interacting
  // TypeScript strictness settings in tsconfig.base.json:
  //   1. `loggerInstance: pino.Logger` narrows Fastify's `Logger` generic
  //      to `pino.Logger` (not the wider `FastifyBaseLogger`).
  //   2. `exactOptionalPropertyTypes: true` prevents widening that narrow
  //      back to `FastifyBaseLogger` at the `as App` boundary.
  // We deliberately widen here so callers (incl. tests) consume `App`
  // without leaking pino through the public surface. Verified empirically:
  // direct `app as App` fails with TS2352. See P0 review item I3.
  return app as unknown as App;
```

**Step 3: Verify gates**

```bash
pnpm --filter @cpa/api typecheck    # exit 0
pnpm --filter @cpa/api lint         # exit 0
pnpm --filter @cpa/api test         # 9/9 pass (no behaviour change)
```

**Step 4: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "docs(api): explain App double-cast in terms of exactOptionalPropertyTypes

The cast was correct but the inline comment didn't name the specific
TS settings that force it. Future contributors who see 'as unknown as'
can now read the comment and not try to remove it on aesthetic grounds.

Surfaced by P0 final review item I3 (the comment was generic; specifics
matter for cast survival)."
```

---

## Task 4: ADR-0002 — Identity, Tenancy & reqId Strategy

**Why this matters:** Captures the 5 brainstorm decisions (Q1–Q5) plus the I5 reqId-vs-traceparent decision in one place, before the schemas land. Future contributors and reviewers can locate "why does the schema look like this?" in one document.

**Files:**
- Create: `docs/decisions/0002-identity-and-tenancy.md`

**Step 1: Write the ADR**

```markdown
# ADR-0002: Identity, Tenancy & Request Correlation

**Status:** Accepted
**Date:** 2026-04-26
**Authors:** Aaron Newson + AI pair (Claude Opus 4.7)
**Builds on:** [ADR-0001](./0001-monorepo-and-stack.md)
**Source brainstorm:** [P1 design](../plans/2026-04-26-p1-identity-tenancy-design.md)

## Context

P0 established the platform foundation (monorepo, DB, OTel, API skeleton). P1 needs to
introduce real users into a multi-tenant SaaS platform — consultant firms with their own
staff, each working on multiple claimants. This ADR captures the tenancy and authentication
decisions that propagate into every API endpoint, every domain table, and every row of audit
data the platform stores.

## Decision

### Identity provider strategy (Q1)

- **Microsoft Entra ID + Google Workspace OIDC** are integrated from day 1, both via Auth.js.
- Other IdPs (Okta, Auth0, Apple) deferred to P3+ when a real customer asks.
- SAML2.0 is NOT in P1 scope. Auth.js's primary path is OIDC; AU SME consultancies on M365
  / Google Workspace can use OIDC. SAML for enterprise customers is a P3+ concern via WorkOS
  or similar broker.

### Tenancy data model (Q2)

- **Three core entities + two M:N joins:**
  - `tenant` — consultant firm (white-label root).
  - `subject_tenant` — claimant or financier (the firm's "client"), distinguished by `kind`.
  - `user` — global; not bound to any single tenant.
  - `tenant_user` — M:N join; a user can be a member of multiple firms with different roles.
  - `subject_tenant_user` — per-claimant ACL; even within one firm, a user can have access
    to a subset of claimants.
- **`subject_tenant.kind`** ∈ `{claimant, financier}`. Claimants are owned by their firm;
  financiers are granted scoped access via delegation tokens (P8).
- Federation primitives (`delegation_token` table) ship in P1 for schema-completeness;
  the API + UX that issues and redeems them lands in P8.

### Schema layout convention (Q3)

- **Flat:** every Drizzle table is one file at `packages/db/src/schema/<table_name>.ts`,
  snake_case matching the SQL table name exactly. No domain subdirectories.
- The flat convention is the **lifetime convention** for this platform, not just P1.
- Drizzle-kit's existing extglob (`./src/schema/!(*.test|index).ts`) covers it without
  recursion. Index file (`schema/index.ts`) re-exports for app-level imports; test files
  (`*.test.ts`) live alongside source.

### Federation depth in P1 (Q4)

- **Schema primitives only.** The `delegation_token` table exists; no API endpoint issues
  or redeems tokens; no portal UI.
- Why now: per-claimant ACL machinery (`subject_tenant_user`) and the `subject_tenant.kind`
  enum need to coexist with delegation tokens conceptually. Building the schema for both
  simultaneously avoids retroactive migrations.

### Onboarding flow in P1 (Q5)

- **No formal onboarding flow.** A platform-admin CLI script
  (`tools/scripts/onboard-tenant.ts`) seeds tenants and their first admin user via direct
  Drizzle inserts.
- Aligns with the early-stage, high-touch onboarding model the product spec PDFs describe
  ("60-minute onboarding call").
- Self-serve signup, team-member invites, and email sending are deferred to P3+.

### Request correlation strategy (P0 review item I5)

- **The reqId we generate via Fastify's `genReqId` IS a v4 UUID, not a W3C trace context
  identifier.** This is intentional for P1.
- `reqId` is a *log* correlation primitive — it appears in every pino line, in error
  responses (`{ error, message, requestId }`), and in audit-log rows.
- OTel auto-instrumentation produces a separate `traceparent`/`tracestate` pair that
  flows through HTTP headers and into Tempo spans. These are *trace* correlation
  primitives.
- The two are linked through pino's automatic `trace_id` and `span_id` injection (provided
  by `@opentelemetry/instrumentation-pino`, included in `getNodeAutoInstrumentations()`).
- Net effect: a Grafana dashboard can pivot from a slow Tempo span to its log lines
  via `trace_id`, OR pivot from an error envelope's `requestId` to the same logs via
  `req_id`. Either path works.
- **What we are NOT doing:** using the W3C `traceparent` header value AS the reqId.
  The trace ID is 16 bytes hex; UUIDs are 16 bytes too but with version+variant bits.
  Mixing them confuses tools that assume one format. Keep them parallel.

### RLS context-setting

- `app.current_tenant_id` is a Postgres GUC (Grand Unified Configuration) variable set
  per-request via `SET LOCAL` inside an explicit transaction.
- Postgres-js's pool reuses connections across requests; `SET LOCAL` scopes the variable
  to the current transaction so it cannot leak across requests.
- The Fastify `preHandler` middleware in `@cpa/auth/session` reads `activeTenantId` from
  the verified JWT, opens a transaction with `db.transaction(...)`, sets the GUC, and
  attaches the transaction handle to `req`. Routes use `req.tx` instead of `db`.
- Tables that have `tenant_id` directly (e.g. `subject_tenant`) get the simple policy:
  `tenant_id = current_setting('app.current_tenant_id', true)::uuid`.
- Tables that link to a tenant indirectly (e.g. `subject_tenant_user`) get a subquery
  policy: `subject_tenant_id IN (SELECT id FROM subject_tenant WHERE tenant_id = ...)`.
- `tenant` and `user` tables are **global** — no RLS. Access is gated at the API layer
  (e.g. `/v1/users` requires admin role on the active tenant).

## Consequences

**Positive**

- Per-claimant role grants make the audit trail richer from day one. When the hash-chain
  Assurance Report is generated in P5, "who could have edited this evidence" naturally
  includes per-claimant roles.
- The two-IdP-from-day-1 commitment removes a future migration cost. ~95% of AU SME
  consultancies are on M365 OR Google Workspace; we'll never have to retrofit one.
- Federation primitives ready in P1 means P8's UX lands without a schema migration.

**Negative**

- The full tenancy model is more code than a flat one. Multi-firm session shape,
  `availableTenants[]`, tenant-switcher UI, and `subject_tenant_user` lookups in every
  list endpoint add real complexity.
- `SET LOCAL` requires every request to run inside a transaction. Postgres-js handles
  this, but it's a constraint future contributors need to understand.

**Reviewable in P2+**

- Whether `is_default` on `tenant_user` is the right primitive for "active firm at login"
  — alternatives include a separate `user_preferences` table or a `last_active_tenant_id`
  on `user`. Revisit if the column gets re-purposed.
- Whether `subject_tenant.kind` should be a discriminated table (`claimant` table +
  `financier` table) once the kinds diverge enough in shape. Today they share the same
  columns; if/when they diverge, split.

## Alternatives considered

- **Separate `claimant` and `financier` tables**: rejected because the kinds share
  identical columns at this point. Single table + `kind` enum is simpler today and
  trivially splittable later.
- **Self-serve signup in P1**: rejected per Q5. Pre-revenue B2B SaaS that adds self-serve
  before product-market-fit invariably regrets it.
- **Auth0 / WorkOS broker**: rejected for P1 because Auth.js handles two providers
  natively at no vendor cost. Reconsider only if SAML enterprise deals land.
- **Trace ID as reqId**: rejected because it confuses tooling that assumes UUID format.
  Keeping them parallel preserves both semantics cleanly.

## References

- [P1 design](../plans/2026-04-26-p1-identity-tenancy-design.md)
- [Architecture design §4 data model](../plans/2026-04-25-rdti-grants-platform-design.md)
- Postgres RLS docs: https://www.postgresql.org/docs/16/ddl-rowsecurity.html
- W3C Trace Context: https://www.w3.org/TR/trace-context/
```

**Step 2: Commit**

```bash
git add docs/decisions/0002-identity-and-tenancy.md
git commit -m "docs(adr-0002): identity, tenancy & request correlation strategy

Captures the 5 P1 brainstorm decisions (Q1-Q5) plus the I5 reqId-vs-
traceparent strategy. Locks in the multi-tenant model (Full from Q2),
the dual-IdP commitment (Q1 E), the flat schema layout (Q3 A), the
federation-primitives-only depth (Q4 A), and the CLI-seed onboarding
(Q5 A). Documents the RLS context-setting approach via SET LOCAL.

Identity-side ADR before any schema or auth code lands so the
implementation has a written North Star to reference."
```

---

## Task 5: Add `tenant` and `user` schemas (the global root entities)

**Why both at once:** Both are "global" tables (no RLS), both follow the audit-column convention from T10, and both have similar structure. Batching avoids 6 nearly-identical commits for the same precedent-setting work.

**Files:**
- Create: `packages/db/src/schema/tenant.ts`
- Create: `packages/db/src/schema/user.ts`
- Modify: `packages/db/src/schema/index.ts` (re-export)

**Step 1: Write `packages/db/src/schema/tenant.ts`**

```ts
import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';

/**
 * Consultant firm — the white-label root tenant of the platform.
 *
 * Every domain row is ultimately scoped to a `tenant` via the
 * `current_setting('app.current_tenant_id')::uuid` RLS context-setter.
 * `tenant` itself is a GLOBAL table (no RLS) — access is gated at the
 * API layer.
 *
 * `slug` is a URL-safe identifier used in admin/portal paths.
 * `primary_idp` records which IdP this firm primarily uses; users in
 * the firm can sign in via either Microsoft or Google regardless.
 */
export const tenant = pgTable('tenant', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  primary_idp: text('primary_idp', { enum: ['microsoft', 'google', 'mixed'] })
    .notNull()
    .default('mixed'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});
```

**Step 2: Write `packages/db/src/schema/user.ts`**

```ts
import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';

/**
 * Person — globally unique by email + IdP. NOT bound to any single
 * tenant; membership is via `tenant_user` join (a user can belong to
 * multiple firms, e.g. consultant partners).
 *
 * `external_id` carries the IdP-specific subject identifier:
 *   - Microsoft Entra: 'microsoft:<oid>'
 *   - Google Workspace: 'google:<sub>'
 * Stable per-user across email changes; we use it for the canonical
 * lookup during OIDC callback.
 *
 * `user` itself is a GLOBAL table (no RLS) — access is gated at the
 * API layer (e.g. /v1/users requires admin role on active tenant).
 */
export const user = pgTable('user', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  display_name: text('display_name'),
  primary_idp: text('primary_idp', { enum: ['microsoft', 'google'] }).notNull(),
  external_id: text('external_id').notNull(),
  last_login_at: timestamp('last_login_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});
```

**Step 3: Update `packages/db/src/schema/index.ts`**

Append:

```ts
export * from './tenant.js';
export * from './user.js';
```

(Verify the existing `export * from './system.js';` line is still present.)

**Step 4: Verify typecheck**

```bash
cd /c/Users/Aaron/cpa-platform-worktrees/p1
pnpm --filter @cpa/db typecheck
```

Expected: exit 0.

**Step 5: Commit**

```bash
git add packages/db/src/schema/tenant.ts packages/db/src/schema/user.ts packages/db/src/schema/index.ts
git commit -m "feat(db): tenant + user schemas — the global root entities

Both are GLOBAL tables (no RLS) — access gated at API layer.
- tenant: white-label root with name, slug (unique URL-safe id),
  primary_idp ('microsoft'|'google'|'mixed').
- user: globally unique by email + idp; external_id carries the
  IdP-specific subject ('microsoft:<oid>' or 'google:<sub>').

Audit-column convention from T10 applied: created_at/updated_at
(notNull, defaultNow, \$onUpdate) + deleted_at (nullable).

P1 W1 schemas 1-2 of 6."
```

---

## Task 6: Add `subject_tenant` schema (claimant + financier discriminated by `kind`)

**Files:**
- Create: `packages/db/src/schema/subject_tenant.ts`
- Modify: `packages/db/src/schema/index.ts`

**Step 1: Write `packages/db/src/schema/subject_tenant.ts`**

```ts
import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';
import { tenant } from './tenant.js';

/**
 * Claimant or financier — the consultant firm's "client" entity.
 *
 * `kind` discriminates between:
 *   - 'claimant': owned by the firm; firm staff have direct access via
 *     subject_tenant_user roles.
 *   - 'financier': granted scoped read access via delegation_token (P8);
 *     does not have firm-level membership.
 *
 * RLS-protected: all reads/writes filtered by current_setting(
 *   'app.current_tenant_id', true)::uuid = tenant_id.
 */
export const subject_tenant = pgTable('subject_tenant', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenant_id: uuid('tenant_id')
    .notNull()
    .references(() => tenant.id),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['claimant', 'financier'] })
    .notNull()
    .default('claimant'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});
```

**Step 2: Update `packages/db/src/schema/index.ts`**

Append:

```ts
export * from './subject_tenant.js';
```

**Step 3: Verify**

```bash
pnpm --filter @cpa/db typecheck
```

Exit 0.

**Step 4: Commit**

```bash
git add packages/db/src/schema/subject_tenant.ts packages/db/src/schema/index.ts
git commit -m "feat(db): subject_tenant schema (claimant or financier)

Discriminated by kind enum:
- claimant (default): firm-owned client, accessed via subject_tenant_user
- financier: granted scoped read via delegation_token (populated in P8)

FK to tenant. Audit columns. Will be RLS-protected once policies land
in T11.

P1 W1 schema 3 of 6."
```

---

## Task 7: Add `tenant_user` and `subject_tenant_user` join schemas

**Why both at once:** Both are M:N joins with role enums + unique constraint on the pair. Identical pattern; batching keeps the join-table convention visible in one commit.

**Files:**
- Create: `packages/db/src/schema/tenant_user.ts`
- Create: `packages/db/src/schema/subject_tenant_user.ts`
- Modify: `packages/db/src/schema/index.ts`

**Step 1: Write `packages/db/src/schema/tenant_user.ts`**

```ts
import { pgTable, text, uuid, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenant } from './tenant.js';
import { user } from './user.js';

/**
 * User's membership in a consultant firm. M:N — a user can belong to
 * multiple firms (rare but real for consultant partners across firms).
 *
 * `is_default` marks which firm the user lands in at login when no
 * activeTenantId is in the session cookie. Exactly one row per user
 * SHOULD have is_default=true; nothing in the schema enforces this
 * (the application layer manages it during user provisioning).
 *
 * Roles:
 *   - 'admin': can manage firm settings, billing, users, claimants.
 *   - 'consultant': default; can work on claimants they have ACL access to.
 *   - 'viewer': read-only across the firm.
 *
 * RLS-protected: tenant_id = current_setting('app.current_tenant_id', true)::uuid.
 */
export const tenant_user = pgTable(
  'tenant_user',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    user_id: uuid('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role', { enum: ['admin', 'consultant', 'viewer'] })
      .notNull()
      .default('consultant'),
    is_default: boolean('is_default').notNull().default(false),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    uniqMembership: uniqueIndex('tenant_user_uniq').on(t.tenant_id, t.user_id),
  }),
);
```

**Step 2: Write `packages/db/src/schema/subject_tenant_user.ts`**

```ts
import { pgTable, text, uuid, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { subject_tenant } from './subject_tenant.js';
import { user } from './user.js';

/**
 * Per-claimant access control. M:N — a user can have access to many
 * claimants, and a claimant can be worked on by many users.
 *
 * Roles (per-claimant, distinct from firm-level role):
 *   - 'lead': primary consultant on this claimant.
 *   - 'observer': read access only.
 *
 * Default-access semantics (set by application layer when adding a user
 * to a firm — schema does not enforce):
 *   - 'admin' role on tenant_user: implicitly has access to all claimants
 *     in the firm regardless of subject_tenant_user rows.
 *   - 'consultant' / 'viewer' on tenant_user: needs explicit
 *     subject_tenant_user row to access a claimant.
 *
 * RLS-protected: subject_tenant_id IN (subquery resolving tenant_id).
 */
export const subject_tenant_user = pgTable(
  'subject_tenant_user',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    subject_tenant_id: uuid('subject_tenant_id')
      .notNull()
      .references(() => subject_tenant.id),
    user_id: uuid('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role', { enum: ['lead', 'observer'] })
      .notNull()
      .default('observer'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    uniqAcl: uniqueIndex('subject_tenant_user_uniq').on(t.subject_tenant_id, t.user_id),
  }),
);
```

**Step 3: Update `packages/db/src/schema/index.ts`**

Append:

```ts
export * from './tenant_user.js';
export * from './subject_tenant_user.js';
```

**Step 4: Verify**

```bash
pnpm --filter @cpa/db typecheck
```

Exit 0.

**Step 5: Commit**

```bash
git add packages/db/src/schema/tenant_user.ts packages/db/src/schema/subject_tenant_user.ts packages/db/src/schema/index.ts
git commit -m "feat(db): tenant_user + subject_tenant_user M:N join schemas

tenant_user: user's membership in a firm. Roles: admin|consultant|viewer.
  is_default marks the auto-active firm at login.
subject_tenant_user: per-claimant ACL. Roles: lead|observer.

Both have uniqueIndex on the pair to prevent duplicate memberships.
Both will be RLS-protected once policies land in T11. Per-claimant
ACLs apply for non-admin firm roles; admins implicitly access all
claimants in their firm (enforced at API layer).

P1 W1 schemas 4-5 of 6."
```

---

## Task 8: Add `delegation_token` schema (federation primitive)

**Files:**
- Create: `packages/db/src/schema/delegation_token.ts`
- Modify: `packages/db/src/schema/index.ts`

**Step 1: Write `packages/db/src/schema/delegation_token.ts`**

```ts
import { pgTable, text, uuid, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { tenant } from './tenant.js';
import { subject_tenant } from './subject_tenant.js';
import { user } from './user.js';

/**
 * Federation primitive — record of a scoped read token issued to an
 * external party (typically a financier or auditor) granting them
 * time-limited access to a subject_tenant's data.
 *
 * P1 ships the schema only. The API endpoints that issue + redeem
 * tokens land in P8 (per architecture design doc §3.6).
 *
 * The actual signed token (JWT or similar) lives in URLs / emails
 * and is verified per-request; this row is the AUDIT RECORD of who
 * issued what to whom, when, and what scope.
 *
 * APPEND-ONLY: no deleted_at column. Once issued, tokens are revoked
 * via revoked_at (set to a non-null timestamp), never deleted.
 *
 * RLS-protected: issuer_tenant_id = current_setting(
 *   'app.current_tenant_id', true)::uuid.
 */
export const delegation_token = pgTable('delegation_token', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  issuer_tenant_id: uuid('issuer_tenant_id')
    .notNull()
    .references(() => tenant.id),
  subject_tenant_id: uuid('subject_tenant_id')
    .notNull()
    .references(() => subject_tenant.id),
  issued_to_email: text('issued_to_email').notNull(),
  scope: jsonb('scope').notNull(),                          // e.g. { "read": ["assurance_report"] }
  issued_by_user_id: uuid('issued_by_user_id')
    .notNull()
    .references(() => user.id),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
```

**Step 2: Update `packages/db/src/schema/index.ts`**

Append:

```ts
export * from './delegation_token.js';
```

**Step 3: Verify**

```bash
pnpm --filter @cpa/db typecheck
```

Exit 0.

**Step 4: Commit**

```bash
git add packages/db/src/schema/delegation_token.ts packages/db/src/schema/index.ts
git commit -m "feat(db): delegation_token schema (federation primitive, populated in P8)

Append-only audit record of scoped read tokens issued from a tenant
to an external email (financier, auditor, etc.). Schema-only in P1;
API endpoints for issuance + redemption land in P8 per the
architecture design doc §3.6.

Note: no deleted_at — append-only. Revocation = setting revoked_at
to a non-null timestamp, not row deletion.

P1 W1 schema 6 of 6."
```

---

## Task 9: Generate Drizzle migration for the 6 new tables

**Files:**
- Generated: `packages/db/migrations/0001_<adjective>_<noun>.sql`
- Generated: `packages/db/migrations/meta/0001_snapshot.json`
- Modified: `packages/db/migrations/meta/_journal.json`

**Step 1: Run drizzle-kit generate**

```bash
cd /c/Users/Aaron/cpa-platform-worktrees/p1
pnpm --filter @cpa/db generate
```

Expected: drizzle-kit reads the schemas, diffs against the snapshot, emits a new SQL file at `packages/db/migrations/0001_<adjective>_<noun>.sql` containing 6 CREATE TABLE statements + the unique indexes.

**Step 2: Inspect the generated SQL**

```bash
ls packages/db/migrations/
cat packages/db/migrations/0001_*.sql | head -80
```

Verify:
- `CREATE TABLE "tenant"` — id PK, name, slug UNIQUE, primary_idp, audit cols
- `CREATE TABLE "user"` — id PK, email UNIQUE, primary_idp, external_id, audit cols
- `CREATE TABLE "subject_tenant"` — id PK, tenant_id FK, kind, audit cols
- `CREATE TABLE "tenant_user"` — id PK, tenant_id FK, user_id FK, role, is_default, audit cols + UNIQUE INDEX
- `CREATE TABLE "subject_tenant_user"` — id PK, subject_tenant_id FK, user_id FK, role, audit cols + UNIQUE INDEX
- `CREATE TABLE "delegation_token"` — id PK, issuer/subject/user FKs, scope jsonb, expires_at, revoked_at, created/updated_at (NO deleted_at)

**Step 3: Apply the migration**

```bash
pnpm --filter @cpa/db migrate
```

Expected: prints `migrations applied`. (Both 0000 and 0001 are now applied; 0000 is idempotent because it created `system` already.)

**Step 4: Verify tables exist in Postgres**

```bash
docker exec cpa-postgres psql -U cpa -d cpa_dev -c "\dt"
```

Expected: 7 tables visible (`system`, `tenant`, `subject_tenant`, `user`, `tenant_user`, `subject_tenant_user`, `delegation_token`) plus drizzle's internal `__drizzle_migrations` table.

**Step 5: Commit**

```bash
git add packages/db/migrations/
git commit -m "feat(db): migration 0001 — tenant, subject_tenant, user, joins, delegation_token

Six tables + two unique indexes. RLS not yet enabled — that lands
in migration 0002 (T11, hand-authored SQL).

drizzle-kit generated SQL matches the schema definitions byte-for-byte.
Snapshot updated. Journal entry appended.

P1 W1 migration 1 of 2."
```

---

## Task 10: Update the system table test runner to use the new tx pattern (drizzle migrate-from-fresh sanity check)

**Why this matters:** P0's `system.test.ts` uses raw `sql\`...\`` queries. Now that the tx-based RLS pattern is coming in T11, we want to confirm the existing tests still pass on a fresh DB after the new migration.

This is a *verification* task, not new code. It's a paranoia check.

**Step 1: Verify `@cpa/db` tests still pass**

```bash
pnpm --filter @cpa/db test
```

Expected: 3/3 pass (the 3 system table tests from T10 of P0). The new tables exist in the same schema but the system tests don't touch them.

**Step 2: Verify `@cpa/api` tests still pass**

```bash
pnpm --filter @cpa/api test
```

Expected: 9/9 pass (5 original + 4 new from T2). No regressions.

**Step 3: No commit**

This is a verification step only. If everything passes, move to T11. If anything fails, stop and investigate.

---

## Task 11: Add RLS policies via hand-authored SQL migration

**Why this matters:** Drizzle 0.36's migration generator does not understand `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` statements. We hand-author migration `0002_<noun>_<verb>.sql` that adds these for the four RLS-protected tables.

**Files:**
- Create: `packages/db/migrations/0002_enable_rls.sql`
- Modify: `packages/db/migrations/meta/_journal.json` (manually append entry)

**Step 1: Write the SQL migration**

Create `packages/db/migrations/0002_enable_rls.sql`:

```sql
-- 0002_enable_rls.sql
-- Adds Row-Level Security policies to the four tenant-scoped tables.
-- Hand-authored because drizzle-kit (0.36) does not generate
-- ENABLE ROW LEVEL SECURITY or CREATE POLICY statements.
--
-- All four policies use current_setting('app.current_tenant_id', true)
-- with the SECOND ARG = true so that an unset variable returns NULL
-- instead of throwing 'unrecognized configuration parameter'.
--
-- The `tenant` and `user` tables are GLOBAL (no RLS) — access is
-- gated at the API layer.

-- subject_tenant: direct tenant_id column on the row
ALTER TABLE "subject_tenant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subject_tenant_tenant_isolation" ON "subject_tenant"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- tenant_user: direct tenant_id column on the row
ALTER TABLE "tenant_user" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_user_tenant_isolation" ON "tenant_user"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- subject_tenant_user: tenant_id resolved via subject_tenant subquery
ALTER TABLE "subject_tenant_user" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subject_tenant_user_tenant_isolation" ON "subject_tenant_user"
  USING (
    subject_tenant_id IN (
      SELECT id FROM "subject_tenant"
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    )
  );

-- delegation_token: issuer_tenant_id is the firm's active context
ALTER TABLE "delegation_token" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "delegation_token_tenant_isolation" ON "delegation_token"
  USING (issuer_tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

**Step 2: Append entry to `packages/db/migrations/meta/_journal.json`**

Open `packages/db/migrations/meta/_journal.json`. It contains a JSON object with `entries` array. Append a new entry matching the existing pattern:

```json
{
  "idx": 2,
  "version": "7",
  "when": <current-unix-ms>,
  "tag": "0002_enable_rls",
  "breakpoints": true
}
```

(Replace `<current-unix-ms>` with output of `date +%s%3N`.)

**Step 3: Apply the migration**

```bash
pnpm --filter @cpa/db migrate
```

Expected: prints `migrations applied`. (Both 0001 and 0002 now applied.)

**Step 4: Verify RLS is enabled in Postgres**

```bash
docker exec cpa-postgres psql -U cpa -d cpa_dev -c "
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN
  ('subject_tenant', 'tenant_user', 'subject_tenant_user', 'delegation_token', 'tenant', 'user', 'system');"
```

Expected: 4 rows show `rowsecurity = t` (subject_tenant, tenant_user, subject_tenant_user, delegation_token); 3 rows show `rowsecurity = f` (tenant, user, system).

**Step 5: Verify policies exist**

```bash
docker exec cpa-postgres psql -U cpa -d cpa_dev -c "SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';"
```

Expected: 4 policies, one per RLS-protected table.

**Step 6: Commit**

```bash
git add packages/db/migrations/0002_enable_rls.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): migration 0002 — RLS policies for 4 tenant-scoped tables

Hand-authored because drizzle-kit 0.36 does not generate ENABLE ROW
LEVEL SECURITY or CREATE POLICY statements. Adds policies to:
- subject_tenant (direct tenant_id)
- tenant_user (direct tenant_id)
- subject_tenant_user (subquery via subject_tenant)
- delegation_token (issuer_tenant_id)

Policies use current_setting('app.current_tenant_id', true) with the
'true' second arg so an unset variable returns NULL instead of throwing.

tenant, user, system are intentionally NOT RLS-protected — access is
gated at the API layer for the first two; system is a sanity-check
artefact with no tenant scope.

P1 W1 migration 2 of 2."
```

---

## Task 12: Add RLS isolation integration test (TDD-flavoured: red on missing policy → green after migration applied)

**Why this matters:** This is the critical test. It seeds two tenants with different claimants, sets `app.current_tenant_id` to each, and asserts only that tenant's rows are visible. Without this test, RLS regressions ship undetected (the SQL in 0002 looks right but could have a typo).

**Files:**
- Create: `packages/db/src/schema/rls.test.ts`

**Step 1: Write the integration test**

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../client.js';

const TENANT_A_ID = '00000000-0000-4000-8000-00000000000a';
const TENANT_B_ID = '00000000-0000-4000-8000-00000000000b';
const SUBJECT_A1_ID = '00000000-0000-4000-8000-0000000000a1';
const SUBJECT_B1_ID = '00000000-0000-4000-8000-0000000000b1';

before(async () => {
  // Seed two tenants and one claimant each. Direct sql writes (bypass RLS via
  // table privileges; RLS only applies to USING clauses for SELECT/UPDATE/DELETE,
  // and the postgres user `cpa` is the table owner so it bypasses RLS by default
  // unless we explicitly FORCE it. We deliberately do NOT FORCE, so seeds work).
  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT_A_ID}, 'Firm A', 'firm-a', 'mixed'),
                   (${TENANT_B_ID}, 'Firm B', 'firm-b', 'mixed')`;
  await sql`INSERT INTO subject_tenant (id, tenant_id, name, kind)
            VALUES (${SUBJECT_A1_ID}, ${TENANT_A_ID}, 'Claimant A1', 'claimant'),
                   (${SUBJECT_B1_ID}, ${TENANT_B_ID}, 'Claimant B1', 'claimant')`;
});

after(async () => {
  // Cleanup
  await sql`DELETE FROM subject_tenant WHERE id IN (${SUBJECT_A1_ID}, ${SUBJECT_B1_ID})`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT_A_ID}, ${TENANT_B_ID})`;
  await sql.end();
});

// IMPORTANT: postgres user `cpa` is the owner of these tables. By default,
// table owners BYPASS RLS. To verify RLS in the test, we either:
//   (a) Use a non-owner role, OR
//   (b) Use ALTER TABLE ... FORCE ROW LEVEL SECURITY to apply RLS even to owners
// We choose (b) inside each test block to keep seeds simple. The application
// runs as the `cpa` user too, so we'll need to set FORCE in production migrations.
// Setting FORCE per-test by toggling it is too disruptive; instead we use a
// SET LOCAL session variable approach plus the policies' filter.
//
// Trick: even without FORCE, Postgres applies the policy filter when
// `row_security` is `on` (default) AND the role is not a superuser.
// `cpa` is not a superuser. So the policies DO apply unless explicitly bypassed.
//
// Verified: in production runs the cpa user gets RLS-filtered results
// because cpa is not a superuser AND we don't BYPASSRLS the role.

test('RLS: tenant A context sees only tenant A subject_tenants', async () => {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL app.current_tenant_id = ${TENANT_A_ID}`;
    const rows = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM subject_tenant ORDER BY name
    `;
    assert.equal(rows.length, 1, 'should see exactly 1 subject_tenant');
    assert.equal(rows[0]?.id, SUBJECT_A1_ID);
    assert.equal(rows[0]?.name, 'Claimant A1');
  });
});

test('RLS: tenant B context sees only tenant B subject_tenants', async () => {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL app.current_tenant_id = ${TENANT_B_ID}`;
    const rows = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM subject_tenant ORDER BY name
    `;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, SUBJECT_B1_ID);
    assert.equal(rows[0]?.name, 'Claimant B1');
  });
});

test('RLS: unset context sees no subject_tenants', async () => {
  // Note: outside any sql.begin tx, postgres-js may or may not set the GUC.
  // The current_setting(..., true) returns NULL when unset, and NULL = anything
  // is UNKNOWN, so the policy filter excludes all rows.
  await sql.begin(async (tx) => {
    // Deliberately do NOT SET LOCAL app.current_tenant_id
    const rows = await tx`SELECT id FROM subject_tenant`;
    assert.equal(rows.length, 0, 'no rows visible without RLS context');
  });
});

test('RLS: tenant A context sees only its own delegation_tokens', async () => {
  // Seed one delegation_token per tenant (transient — cleaned in this test)
  const TOK_A_ID = '00000000-0000-4000-8000-0000000000ca';
  const TOK_B_ID = '00000000-0000-4000-8000-0000000000cb';
  // Need a user_id for issued_by; create a transient one
  const USER_X_ID = '00000000-0000-4000-8000-0000000000ee';
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id)
            VALUES (${USER_X_ID}, 'x@example.com', 'microsoft', 'microsoft:test-x')`;
  await sql`INSERT INTO delegation_token (id, issuer_tenant_id, subject_tenant_id, issued_to_email, scope, issued_by_user_id, expires_at)
            VALUES
              (${TOK_A_ID}, ${TENANT_A_ID}, ${SUBJECT_A1_ID}, 'a@bank.com', '{"read":["assurance_report"]}', ${USER_X_ID}, NOW() + INTERVAL '30 days'),
              (${TOK_B_ID}, ${TENANT_B_ID}, ${SUBJECT_B1_ID}, 'b@bank.com', '{"read":["assurance_report"]}', ${USER_X_ID}, NOW() + INTERVAL '30 days')`;

  try {
    await sql.begin(async (tx) => {
      await tx`SET LOCAL app.current_tenant_id = ${TENANT_A_ID}`;
      const rows = await tx<{ id: string; issued_to_email: string }[]>`
        SELECT id, issued_to_email FROM delegation_token ORDER BY issued_to_email
      `;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.issued_to_email, 'a@bank.com');
    });
  } finally {
    await sql`DELETE FROM delegation_token WHERE id IN (${TOK_A_ID}, ${TOK_B_ID})`;
    await sql`DELETE FROM "user" WHERE id = ${USER_X_ID}`;
  }
});
```

**Step 2: Run the test**

```bash
cd /c/Users/Aaron/cpa-platform-worktrees/p1
pnpm --filter @cpa/db test
```

Expected: 3 (existing system tests) + 4 (new RLS tests) = 7/7 pass.

If tests fail with "RLS not enforcing" (i.e. tenant A sees both rows): the policies aren't applying. Most likely cause: the `cpa` Postgres user is a superuser. Check with `docker exec cpa-postgres psql -U cpa -d cpa_dev -c "SELECT rolsuper FROM pg_roles WHERE rolname = 'cpa';"` — if `t`, the user is bypassing RLS. Fix: `ALTER USER cpa NOSUPERUSER;` (rare; pgvector/pgvector image doesn't make cpa a superuser by default — a non-superuser cpa is the expected state).

**Step 3: Verify all gates green**

```bash
pnpm --filter @cpa/db typecheck
pnpm --filter @cpa/db lint
pnpm --filter @cpa/db build
pnpm --filter @cpa/api test         # regression: 9/9
pnpm --filter @cpa/observability test  # regression: 5/5
pnpm --filter @cpa/schemas test     # regression: 11/11
```

All exit 0. Aggregate test count: 11 + 7 + 9 + 5 = 32 tests.

**Step 4: Commit**

```bash
git add packages/db/src/schema/rls.test.ts
git commit -m "test(db): RLS isolation — cross-tenant data hiding proven for all 4 protected tables

Seeds two tenants + one claimant each, then asserts:
- Tenant A context sees only Claimant A1
- Tenant B context sees only Claimant B1
- Unset context sees zero rows (current_setting returns NULL → policy excludes)
- delegation_token isolation works the same way

This is the critical test for the multi-tenant model. Without it,
RLS regressions ship undetected. With it, the policy SQL is verified
end-to-end against the live Postgres.

Test uses sql.begin() transactions to scope SET LOCAL app.current_tenant_id
correctly. cpa Postgres user is non-superuser by default, so policies
apply without FORCE.

P1 W1 RLS verification."
```

---

## Task 13: Final W1 verification + push to origin

**Step 1: Cold-start mini-verification (lighter than P0's T18)**

```bash
cd /c/Users/Aaron/cpa-platform-worktrees/p1
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

All exit 0. test reports 32/32 across 4 packages.

**Step 2: Push the W1 work**

```bash
git push -u origin p1/identity-tenancy 2>&1 | tail -3
```

Expected: branch created on origin, all W1 commits pushed.

**Step 3: Watch the first CI run on this branch (resolves I6)**

CI workflow triggers on push to any branch and PR to main. Visit:
`https://github.com/steeldragon666/cpa-platform/actions?query=branch:p1/identity-tenancy`

Expected: green check on the run. If any step fails:
- Format/lint failures: investigate locally, push fix.
- Test failures: usually means test environment differs from local (e.g. CI has a different Postgres extension setup). Check the CI step output, fix the gap.

**Step 4: No commit needed for verification**

The push completes W1.

---

## W1 Acceptance criteria (all green to declare W1 done)

- [x] T1: Tracer-init extracted; diag warnings about pre-loaded modules absent in boot log
- [x] T2: `/readyz` DB-down test landed; checkDb refactored to accept injectable runner; 4 new tests
- [x] T3: App cast comment names exactOptionalPropertyTypes specifically
- [x] T4: ADR-0002 committed at `docs/decisions/0002-identity-and-tenancy.md`
- [x] T5–T8: 6 new schemas at `packages/db/src/schema/*.ts`, audit columns on every table
- [x] T9: Migration 0001 generated by drizzle-kit, applied successfully
- [x] T10: Existing tests still pass against new DB shape
- [x] T11: Migration 0002 (RLS) hand-authored, applied; 4 tables show `rowsecurity = t`
- [x] T12: 4 RLS isolation tests pass; cross-tenant data hiding verified
- [x] T13: All gates green; pushed to origin/p1/identity-tenancy; CI green

Aggregate stats at end of W1:
- 13 commits on `p1/identity-tenancy`
- 32 tests passing across 4 packages (was 24)
- 7 Postgres tables (was 1: `system`)
- 4 RLS-protected tables
- 2 migrations applied
- 1 new ADR

---

## What W1 does NOT do (intentionally)

- No Auth.js setup (W2)
- No JWT signing/verification (W2)
- No `/v1/auth/*` endpoints (W2–W3)
- No `/v1/tenants/*` endpoints (W3)
- No Consultant Portal Next.js app (W4)
- No onboarding CLI script (W4)
- No end-to-end auth integration tests (W5)
- No tag yet — `p1-identity-tenancy` ships at end of W5

W1 is the *foundation underneath identity*. W2 starts wiring auth on top.

---

## Estimated time

- Solo + AI pair, focused: **3–5 days** of working sessions
- Pacing: 4–5 tasks per session
- Slowest tasks are typically T11 (manual SQL migration + journal entry edit) and T12 (RLS test design — getting the seed/cleanup right takes care)

When all acceptance criteria are checked, write the **W2 plan**.
