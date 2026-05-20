#!/usr/bin/env tsx
/**
 * Smoke-test the auto-allocator agent end-to-end against Anthropic.
 *
 * Sends a classified evidence event plus a list of candidate activities;
 * the allocator should pick the best-matching activity or mark unallocated.
 *
 * Usage:
 *   pnpm exec tsx test-auto-allocator.ts
 */

// MUST be first import — force-load .env values.
import '../../apps/api/src/force-env.js';

import { HaikuAutoAllocator } from '../../packages/agents/src/auto-allocator/haiku.js';

async function main(): Promise<void> {
  console.log('auto-allocator smoke-test');
  console.log(`  model: ${process.env['AUTO_ALLOCATOR_MODEL'] ?? 'claude-haiku-4-5'}`);
  console.log('');

  const allocator = new HaikuAutoAllocator();

  console.log('  → calling allocate()…');
  const t0 = Date.now();
  const output = await allocator.allocate({
    event_id: '88888888-8888-4888-8888-888888888888',
    raw_text:
      'On 22 October 2025 the team retrained the XGBoost CECI regressor with the view_angle ' +
      'feature added. Validation RMSE on the 480-pixel held-out test set dropped from 0.062 to ' +
      '0.041, with R² of 0.78. This confirms that view-angle information is necessary to meet ' +
      'the target accuracy threshold for cloud-edge bias correction.',
    classification: {
      kind: 'EXPERIMENT',
      confidence: 0.91,
      rationale:
        'Verbatim experimental log entry describing a model retrain with quantified accuracy ' +
        'metrics on a held-out test set. Classic experiment evidence under s.355-25.',
      statutory_anchor: 's.355-25',
    },
    activities: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        code: 'CA-01',
        kind: 'core',
        title:
          'Adaptive bias-correction for satellite-derived crop NDVI under cloud-edge contamination',
        hypothesis:
          'A CECI derived from BRDF residuals, view angle, and cloud-adjacency distance can ' +
          'recover unbiased NDVI for Sentinel-2 pixels within 1.5 km of cloud edges.',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        code: 'CA-02',
        kind: 'core',
        title: 'Diurnal-drift compensation for ground-truth NDVI spectrometry',
        hypothesis:
          'Time-of-day correction factors derived from re-sampled field spectra eliminate ' +
          'diurnal bias in ground-truth NDVI for satellite-validation comparison.',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        code: 'SA-01',
        kind: 'supporting',
        title: 'Field-spectrometer calibration tour for CECI ground-truth validation',
        hypothesis: null,
      },
    ],
  });
  const elapsedMs = Date.now() - t0;

  console.log(`  ← allocate() returned in ${elapsedMs}ms`);
  console.log('');
  if (output.unallocated) {
    console.log('=== UNALLOCATED ===');
    console.log(`  rationale : ${output.rationale}`);
  } else {
    console.log('=== ALLOCATED ===');
    console.log(`  activity_id   : ${output.activity_id}`);
    console.log(`  activity_code : ${output.activity_code}`);
    console.log(`  confidence    : ${output.confidence}`);
    console.log(`  rationale     : ${output.rationale}`);
  }
  console.log('');
  console.log(`  model         : ${output.model}`);
  console.log(`  prompt_version: ${output.prompt_version}`);
  console.log(`  tokens_in     : ${output.tokens_in}`);
  console.log(`  tokens_out    : ${output.tokens_out}`);
}

main().catch((err: unknown) => {
  console.error('\nFATAL:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
