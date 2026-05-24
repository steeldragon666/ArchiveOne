import { OpusClassifier } from './opus.js';
import { StubClassifier } from './stub.js';
import type { Classifier } from './types.js';

/**
 * Selects a {@link Classifier} implementation from environment.
 *
 * Resolution order:
 * 1. `CLASSIFIER_IMPL` is honored verbatim if set (`stub` or `opus`).
 *    Backwards-compat: the legacy value `haiku` is accepted and routes
 *    to the same OpusClassifier — earlier versions of this code shipped
 *    a Haiku backend and existing deployments still set
 *    `CLASSIFIER_IMPL=haiku`; we don't want a bad-config rejection
 *    after the model swap.
 * 2. Otherwise, `CI=true` opts into the stub (no API key required, fully
 *    deterministic).
 * 3. Otherwise, defaults to `opus` (live model, requires `ANTHROPIC_API_KEY`).
 *
 * Unknown values throw rather than silently falling back, so misconfigured
 * deployments fail loudly at startup.
 */
export function makeClassifier(): Classifier {
  const explicit = process.env.CLASSIFIER_IMPL;
  const impl = explicit ?? (process.env.CI ? 'stub' : 'opus');
  switch (impl) {
    case 'stub':
      return new StubClassifier();
    case 'opus':
    case 'haiku': // legacy alias — previous default before the model swap
      return new OpusClassifier();
    default:
      throw new Error(`unknown CLASSIFIER_IMPL: ${impl} (expected 'opus' or 'stub')`);
  }
}
