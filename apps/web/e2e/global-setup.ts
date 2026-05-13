import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Playwright globalSetup — loads the repo-root `.env` into process.env
 * before any test (or test-file import) runs.
 *
 * Why: from a cold shell (no env vars exported), `playwright test` imports
 * `@cpa/db/client` transitively via the e2e fixtures, which reads
 * `DATABASE_URL` at module-eval time. Without this hook the runner falls
 * back to the dev-fallback URL in `packages/db/src/env.ts` and hits
 * ECONNREFUSED 127.0.0.1:5433. Loading `.env` here makes the suite
 * reproducible from a fresh terminal without manual `export` dances.
 *
 * Uses Node 22's built-in `process.loadEnvFile()` rather than the
 * `dotenv` package — repo `engines.node` is already `>=22.0.0` and
 * dotenv isn't a declared `apps/web` dep.
 */
// __dirname is not defined in ESM; derive it from import.meta.url so this
// works whether Playwright's loader treats the file as CJS or ESM.
const here =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup(): Promise<void> {
  // Playwright runs from apps/web; repo root is two levels up from e2e/.
  const envPath = path.resolve(here, '../../../.env');
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Don't block test startup if .env is malformed — the user's
      // shell-exported vars (if any) will still apply.
    }
  }
}
