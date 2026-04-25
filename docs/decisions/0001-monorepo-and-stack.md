# ADR-0001: Monorepo and stack

**Status:** Accepted
**Date:** 2026-04-26
**Authors:** Aaron Newson + AI pair

## Context

We are building a white-label SaaS platform (R&DTI Intelligence Platform + Australian Grants module) targeting Australian R&D tax and grant consultants. Architecture spec: [`docs/plans/2026-04-25-rdti-grants-platform-design.md`](../plans/2026-04-25-rdti-grants-platform-design.md). The platform must support TypeScript across mobile (Expo), web (Next.js), and API (Fastify); persist evidence in a hash-chained ledger backed by Postgres + pgvector; and run agents on Anthropic Claude.

This ADR captures the foundational stack decisions made during P0 (T1–T18). Subsequent ADRs will document the per-phase architectural calls.

## Decision

### Repo and tooling

- **Single greenfield monorepo** named `cpa-platform`, hosted at `github.com/steeldragon666/cpa-platform` (private).
- **pnpm 10.26.0** with `packageManager` field pinned for corepack determinism. Bumped from pnpm 9 during P0 because pnpm 9.12.3 had Windows install reliability bugs that pnpm 10 fixed (and which surfaced when we briefly relocated work to an exFAT drive).
- **turbo 2** for task orchestration with the standard build / dev / lint / test / typecheck graph.
- **Node 22 LTS** as the minimum runtime (`engines.node >= 22.0.0`).
- **TypeScript 5.6+** with strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` + `isolatedModules`. ESM-only (`type: module`).
- **`module: NodeNext`** + `.js` extensions in source-side relative imports (TypeScript-ESM convention). Source files end in `.ts`; their imports look like `import { x } from './foo.js'` — TypeScript and tsx both resolve this correctly, npm's ESM resolver does too at runtime after build.

### Database and migrations

- **Postgres 16 + pgvector 0.8.0** via the official `pgvector/pgvector:0.8.0-pg16` image. Local dev runs in docker compose, bound to host port `127.0.0.1:5433` (port 5433 to coexist with any native Postgres on 5432; loopback bind to close LAN-exposure path on the trivial `cpa/cpa` dev creds).
- **Drizzle ORM 0.36.x** with **drizzle-kit** for migration generation. Schema is hand-authored in TypeScript; migrations are generated SQL committed to the repo at `packages/db/migrations/`.
- **`drizzle.config.ts` schema is an explicit array of per-table file paths**, not a barrel re-export. Drizzle-kit 0.29 runs in CJS and cannot resolve `.js` extensions through our ESM barrel. Trade-off: every new table requires editing the array. Documented in `packages/db/drizzle.config.ts`.
- **App-side UUID v4** via `crypto.randomUUID()` (Node global) using Drizzle's `$defaultFn(() => crypto.randomUUID())`. We do NOT use `gen_random_uuid()` from pgcrypto at the schema layer (pgcrypto is loaded but only earmarked for future hashing helpers). Reason: matches the strict `Uuid` zod schema in `@cpa/schemas` (regex enforces v4 only); rejects v1 (MAC-leaking) and v3/v5 by construction.
- **Audit-column convention** — every domain table carries `created_at` (notNull, defaultNow), `updated_at` (notNull, defaultNow), `deleted_at` (nullable, soft-delete marker). Established in T10's `system` table.

### Test runner

- **Node 22 native test runner** via `tsx --test "src/**/*.test.ts"` for unit and integration tests. tsx is the TypeScript loader; node is the runner. Globs use **double quotes** in package scripts because Windows cmd.exe doesn't honour single quotes (silently matches zero files — a CI-green-but-broken footgun caught in T8).
- DB integration tests run against the live docker compose Postgres, not a mock. Each test file calls `await sql.end()` in `after()` so the runner exits cleanly.

### Linting + formatting

- **ESLint 9 flat config** with `typescript-eslint`'s `recommendedTypeChecked` for type-aware rules.
- Test files use a separate `tsconfig.test.json` (with `noEmit: true`) per package, discovered via the root `eslint.config.mjs` `files: ['**/*.test.ts']` override block. The override also disables `@typescript-eslint/no-floating-promises` for test files (idiomatic `node:test` doesn't await `test()` calls).
- Files extending `.js`/`.mjs`/`.cjs` get `tseslint.configs.disableTypeChecked` so root-level config files (e.g. `eslint.config.mjs` itself) lint cleanly without being in any tsconfig.
- **Prettier** with `printWidth: 100`, `singleQuote: true`, `endOfLine: lf`, `proseWrap: preserve`. `.prettierignore` scopes the markdown ignore to `docs/plans/**/*.md` (frozen artefacts) — README, ADRs, and other markdown ARE formatted.

### Observability

- **OpenTelemetry SDK Node** with **OTLP/HTTP exporter** to **Grafana Cloud** (`ap-southeast-1` for AU residency).
- **pino** for structured logs at level `info` by default (`LOG_LEVEL` env override).
- Auto-instrumentation for HTTP, Fastify, pg/postgres-js. Every span carries `service.name`, `service.version`, plus per-call attributes (request id, tenant id, prompt version, model, tokens) where relevant.

### CI

- **GitHub Actions** with a single `ci` workflow gating push to `main` and every PR. Runs typecheck + lint + test + migrate + format:check against an inline Postgres 16 + pgvector service. Concurrency group cancels in-progress runs on the same ref.

### Filesystem layout

- Source repo on **NTFS** (C: drive). exFAT does not support symlinks, which pnpm requires for both its `.pnpm/` store layout and workspace-package linkage. Discovered the hard way by briefly trying to host the repo on the user's exFAT D: drive — install fails. NTFS is mandatory for the dev machine.
- WSL2 swap on D: (`D:\\dev\\.wsl\\swap.vhdx`, 8GB) — relieves C: RAM pressure without affecting symlink semantics. Configured via `~/.wslconfig`.
- Docker Desktop's WSL2 disk image — recommended to relocate to D: via Settings → Resources → Advanced (manual GUI step the user can do when convenient).

## Consequences

**Positive**
- Single language (TypeScript) across mobile, web, API, and infrastructure-as-code (Drizzle schemas) reduces context switching and lets us share zod schemas (`@cpa/schemas`) between request validation and DB row shapes.
- Modern strict TS catches a class of bugs at typecheck time (the `noUncheckedIndexedAccess` setting alone has prevented several `Cannot read property 'x' of undefined` patterns in code reviews).
- Hash-chain integrity from app-side UUID v4 generation: the entropy is provably v4 and the schema rejects v1 by construction, so audit-trail content addressing can never silently degrade if a future contributor switches to `gen_random_uuid()`.

**Negative**
- The drizzle.config.ts schema-array maintenance burden — every new table requires a config edit. Acceptable for the scale we're at; revisit if it becomes painful.
- The double-quoted glob convention is a Windows-compat workaround that costs us a small style oddity in `package.json` files.
- Drizzle-kit being CJS-only is a known long-term friction; we'll need to track upstream movement on https://github.com/drizzle-team/drizzle-kit/issues for an ESM resolution.

**Reviewable in P1**
- Connection pool size (`DATABASE_POOL_MAX`) — currently 10 for the runtime client. Bump configurably when the API hits real concurrent load.
- `updated_at` auto-bump strategy — currently relies on callers passing `updatedAt` explicitly (or using Drizzle's `$onUpdate` hook on the ORM path). May want a DB trigger or a shared base-table macro when the table count exceeds 5.
- The deviation from "documents/web before mobile" sequencing in the architecture doc — P0 only built API + DB. P1 will add identity + tenancy + the consultant-portal Next.js scaffold; that's where the sequencing gets exercised.

## Alternatives considered

- **Prisma instead of Drizzle**: Prisma has a stronger ecosystem and migration tooling, but the ORM is opinionated (always-flat queries, generated client) and harder to escape to raw SQL. We will need raw SQL for RLS policies in P1, where Drizzle's type-passthrough patterns are more direct. Rejected.
- **Vitest instead of Node test runner**: Vitest has better DX (snapshots, mocking, watch UI) but adds a heavyweight dep. Node 22's native test runner is fast and zero-config. Acceptable until we hit a feature gap that pushes us back. Revisit.
- **Bun instead of Node + pnpm**: Bun is impressive but production support for Mobile (Expo) + Next.js + Drizzle is still uneven in early 2026. Once those mature, revisit.
- **Yarn Berry instead of pnpm**: Berry's PnP is unfamiliar to most contributors and has its own ecosystem rough edges. pnpm's symlinked layout is well understood. Pnpm wins on familiarity + Windows install reliability (with the v10 bump).
- **Kysely instead of Drizzle**: Kysely is more SQL-faithful and has better composability for complex queries, but Drizzle's first-class TypeScript schema and Drizzle Studio for ad-hoc inspection wins on developer ergonomics for our team size. Revisit at scale.
- **NTFS-formatted dev drive**: rejected for now because reformatting D: requires evacuating ~150 GB. The hybrid (source on C: NTFS; Docker + swap on D: exFAT — both single-file blobs that exFAT handles fine) covers most of the disk-pressure relief without the reformat.

## Related decisions

This ADR is the foundation. Future ADRs will cover specifics like:
- ADR-0002: Federated multi-tenancy and delegation tokens (P1)
- ADR-0003: Hash chain construction and verification (P2)
- ADR-0004: Agent runtime (classifier + extractor + drafter) (P2 once code lands)
- ADR-0005: Document template engine (deterministic vs LLM-generated split) (P4)

## References

- Architecture design: [`docs/plans/2026-04-25-rdti-grants-platform-design.md`](../plans/2026-04-25-rdti-grants-platform-design.md)
- P0 implementation plan: [`docs/plans/2026-04-25-p0-foundation.md`](../plans/2026-04-25-p0-foundation.md)
- pgvector ≥ 0.5 extension naming: https://github.com/pgvector/pgvector/issues/353
- Windows pnpm install issues fixed in 10.x: pnpm 10 release notes
