import { xeroAccountingGet } from './client.js';
import { xeroAccountingGetStub } from './stub-client.js';

/**
 * Xero accounting client factory (T-B7).
 *
 * Single point-of-swap between the real Xero accounting client and the
 * deterministic local stub. Returns the function the B2-B5 sync code
 * uses to fetch resource pages. Selected via the `XERO_IMPL` env var:
 *
 *   - `XERO_IMPL=stub` → returns `xeroAccountingGetStub`, which reads
 *     fixtures from `fixtures/*.json` and ignores tenant/auth.
 *   - any other value (or unset) → returns `xeroAccountingGet`, the
 *     real fetch-based HTTP client.
 *
 * **Why a factory and not Vitest aliasing**: aliasing only works in the
 * test runner; `XERO_IMPL=stub` needs to work in dev (`pnpm dev` against
 * a stubbed Xero) and CI runtime (running the API end-to-end without
 * real Xero credentials). The factory lives in production code, gates
 * on `process.env`, and gives every caller the same swap.
 *
 * **Why call-site env-check, not module-load env-check**: tests that set
 * `process.env.XERO_IMPL` after module load (or in a `beforeEach`) need
 * the next factory call to honour the new value. A module-load capture
 * would freeze the choice at import time and require a module reset
 * (or `vi.resetModules()` equivalent) per test. Reading env on every
 * call costs nothing measurable and keeps the test surface small.
 *
 * **Why a single env var rather than a config object**: aligns with the
 * sibling `CLASSIFIER_IMPL` env var pattern already used in `@cpa/agents`
 * (see `globalPassThroughEnv` in `turbo.json`). One precedent, one
 * mental model.
 *
 * Callers replace `import { xeroAccountingGet } from './client.js'` with
 * `import { createXeroAccountingGet } from './client-factory.js'` and
 * resolve the function once per sync invocation:
 *
 *   const xeroGet = createXeroAccountingGet();
 *   const data = await xeroGet(opts, '/Invoices', query, headers);
 *
 * The shape of the returned function is byte-identical to the real
 * `xeroAccountingGet`, so callers don't need to be aware of the swap.
 */

/**
 * Type of the function the factory returns. Matches the real
 * `xeroAccountingGet` signature exactly so callers can assign it
 * to a typed variable and the type system enforces parity.
 */
export type XeroAccountingGet = typeof xeroAccountingGet;

/**
 * Inspect `process.env.XERO_IMPL` and return the appropriate
 * implementation. Pure and side-effect-free; safe to call as often as
 * the caller wants.
 */
export function createXeroAccountingGet(): XeroAccountingGet {
  if (process.env.XERO_IMPL === 'stub') {
    return xeroAccountingGetStub;
  }
  return xeroAccountingGet;
}
