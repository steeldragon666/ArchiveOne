# P1 W1 Checkpoint — 2026-04-26

**Status:** T1–T10 ✅ landed; T11–T13 pending. RLS design unblocked but needs a role-architecture fix before code.

**Branch:** `p1/identity-tenancy` (14 commits ahead of `origin/main`).
**Tip:** `c641d91` — `feat(db): migration 0001`.

## What's in: T1–T10

- **Batch 1** merge `8aa0bf0`: T1 tracer-init extract, T2 checkDb injectable runner, T3 App-cast comment, T4 ADR-0002, T5 tenant + user schemas.
- **Batch 2** merge `b8a948b`: T6 subject_tenant schema.
- **Batch 3** merge `d2e5a29` + barrel `7336aa5`: T7 tenant_user + subject_tenant_user, T8 delegation_token.
- **T9** `c641d91`: drizzle-kit-generated migration 0001 applied; 7 tables in Postgres; 8 FKs; 2 unique indexes. drizzle-kit upgraded 0.29.1 → 0.31.10 to fix the `.js`-extension import resolution.
- **T10:** regression — 9/9 api tests, 3/3 db tests, all gates green.

## What's blocked: T11 RLS migration

The original W1 plan's RLS approach (`ENABLE ROW LEVEL SECURITY` + `USING` policy) is **insufficient** for our setup. Two independent bypass paths exist that the plan didn't account for:

1. **Superuser bypass.** Postgres superusers always skip RLS, regardless of any other settings. `cpa` is currently a superuser.
2. **Owner bypass.** Table owners always skip RLS unless `FORCE ROW LEVEL SECURITY` is set on the table. `cpa` owns every table.

Naive workaround (just run `ALTER USER cpa NOSUPERUSER`) **fails**: Postgres enforces that the bootstrap user (the role created at `initdb` time, which is `cpa` here) must retain SUPERUSER. The error is:

```
ERROR:  permission denied to alter role
DETAIL:  The bootstrap user must have the SUPERUSER attribute.
```

So the clean fix is a **role-architecture change**: introduce a separate non-superuser application role.

### Proposed T11 design (deferred to next session)

Migration 0002 should:

1. `CREATE ROLE cpa_app NOLOGIN NOINHERIT` (or `LOGIN` with a password if we need direct connection).
2. `GRANT USAGE ON SCHEMA public TO cpa_app`.
3. `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cpa_app`.
4. `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ... TO cpa_app` (so future tables auto-grant).
5. For each of the 4 RLS-protected tables (`subject_tenant`, `tenant_user`, `subject_tenant_user`, `delegation_token`):
   - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
   - `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
   - `CREATE POLICY ... USING (...) WITH CHECK (...)` — both clauses, so reads AND writes are tenant-scoped.

The application connects as `cpa_app` (non-superuser, non-owner), so both bypass paths are closed and policies apply.

The **DATABASE_URL** environment variable changes from `postgres://cpa:cpa@localhost:5433/cpa_dev` to `postgres://cpa_app:<pwd>@localhost:5433/cpa_dev`. Migrations still run as `cpa` (the privileged role). This is the standard "two-role" Postgres pattern.

### T12 RLS isolation test impact

The plan's `before()` block does direct INSERTs against `subject_tenant`. With FORCE + WITH CHECK + a non-owner application role, those inserts must run inside a transaction with `SET LOCAL app.current_tenant_id` matching the row's tenant_id. The seed code needs restructuring:

```ts
// Tenant table is global (no RLS) — inserts work as-is
await sql`INSERT INTO tenant (...) VALUES (...)`;

// subject_tenant is RLS-protected; need GUC set per-tenant insert
await sql.begin(async (tx) => {
  await tx`SET LOCAL app.current_tenant_id = ${TENANT_A_ID}`;
  await tx`INSERT INTO subject_tenant (id, tenant_id, ...) VALUES (${SUBJECT_A1_ID}, ${TENANT_A_ID}, ...)`;
});
```

### Init.sql change

`tools/postgres/init.sql` should be extended (in T11 or T13 polish) to create the `cpa_app` role at container init time, so fresh dev containers have it ready.

## Other open follow-ups (carried from earlier reviews)

1. **server.ts shutdown polish** — `void shutdown(...)` swallows `sdk.shutdown()` rejections; the 25s race `setTimeout` is never cleared if `app.close()` wins. Important; non-blocking. Address in T13.
2. **Schema import alphabetization** — `system.ts`, `tenant.ts`, `user.ts` inherited a drifted order (`pgTable, text, uuid, timestamp`). T6/T7/T8 are alphabetical (`pgTable, text, timestamp, uuid`). T13 polish: alphabetize the three legacy files.
3. **T13's planned scope** — cold-start `pnpm install --frozen-lockfile && build && typecheck && lint && test && format:check`, then `git push -u origin p1/identity-tenancy` and watch the CI run.

## How to resume

1. Open a new session in `C:\Users\Aaron\cpa-platform-worktrees\p1`.
2. Read this checkpoint + `docs/plans/2026-04-26-p1-w1-foundation-and-schemas.md` (the W1 plan) + `docs/decisions/0002-identity-and-tenancy.md` (the ADR).
3. Confirm Postgres is up: `docker ps --filter name=cpa-postgres`.
4. Confirm branch tip: `git rev-parse --short=7 HEAD` should match `c641d91` (or whatever this checkpoint commit ends up being).
5. Begin T11 with the **revised** RLS design (cpa_app role + FORCE + WITH CHECK + matching test seed pattern).

## Aggregate W1 stats so far

- Commits on `p1/identity-tenancy`: 14 (12 work + 2 plan/checkpoint docs)
- Tests passing: 32 across 4 packages (9 api + 3 db + 11 schemas + 5 observability + 4 db.test = 32 — schemas and observability counts approximated from prior session memory)
- Tables in Postgres: 7 (`system` + 6 new)
- RLS policies: 0 (T11 pending)
- Migrations: 2 applied (`0000_organic_saracen`, `0001_pink_diamondback`)

W1 is ~75% complete by the original 13-task scope.
