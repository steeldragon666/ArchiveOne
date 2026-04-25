# P0 — Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish the monorepo, CI, Postgres+pgvector, Fastify API skeleton, and end-to-end OpenTelemetry tracing — so every subsequent phase has a working baseline and a green CI.

**Architecture:** Single pnpm + turbo monorepo with `apps/` and `packages/` workspaces. TypeScript everywhere. Postgres 16 + pgvector via Docker for local dev; AWS RDS later. Fastify 4 API with zod validation generating OpenAPI at build. Drizzle ORM for schema + migrations (raw-SQL escape hatch needed later for RLS). OpenTelemetry SDK with OTLP exporter to Grafana Cloud. Node 22 LTS test runner. GitHub Actions CI gates every merge on typecheck + test + lint.

**Tech Stack:** Node 22, pnpm 9, turbo 2, TypeScript 5.6, Fastify 4, zod 3, Drizzle ORM 0.36+, drizzle-kit, Postgres 16 + pgvector, Docker Compose, OpenTelemetry SDK Node, pino, GitHub Actions.

**Source design:** [docs/plans/2026-04-25-rdti-grants-platform-design.md](./2026-04-25-rdti-grants-platform-design.md), §1 (stack), §2 (package layout), §6 P0 row.

**Critical deliverable for P0:** `pnpm test` is green, `pnpm typecheck` is green, `curl localhost:3000/healthz` returns 200 *and* a corresponding trace appears in Grafana Cloud, `pnpm db:migrate` applies the initial migration cleanly to a fresh Postgres.

**Out of scope for P0:** identity, tenancy, RLS, the actual `tenant`/`event`/`subject_tenant` tables, any agent code, any UI. Those are P1+. P0 ends with infrastructure that can host P1.

---

## Pre-flight checklist (do once, then never again)

Before Task 1, ensure these exist on the dev machine:

- [ ] Node 22 LTS installed (`node -v` → `v22.x.x`)
- [ ] pnpm 9 installed (`pnpm -v` → `9.x.x`); install via `npm i -g pnpm@9` if missing
- [ ] Docker Desktop running (`docker info` succeeds)
- [ ] Git configured (`git config --get user.email` returns the right address)
- [ ] A Grafana Cloud account with an OTLP endpoint, username, and API token; have these handy as environment variables `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_OTLP_USERNAME`, `GRAFANA_OTLP_PASSWORD`. (Free tier is fine.) If not yet set up, defer Tasks 18–20 to the end and set up the account when you reach them — every other task can run without it.
- [ ] Working in `C:\Users\Aaron\cpa-platform\` (or whatever you renamed it to). The repo is already initialised on `main` with the design doc committed.

---

## Task 1: Add `package.json` at repo root with pnpm + turbo metadata

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`

**Step 1: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**Step 2: Write `package.json`**

```json
{
  "name": "cpa-platform",
  "private": true,
  "packageManager": "pnpm@9.12.3",
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down",
    "db:migrate": "pnpm --filter @cpa/db migrate",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.6.3",
    "prettier": "^3.4.2"
  }
}
```

**Step 3: Run install to verify**

Run: `pnpm install`
Expected: pnpm initialises a lockfile; no errors. Workspace packages list is empty (we'll add them next).

**Step 4: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(p0): pnpm workspace + turbo bootstrap"
```

---

## Task 2: Add root `turbo.json`

**Files:**
- Create: `turbo.json`

**Step 1: Write `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

**Step 2: Verify turbo loads the config**

Run: `pnpm turbo run typecheck --dry`
Expected: turbo prints "no tasks to run" or similar — no syntax errors. (No packages exist yet to typecheck.)

**Step 3: Commit**

```bash
git add turbo.json
git commit -m "chore(p0): turbo task graph"
```

---

## Task 3: Add root TypeScript config

**Files:**
- Create: `tsconfig.base.json`

**Step 1: Write `tsconfig.base.json`** (this is the shared base; per-package configs extend it)

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "sourceMap": true,
    "removeComments": false,
    "incremental": true
  }
}
```

**Step 2: Commit**

```bash
git add tsconfig.base.json
git commit -m "chore(p0): shared tsconfig base with strict settings"
```

---

## Task 4: Add Prettier + EditorConfig

**Files:**
- Create: `.prettierrc.json`
- Create: `.editorconfig`
- Create: `.prettierignore`

**Step 1: Write `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "endOfLine": "lf"
}
```

**Step 2: Write `.editorconfig`**

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

**Step 3: Write `.prettierignore`**

```
node_modules/
dist/
.next/
.turbo/
pnpm-lock.yaml
*.md
```

**Step 4: Verify Prettier**

Run: `pnpm format`
Expected: prints "All matched files use Prettier code style!" or formats existing files.

**Step 5: Commit**

```bash
git add .prettierrc.json .editorconfig .prettierignore
git commit -m "chore(p0): prettier + editorconfig"
```

---

## Task 5: Add ESLint flat config

**Files:**
- Create: `eslint.config.mjs`
- Modify: `package.json` (add ESLint deps)

**Step 1: Add ESLint deps**

Run:
```bash
pnpm add -D -w eslint@^9.16.0 typescript-eslint@^8.18.0 eslint-config-prettier@^9.1.0
```

**Step 2: Write `eslint.config.mjs`**

```js
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/.turbo/**'],
  },
);
```

**Step 3: Add lint script to root `package.json`** (modify the existing `lint` line; if turbo handles it per package, leave it alone — we'll add per-package later)

**Step 4: Commit**

```bash
git add eslint.config.mjs package.json pnpm-lock.yaml
git commit -m "chore(p0): eslint flat config with type-checked rules"
```

---

## Task 6: Add `.env.example` and update `.gitignore`

**Files:**
- Create: `.env.example`
- Modify: `.gitignore`

**Step 1: Write `.env.example`**

```bash
# Postgres (local dev via docker compose)
DATABASE_URL=postgres://cpa:cpa@localhost:5432/cpa_dev

# Anthropic
ANTHROPIC_API_KEY=

# Voyage AI (embeddings)
VOYAGE_API_KEY=

# Grafana Cloud OTLP
GRAFANA_OTLP_ENDPOINT=
GRAFANA_OTLP_USERNAME=
GRAFANA_OTLP_PASSWORD=

# API
API_PORT=3000
NODE_ENV=development
```

**Step 2: Append to `.gitignore`**

```
# secrets
.env
.env.local
.env.*.local

# editor
.idea/
.vscode/

# os
.DS_Store
Thumbs.db

# coverage
coverage/
```

**Step 3: Commit**

```bash
git add .env.example .gitignore
git commit -m "chore(p0): env template + extended gitignore"
```

---

## Task 7: Add Docker Compose for local Postgres + pgvector

**Files:**
- Create: `docker-compose.yml`
- Create: `tools/postgres/init.sql`

**Step 1: Write `tools/postgres/init.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS pgvector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

**Step 2: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: cpa-postgres
    environment:
      POSTGRES_USER: cpa
      POSTGRES_PASSWORD: cpa
      POSTGRES_DB: cpa_dev
    ports:
      - "5432:5432"
    volumes:
      - cpa-pgdata:/var/lib/postgresql/data
      - ./tools/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cpa -d cpa_dev"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  cpa-pgdata:
```

**Step 3: Bring it up**

Run: `pnpm db:up`
Expected: `cpa-postgres` container starts. Run `docker exec cpa-postgres pg_isready -U cpa` and expect `accepting connections`.

**Step 4: Verify pgvector loaded**

Run:
```bash
docker exec cpa-postgres psql -U cpa -d cpa_dev -c "SELECT extname FROM pg_extension;"
```
Expected: rows include `pgvector` and `pgcrypto`.

**Step 5: Commit**

```bash
git add docker-compose.yml tools/postgres/init.sql
git commit -m "chore(p0): postgres 16 + pgvector via docker compose"
```

---

## Task 8: Create `packages/schemas` skeleton with first zod export

**Files:**
- Create: `packages/schemas/package.json`
- Create: `packages/schemas/tsconfig.json`
- Create: `packages/schemas/src/index.ts`
- Create: `packages/schemas/src/primitives.ts`
- Create: `packages/schemas/src/primitives.test.ts`

**Step 1: Write `packages/schemas/package.json`**

```json
{
  "name": "@cpa/schemas",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "node --test --experimental-test-coverage 'src/**/*.test.ts'",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.6.3"
  }
}
```

**Step 2: Write `packages/schemas/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "tsBuildInfoFile": "./dist/.tsbuildinfo",
    "composite": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```

**Step 3: Write the failing test first** (`packages/schemas/src/primitives.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Uuid, Sha256Hash } from './primitives.ts';

test('Uuid accepts a valid UUID v4', () => {
  const v = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(Uuid.parse(v), v);
});

test('Uuid rejects a non-UUID string', () => {
  assert.throws(() => Uuid.parse('not-a-uuid'));
});

test('Sha256Hash accepts a 64-char lowercase hex string', () => {
  const v = 'a'.repeat(64);
  assert.equal(Sha256Hash.parse(v), v);
});

test('Sha256Hash rejects a 63-char string', () => {
  assert.throws(() => Sha256Hash.parse('a'.repeat(63)));
});

test('Sha256Hash rejects uppercase hex', () => {
  assert.throws(() => Sha256Hash.parse('A'.repeat(64)));
});
```

**Step 4: Install deps and run the test**

Run: `pnpm install`
Run: `pnpm --filter @cpa/schemas test`
Expected: FAIL — `primitives.ts` doesn't exist.

**Step 5: Write the minimal implementation** (`packages/schemas/src/primitives.ts`)

```ts
import { z } from 'zod';

export const Uuid = z.string().uuid();
export type Uuid = z.infer<typeof Uuid>;

export const Sha256Hash = z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex chars');
export type Sha256Hash = z.infer<typeof Sha256Hash>;

export const Iso8601 = z.string().datetime({ offset: true });
export type Iso8601 = z.infer<typeof Iso8601>;
```

**Step 6: Write `packages/schemas/src/index.ts`**

```ts
export * from './primitives.ts';
```

**Step 7: Re-run tests**

Run: `pnpm --filter @cpa/schemas test`
Expected: all 5 tests PASS.

**Step 8: Verify typecheck**

Run: `pnpm --filter @cpa/schemas typecheck`
Expected: no errors.

**Step 9: Commit**

```bash
git add packages/schemas pnpm-lock.yaml
git commit -m "feat(schemas): primitive types — Uuid, Sha256Hash, Iso8601"
```

---

## Task 9: Create `packages/db` skeleton with Drizzle

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/migrate.ts`

**Step 1: Write `packages/db/package.json`**

```json
{
  "name": "@cpa/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./schema": {
      "types": "./dist/schema/index.d.ts",
      "import": "./dist/schema/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "node --test 'src/**/*.test.ts'",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "generate": "drizzle-kit generate",
    "migrate": "tsx src/migrate.ts",
    "studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@cpa/schemas": "workspace:*",
    "drizzle-orm": "^0.36.4",
    "postgres": "^3.4.5"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "drizzle-kit": "^0.29.1",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

**Step 2: Write `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "tsBuildInfoFile": "./dist/.tsbuildinfo",
    "composite": true
  },
  "references": [
    { "path": "../schemas" }
  ],
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```

**Step 3: Write `packages/db/drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://cpa:cpa@localhost:5432/cpa_dev',
  },
  verbose: true,
  strict: true,
});
```

**Step 4: Write `packages/db/src/schema/index.ts`** (placeholder — first table comes in Task 10)

```ts
// Schema entrypoint. Tables are imported and re-exported here.
// First table is added in Task 10 (placeholder `system` table for migration sanity check).
export {};
```

**Step 5: Write `packages/db/src/client.ts`**

```ts
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://cpa:cpa@localhost:5432/cpa_dev';

export const sql = postgres(connectionString, { max: 10 });
export const db = drizzle(sql);
export type Db = typeof db;
```

**Step 6: Write `packages/db/src/migrate.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://cpa:cpa@localhost:5432/cpa_dev';

const migrationClient = postgres(connectionString, { max: 1 });

await migrate(drizzle(migrationClient), { migrationsFolder: './migrations' });
await migrationClient.end();

console.log('migrations applied');
```

**Step 7: Install deps**

Run: `pnpm install`
Expected: drizzle-orm, drizzle-kit, postgres, tsx all installed.

**Step 8: Verify typecheck**

Run: `pnpm --filter @cpa/db typecheck`
Expected: no errors.

**Step 9: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): drizzle skeleton + migration runner"
```

---

## Task 10: First migration — placeholder `system` table

**Files:**
- Modify: `packages/db/src/schema/system.ts` (create)
- Modify: `packages/db/src/schema/index.ts`
- Generated: `packages/db/migrations/0000_*.sql` (drizzle-kit emits)
- Create: `packages/db/src/schema/system.test.ts`

**Note on the failing test:** the schema test verifies the migration runs cleanly and the table is queryable. We test against the live Postgres container — this is an integration test, intentional, because we don't mock the DB.

**Step 1: Write the failing integration test** (`packages/db/src/schema/system.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../client.ts';

test('system table exists and accepts an insert', async () => {
  const id = crypto.randomUUID();
  await sql`INSERT INTO system (id, key, value) VALUES (${id}, 'p0_check', 'ok')`;
  const rows = await sql`SELECT key, value FROM system WHERE id = ${id}`;
  assert.equal(rows[0]?.key, 'p0_check');
  assert.equal(rows[0]?.value, 'ok');
  await sql`DELETE FROM system WHERE id = ${id}`;
});

test.after(async () => {
  await sql.end();
});
```

**Step 2: Write the schema** (`packages/db/src/schema/system.ts`)

```ts
import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';

export const system = pgTable('system', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Step 3: Re-export from schema index** (`packages/db/src/schema/index.ts`)

```ts
export * from './system.ts';
```

**Step 4: Generate migration**

Ensure `.env` exists (copy from `.env.example` and fill `DATABASE_URL`).

Run: `pnpm --filter @cpa/db generate`
Expected: a new file appears at `packages/db/migrations/0000_<adjective>_<noun>.sql` containing `CREATE TABLE "system" (...)`.

**Step 5: Run the test — expect FAIL**

Run: `pnpm db:up` (if not already running)
Run: `pnpm --filter @cpa/db test`
Expected: FAIL — `relation "system" does not exist`.

**Step 6: Apply the migration**

Run: `pnpm --filter @cpa/db migrate`
Expected: prints `migrations applied`.

**Step 7: Re-run the test — expect PASS**

Run: `pnpm --filter @cpa/db test`
Expected: PASS.

**Step 8: Commit**

```bash
git add packages/db/src/schema packages/db/migrations
git commit -m "feat(db): system table — migration sanity check"
```

---

## Task 11: Create `packages/observability` with OpenTelemetry SDK

**Files:**
- Create: `packages/observability/package.json`
- Create: `packages/observability/tsconfig.json`
- Create: `packages/observability/src/index.ts`
- Create: `packages/observability/src/tracer.ts`
- Create: `packages/observability/src/logger.ts`

**Step 1: Write `packages/observability/package.json`**

```json
{
  "name": "@cpa/observability",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "node --test 'src/**/*.test.ts'",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/auto-instrumentations-node": "^0.55.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.57.0",
    "@opentelemetry/resources": "^1.30.0",
    "@opentelemetry/sdk-node": "^0.57.0",
    "@opentelemetry/semantic-conventions": "^1.28.0",
    "pino": "^9.5.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.6.3"
  }
}
```

**Step 2: Write `packages/observability/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "tsBuildInfoFile": "./dist/.tsbuildinfo",
    "composite": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```

**Step 3: Write `packages/observability/src/tracer.ts`**

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

export interface TracerInit {
  serviceName: string;
  serviceVersion: string;
}

export function startTracing(init: TracerInit): NodeSDK {
  const endpoint = process.env.GRAFANA_OTLP_ENDPOINT;
  const username = process.env.GRAFANA_OTLP_USERNAME;
  const password = process.env.GRAFANA_OTLP_PASSWORD;

  const headers: Record<string, string> = {};
  if (username && password) {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    headers.Authorization = `Basic ${credentials}`;
  }

  const exporter = endpoint
    ? new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers })
    : new OTLPTraceExporter();

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: init.serviceName,
      [ATTR_SERVICE_VERSION]: init.serviceVersion,
    }),
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  return sdk;
}
```

**Step 4: Write `packages/observability/src/logger.ts`**

```ts
import pino from 'pino';

export interface LoggerInit {
  serviceName: string;
  level?: pino.Level;
}

export function createLogger(init: LoggerInit): pino.Logger {
  return pino({
    name: init.serviceName,
    level: init.level ?? (process.env.LOG_LEVEL as pino.Level) ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}
```

**Step 5: Write `packages/observability/src/index.ts`**

```ts
export { startTracing } from './tracer.ts';
export type { TracerInit } from './tracer.ts';
export { createLogger } from './logger.ts';
export type { LoggerInit } from './logger.ts';
```

**Step 6: Install + typecheck**

Run: `pnpm install`
Run: `pnpm --filter @cpa/observability typecheck`
Expected: no errors.

**Step 7: Commit**

```bash
git add packages/observability pnpm-lock.yaml
git commit -m "feat(observability): otel sdk + pino logger wrappers"
```

---

## Task 12: Create `apps/api` Fastify skeleton

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/routes/health.ts`

**Step 1: Write `apps/api/package.json`**

```json
{
  "name": "@cpa/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "test": "node --test 'src/**/*.test.ts'",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "@cpa/db": "workspace:*",
    "@cpa/observability": "workspace:*",
    "@cpa/schemas": "workspace:*",
    "fastify": "^5.2.0",
    "fastify-type-provider-zod": "^4.0.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

**Step 2: Write `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  },
  "references": [
    { "path": "../../packages/schemas" },
    { "path": "../../packages/db" },
    { "path": "../../packages/observability" }
  ],
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```

**Step 3: Write `apps/api/src/app.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { createLogger } from '@cpa/observability';
import { healthRoutes } from './routes/health.ts';

export function buildApp(): FastifyInstance {
  const logger = createLogger({ serviceName: 'api' });

  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: false,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(healthRoutes);

  return app;
}
```

**Step 4: Write `apps/api/src/routes/health.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  uptimeSeconds: z.number().nonnegative(),
});

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/healthz',
    {
      schema: {
        response: { 200: HealthResponse },
      },
    },
    () => ({
      status: 'ok' as const,
      service: 'api' as const,
      uptimeSeconds: Math.floor(process.uptime()),
    }),
  );
}
```

**Step 5: Write `apps/api/src/server.ts`**

```ts
import { startTracing } from '@cpa/observability';
import { buildApp } from './app.ts';

const sdk = startTracing({ serviceName: 'api', serviceVersion: '0.0.0' });

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
  await app.close();
  await sdk.shutdown();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

**Step 6: Install + typecheck**

Run: `pnpm install`
Run: `pnpm --filter @cpa/api typecheck`
Expected: no errors.

**Step 7: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): fastify skeleton with /healthz"
```

---

## Task 13: Health endpoint test (TDD on the wire)

**Files:**
- Create: `apps/api/src/routes/health.test.ts`

**Step 1: Write the test**

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';

let app: FastifyInstance;

before(async () => {
  app = buildApp();
  await app.ready();
});

after(async () => {
  await app.close();
});

test('GET /healthz returns 200 with the expected body shape', async () => {
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'api');
  assert.equal(typeof body.uptimeSeconds, 'number');
  assert.ok((body.uptimeSeconds as number) >= 0);
});

test('GET /healthz response matches the Zod schema (400 on bad serialization is impossible — schema enforces correctness)', async () => {
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  // implicit: serializer would 500 if the response didn't match schema
});
```

**Step 2: Run the test — expect PASS**

Run: `pnpm --filter @cpa/api test`
Expected: PASS — both tests green.

**Step 3: Verify the live server**

Run: `pnpm --filter @cpa/api dev`
In another terminal: `curl -s localhost:3000/healthz | jq`
Expected: `{ "status": "ok", "service": "api", "uptimeSeconds": <small int> }`
Stop the dev server (Ctrl+C).

**Step 4: Commit**

```bash
git add apps/api/src/routes/health.test.ts
git commit -m "test(api): /healthz contract test"
```

---

## Task 14: Wire DB health into the API

**Files:**
- Modify: `apps/api/src/routes/health.ts`
- Modify: `apps/api/src/routes/health.test.ts`
- Create: `apps/api/src/db.ts`

**Step 1: Add DB module wrapper** (`apps/api/src/db.ts`)

```ts
import { sql } from '@cpa/db/client';

export async function checkDb(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await sql`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}
```

NOTE: this requires `@cpa/db` to export `client` as a subpath. Check `packages/db/package.json` exports — adjust to add:

```json
"./client": {
  "types": "./dist/client.d.ts",
  "import": "./dist/client.js"
}
```

**Step 2: Modify the failing test first** — extend `apps/api/src/routes/health.test.ts`

Add this test at the bottom of the file:

```ts
test('GET /readyz returns ok when DB is reachable', async () => {
  const res = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.status, 'ready');
  const checks = body.checks as Record<string, unknown>;
  assert.equal((checks.db as Record<string, unknown>).ok, true);
});
```

**Step 3: Run — expect FAIL**

Run: `pnpm --filter @cpa/api test`
Expected: FAIL — `/readyz` returns 404.

**Step 4: Add the route** — modify `apps/api/src/routes/health.ts`

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { checkDb } from '../db.ts';

const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  uptimeSeconds: z.number().nonnegative(),
});

const ReadyResponse = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.object({
    db: z.object({
      ok: z.boolean(),
      latencyMs: z.number().nonnegative(),
    }),
  }),
});

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/healthz',
    { schema: { response: { 200: HealthResponse } } },
    () => ({
      status: 'ok' as const,
      service: 'api' as const,
      uptimeSeconds: Math.floor(process.uptime()),
    }),
  );

  app.get(
    '/readyz',
    { schema: { response: { 200: ReadyResponse, 503: ReadyResponse } } },
    async (_, reply) => {
      const db = await checkDb();
      const status = db.ok ? 'ready' : 'degraded';
      const code = db.ok ? 200 : 503;
      return reply.code(code).send({ status, checks: { db } });
    },
  );
}
```

**Step 5: Re-run — expect PASS**

Run: `pnpm --filter @cpa/db build` (so the db package's `dist/client.js` exists)
Run: `pnpm --filter @cpa/api test`
Expected: PASS.

**Step 6: Commit**

```bash
git add apps/api/src packages/db/package.json
git commit -m "feat(api): /readyz with DB liveness check"
```

---

## Task 15: Wire OpenTelemetry into Fastify

**Files:**
- Modify: `apps/api/src/server.ts` (already imports `startTracing`)

The `auto-instrumentations-node` package automatically instruments Fastify and pg/postgres. No code change needed beyond what we already did in Task 12. This task verifies the wire-up works.

**Step 1: Set Grafana env vars** in `.env`

Fill in the three `GRAFANA_OTLP_*` values from your Grafana Cloud account.

**Step 2: Start the API with tracing on**

Run: `pnpm --filter @cpa/api dev`

**Step 3: Generate trace traffic**

In another terminal:
```bash
for i in {1..5}; do curl -s localhost:3000/healthz > /dev/null; done
for i in {1..5}; do curl -s localhost:3000/readyz > /dev/null; done
```

**Step 4: Verify traces appear in Grafana**

Open Grafana Cloud → Explore → Tempo data source → search service `api`.
Expected: spans for `GET /healthz` and `GET /readyz` appear within 1–2 minutes. The `/readyz` trace contains a child span for the Postgres `SELECT 1`.

**Step 5: Stop the dev server. No commit needed — this is a verification task.**

If traces don't appear: check the API logs (pino) for OTLP export errors. Most likely cause is a missing or wrong `GRAFANA_OTLP_ENDPOINT` (it should be the full base URL, e.g. `https://otlp-gateway-prod-au-southeast-1.grafana.net/otlp`).

---

## Task 16: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Write the workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: cpa
          POSTGRES_PASSWORD: cpa
          POSTGRES_DB: cpa_dev
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U cpa -d cpa_dev"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10

    env:
      DATABASE_URL: postgres://cpa:cpa@localhost:5432/cpa_dev

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Init pgvector + pgcrypto
        run: |
          PGPASSWORD=cpa psql -h localhost -U cpa -d cpa_dev -c "CREATE EXTENSION IF NOT EXISTS pgvector; CREATE EXTENSION IF NOT EXISTS pgcrypto;"

      - name: Build
        run: pnpm build

      - name: Migrate
        run: pnpm db:migrate

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Test
        run: pnpm test
```

**Step 2: Verify locally that all gates pass before pushing**

Run:
```bash
pnpm install
pnpm build
pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm test
```
Expected: all green.

**Step 3: Push and verify**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(p0): github actions — typecheck + lint + test + migrate"
git push -u origin main
```

(If no remote yet: skip the push, but note that you'll need a GitHub repo before P1 since the writing-plans flow assumes one. Create one at https://github.com/new under the name `cpa-platform` and add the remote: `git remote add origin git@github.com:steeldragon666/cpa-platform.git`.)

Verify the Actions tab on GitHub shows a green run.

---

## Task 17: ADR — record the foundational tech-stack decisions

**Files:**
- Create: `docs/decisions/0001-monorepo-and-stack.md`

**Step 1: Write the ADR**

```markdown
# ADR-0001: Monorepo and stack

**Status:** Accepted
**Date:** 2026-04-25

## Context

We're building a white-label SaaS platform (R&DTI Intelligence Platform + Grants module) targeting Australian R&D tax and grant consultants. The architecture design (`docs/plans/2026-04-25-rdti-grants-platform-design.md`) commits us to TypeScript across mobile, web, and API; Postgres + pgvector for storage; Anthropic Claude for agents.

## Decision

- pnpm 9 + turbo 2 monorepo, single repo `cpa-platform`
- Node 22 LTS
- TypeScript 5.6 with strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
- Fastify 4 + zod via fastify-type-provider-zod (validation + OpenAPI generation in one)
- Drizzle ORM + drizzle-kit (raw SQL escape hatch needed for RLS in P1)
- Postgres 16 + pgvector (via pgvector/pgvector:pg16 Docker image locally)
- OpenTelemetry → Grafana Cloud OTLP
- pino for structured logs
- Node 22 test runner (no Vitest/Jest dependency)
- ESLint flat config + Prettier
- GitHub Actions CI gating typecheck + lint + test + migrate

## Consequences

- **Positive**: single language across all surfaces; modern dev experience; minimal toolchain; fast CI; easy local setup.
- **Negative**: drizzle is younger than Prisma — some ecosystem rough edges; Node test runner is less mature than Vitest for some patterns (snapshots, mocking). Both judged acceptable.
- **Reviewable in P1**: if Drizzle migrations get cumbersome with RLS, fall back to drizzle for schema introspection + raw SQL for migrations.

## Alternatives considered

- **Prisma**: stronger ecosystem but heavier runtime; harder to escape to raw SQL; rejected.
- **Vitest**: better DX but adds a heavyweight dep; rejected for now in favour of Node test runner; revisit if test ergonomics become painful.
- **Bun**: tempting but mobile + Next.js + Drizzle production support is still uneven in early 2026; rejected.
```

**Step 2: Commit**

```bash
git add docs/decisions/0001-monorepo-and-stack.md
git commit -m "docs(adr-0001): monorepo and stack decision record"
```

---

## Task 18: Ensure everything still passes end-to-end

**Step 1: Cold-restart everything**

Run:
```bash
pnpm db:down
docker volume rm cpa-platform_cpa-pgdata 2>/dev/null || true
pnpm db:up
sleep 5
pnpm install
pnpm build
pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all green from a cold start. If any step fails, the failure is on the P0 critical path — fix it before declaring P0 done.

**Step 2: Verify trace round-trip from cold start**

Run: `pnpm --filter @cpa/api dev`
Generate traffic: `for i in {1..3}; do curl -s localhost:3000/readyz > /dev/null; done`
Open Grafana → Tempo → search `service.name=api` for the last 5 minutes.
Expected: at least 3 traces with `GET /readyz` spans containing a Postgres child span.

Stop the dev server.

**Step 3: Tag the commit as the P0 milestone**

```bash
git tag -a p0-foundation -m "P0 — Foundation complete: monorepo, CI, DB, API, OTel"
git push --tags
```

(Skip the `--tags` push if you didn't set up a remote in Task 16.)

---

## Acceptance criteria for P0

The following ALL must be true to declare P0 done:

- [ ] `pnpm install` succeeds from a clean checkout on a fresh machine
- [ ] `pnpm db:up && sleep 5 && pnpm db:migrate` applies cleanly
- [ ] `pnpm build` succeeds
- [ ] `pnpm typecheck` succeeds
- [ ] `pnpm lint` succeeds
- [ ] `pnpm test` succeeds (all packages green, including `system` table integration test)
- [ ] `pnpm --filter @cpa/api dev` starts; `curl localhost:3000/healthz` returns 200; `curl localhost:3000/readyz` returns 200 with `checks.db.ok=true`
- [ ] At least one trace from a real request appears in Grafana Cloud Tempo
- [ ] CI is green on `main` after a clean push
- [ ] ADR-0001 committed
- [ ] Repo has commits at the expected granularity (one per task, no batched mega-commits)

---

## What P0 does NOT do (intentionally)

- No identity, auth, sessions, JWT, SSO — that's P1
- No tenant or subject_tenant tables — that's P1
- No RLS policies — P1
- No real domain tables (`event`, `weekly_log`, `project`, etc.) — P2
- No agents, prompts, classifier — P2
- No mobile or consultant-portal apps — P1 (portal scaffold) and P3 (mobile)
- No CI deployment to a live environment — comes when there's something to deploy (post-P1)

P0 is *infrastructure to host the things*, not the things.

---

## Estimated time

- Solo + AI pair, focused: **3–5 days** of working sessions
- Pacing: aim for 4–5 tasks per session; tasks are deliberately small to allow review-and-commit cadence
- The slowest tasks are typically Task 7 (Docker on Windows can be flaky), Task 15 (first OTel→Grafana wiring), and Task 16 (CI debugging on first push)

When all acceptance criteria are checked, proceed to writing the **P1 — Identity & Tenancy** plan.
