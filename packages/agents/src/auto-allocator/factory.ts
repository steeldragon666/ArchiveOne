import { HaikuAutoAllocator } from './haiku.js';
import { StubAutoAllocator } from './stub.js';
import type { AutoAllocator } from './types.js';

/**
 * Selects an {@link AutoAllocator} implementation from environment.
 *
 * Resolution order:
 * 1. `ALLOCATOR_IMPL` is honored verbatim if set (`stub` or `haiku`).
 * 2. Otherwise, `CI=true` opts into the stub (no API key required, deterministic).
 * 3. Otherwise, defaults to `haiku` (live model, requires `ANTHROPIC_API_KEY`).
 *
 * Unknown values throw rather than silently falling back.
 */
export function makeAutoAllocator(): AutoAllocator {
  const explicit = process.env.ALLOCATOR_IMPL;
  const impl = explicit ?? (process.env.CI ? 'stub' : 'haiku');
  switch (impl) {
    case 'stub':
      return new StubAutoAllocator();
    case 'haiku':
      return new HaikuAutoAllocator();
    default:
      throw new Error(`unknown ALLOCATOR_IMPL: ${impl} (expected 'haiku' or 'stub')`);
  }
}
