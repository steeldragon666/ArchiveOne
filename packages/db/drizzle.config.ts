import { defineConfig } from 'drizzle-kit';

// drizzle-kit (CJS loader) cannot resolve the `.js` extension that
// our `module: NodeNext` + `verbatimModuleSyntax: true` setup requires
// in source-side relative imports — so we point it directly at the
// per-table files instead of going through `src/schema/index.ts`.
// Add new table files to this array as the schema grows.
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/schema/system.ts'],
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://cpa:cpa@localhost:5433/cpa_dev',
  },
  verbose: true,
  strict: true,
});
