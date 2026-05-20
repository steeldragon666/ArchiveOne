#!/usr/bin/env tsx
/**
 * Smoke-test the narrative-summarizer agent end-to-end against Anthropic.
 *
 * Uses the Opus implementation (highest-quality narrative writing) to
 * verify the full pipeline: prompt registration, schema conversion,
 * round-trip, and Zod parse of the structured output.
 *
 * Usage:
 *   pnpm exec tsx test-narrative-summarizer.ts
 */

// MUST be first import — force-load .env values.
import '../../apps/api/src/force-env.js';

import { OpusNarrativeSummarizer } from '../../packages/agents/src/narrative-summarizer/opus.js';

async function main(): Promise<void> {
  console.log('narrative-summarizer smoke-test');
  console.log(`  model: ${process.env['NARRATIVE_SUMMARIZER_MODEL'] ?? 'claude-opus-4-5'}`);
  console.log('');

  const summarizer = new OpusNarrativeSummarizer();

  console.log('  → calling summarize()…');
  const t0 = Date.now();
  const output = await summarizer.summarize({
    subject_tenant_name: 'AgriSense Pty Ltd',
    document_summaries: [
      {
        filename: 'research-log-sprint-11.md',
        summary:
          'Sprint 11 research log documenting XGBoost training for cloud-edge NDVI correction; ' +
          'records experiment configuration, feature set revisions, validation RMSE of 0.041, ' +
          'and ground-truth comparison across 18 Liverpool Plains sites.',
      },
      {
        filename: 'fieldwork-tour-report.docx',
        summary:
          'Nine-day field-spectrometer tour report (Sep-Oct 2025) covering 312 paired ground spectra ' +
          'captured at 18 wheat and chickpea sites in the Liverpool Plains, with daily Spectralon ' +
          'calibration and diurnal-drift resampling protocol.',
      },
    ],
    proposed_activities: [
      {
        name: 'Adaptive bias-correction for satellite-derived crop NDVI under cloud-edge contamination',
        kind: 'core',
        hypothesis:
          'A continuous CECI model derived from BRDF residuals, view angle, and cloud-adjacency ' +
          'distance can recover unbiased NDVI for Sentinel-2 pixels within 1.5 km of cloud edges.',
        confidence: 0.92,
      },
      {
        name: 'Field-spectrometer calibration tour for CECI ground-truth validation',
        kind: 'supporting',
        hypothesis:
          'Paired ground-and-satellite NDVI observations at the 18 Liverpool Plains sites provide ' +
          'the independent validation dataset required to evaluate the CECI core experiment.',
        confidence: 0.95,
      },
    ],
    proposed_invoices: [
      { vendor: 'Cloudtech Spectral Systems Pty Ltd', total_aud: 15950.0, confidence: 0.98 },
      { vendor: 'NSW Field Operations', total_aud: 4620.0, confidence: 0.96 },
      { vendor: 'ASD Inc — FieldSpec 4 Hi-Res hire', total_aud: 8400.0, confidence: 0.94 },
    ],
  });
  const elapsedMs = Date.now() - t0;

  console.log(`  ← summarize() returned in ${elapsedMs}ms`);
  console.log('');
  console.log('=== summary ===');
  console.log(`  narrative chars  : ${output.narrative.length}`);
  console.log(`  total_aud        : ${output.total_aud}`);
  console.log(`  core_count       : ${output.core_count}`);
  console.log(`  supporting_count : ${output.supporting_count}`);
  console.log(`  invoice_count    : ${output.invoice_count}`);
  console.log(`  document_count   : ${output.document_count}`);
  console.log('');
  console.log('=== narrative ===');
  console.log(output.narrative);
}

main().catch((err: unknown) => {
  console.error('\nFATAL:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
