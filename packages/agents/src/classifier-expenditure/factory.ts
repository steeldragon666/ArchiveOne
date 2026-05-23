import { OpusExpenditureClassifier } from './opus.js';
import { StubExpenditureClassifier } from './stub.js';
import type { ExpenditureClassifier } from './types.js';

/**
 * Selects an {@link ExpenditureClassifier} implementation from environment.
 *
 * Resolution order:
 * 1. `EXPENDITURE_CLASSIFIER_IMPL` is honored verbatim if set
 *    (`stub` or `opus`). Backwards-compat: `haiku` is accepted as a
 *    legacy alias and routes to the same OpusExpenditureClassifier —
 *    earlier versions of this code shipped a Haiku backend and
 *    existing deployments still set `EXPENDITURE_CLASSIFIER_IMPL=haiku`.
 * 2. Otherwise, `CI=true` opts into the stub (no API key required, fully
 *    deterministic).
 * 3. Otherwise, defaults to `opus` (live model, requires
 *    `ANTHROPIC_API_KEY`).
 *
 * Unknown values throw rather than silently falling back, so misconfigured
 * deployments fail loudly at startup.
 *
 * Note: this env namespace is `EXPENDITURE_CLASSIFIER_*` — deliberately
 * decoupled from the existing `CLASSIFIER_*` (the P3 evidence classifier).
 * Both can run in stub mode independently.
 */
// Test-only override hatch. ES module exports are non-configurable so
// node:test's `mock.method` cannot patch `makeExpenditureClassifier` directly
// (throws "Cannot redefine property"). Production code MUST NOT touch this;
// integration tests use `_setExpenditureClassifierForTests` to inject a
// stub impl (e.g., to drive the threshold-downgrade path that the stub's
// regex table never naturally produces). Mirrors the
// `_resetAnthropicClientForTests` / `_resetBucketsForTests` convention.
let _testOverride: ExpenditureClassifier | undefined = undefined;

export function _setExpenditureClassifierForTests(
  override: ExpenditureClassifier | undefined,
): void {
  _testOverride = override;
}

export function makeExpenditureClassifier(): ExpenditureClassifier {
  if (_testOverride !== undefined) return _testOverride;

  const explicit = process.env.EXPENDITURE_CLASSIFIER_IMPL;
  const impl = explicit ?? (process.env.CI ? 'stub' : 'opus');
  switch (impl) {
    case 'stub':
      return new StubExpenditureClassifier();
    case 'opus':
    case 'haiku': // legacy alias — previous default before the model swap
      return new OpusExpenditureClassifier();
    default:
      throw new Error(`unknown EXPENDITURE_CLASSIFIER_IMPL: ${impl} (expected 'opus' or 'stub')`);
  }
}
