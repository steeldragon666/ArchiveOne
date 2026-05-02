import { HaikuExpenditureClassifier } from './haiku.js';
import { StubExpenditureClassifier } from './stub.js';
import type { ExpenditureClassifier } from './types.js';

/**
 * Selects an {@link ExpenditureClassifier} implementation from environment.
 *
 * Resolution order:
 * 1. `EXPENDITURE_CLASSIFIER_IMPL` is honored verbatim if set
 *    (`stub` or `haiku`).
 * 2. Otherwise, `CI=true` opts into the stub (no API key required, fully
 *    deterministic).
 * 3. Otherwise, defaults to `haiku` (live model, requires
 *    `ANTHROPIC_API_KEY`).
 *
 * Unknown values throw rather than silently falling back, so misconfigured
 * deployments fail loudly at startup.
 *
 * Note: this env namespace is `EXPENDITURE_CLASSIFIER_*` — deliberately
 * decoupled from the existing `CLASSIFIER_*` (the P3 evidence classifier).
 * Both can run in stub mode independently.
 */
export function makeExpenditureClassifier(): ExpenditureClassifier {
  const explicit = process.env.EXPENDITURE_CLASSIFIER_IMPL;
  const impl = explicit ?? (process.env.CI ? 'stub' : 'haiku');
  switch (impl) {
    case 'stub':
      return new StubExpenditureClassifier();
    case 'haiku':
      return new HaikuExpenditureClassifier();
    default:
      throw new Error(`unknown EXPENDITURE_CLASSIFIER_IMPL: ${impl} (expected 'haiku' or 'stub')`);
  }
}
