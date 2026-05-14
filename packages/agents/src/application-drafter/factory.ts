import { SonnetApplicationDrafter } from './sonnet.js';
import { StubApplicationDrafter } from './stub.js';
import type { ApplicationDrafter } from './types.js';

/**
 * Selects an {@link ApplicationDrafter} implementation from environment.
 *
 * Resolution order:
 * 1. `APPLICATION_DRAFTER_IMPL` honored verbatim (`sonnet` | `stub`).
 * 2. `CI=true` → stub (no API key required, deterministic).
 * 3. Default → `sonnet` (requires `ANTHROPIC_API_KEY`).
 *
 * Unknown values throw — misconfigured deployments fail loudly rather
 * than silently degrading. Mirrors the synthesizer-register factory.
 */
export function makeApplicationDrafter(): ApplicationDrafter {
  const explicit = process.env.APPLICATION_DRAFTER_IMPL;
  const impl = explicit ?? (process.env.CI ? 'stub' : 'sonnet');
  switch (impl) {
    case 'stub':
      return new StubApplicationDrafter();
    case 'sonnet':
      return new SonnetApplicationDrafter();
    default:
      throw new Error(`unknown APPLICATION_DRAFTER_IMPL: ${impl} (expected 'sonnet' or 'stub')`);
  }
}
