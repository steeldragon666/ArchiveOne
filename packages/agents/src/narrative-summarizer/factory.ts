import { OpusNarrativeSummarizer } from './opus.js';
import { StubNarrativeSummarizer } from './stub.js';
import type { NarrativeSummarizer } from './types.js';

/**
 * Selects a {@link NarrativeSummarizer} implementation from environment.
 *
 * Resolution order:
 * 1. `NARRATIVE_SUMMARIZER_IMPL` is honored verbatim if set (`stub` or `opus`).
 * 2. Otherwise, `CI=true` opts into the stub (no API key required, deterministic).
 * 3. Otherwise, defaults to `opus` (live model, requires `ANTHROPIC_API_KEY`).
 *
 * Unknown values throw rather than silently falling back.
 */
export function makeNarrativeSummarizer(): NarrativeSummarizer {
  const explicit = process.env.NARRATIVE_SUMMARIZER_IMPL;
  const impl = explicit ?? (process.env.CI ? 'stub' : 'opus');
  switch (impl) {
    case 'stub':
      return new StubNarrativeSummarizer();
    case 'opus':
      return new OpusNarrativeSummarizer();
    default:
      throw new Error(`unknown NARRATIVE_SUMMARIZER_IMPL: ${impl} (expected 'opus' or 'stub')`);
  }
}
