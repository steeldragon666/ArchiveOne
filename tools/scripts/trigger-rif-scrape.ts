#!/usr/bin/env tsx
/**
 * One-off trigger for the regulatory intelligence feed scrape.
 *
 * Bypasses pg-boss's 03:00 AEST schedule so dev users can populate the
 * `regulatory_event` table on demand without waiting for the cron.
 * Calls the same `runDailyScrape()` orchestrator that the scheduled
 * job's handler invokes — see `apps/api/src/jobs/rif-daily-scrape.ts`.
 *
 * Usage (run from `tools/scripts/`):
 *   pnpm exec tsx --env-file=../../.env trigger-rif-scrape.ts
 *
 * Behaviour:
 *   - Reads `regulatory_source` for enabled rows
 *   - Fetches each source via its `parser_kind` connector
 *   - Inserts new events into `regulatory_event`, skipping duplicates
 *   - Updates `last_polled_at` and `last_polled_status` per source
 *
 * Output: a JSON-shaped summary on stdout — sources processed, events
 * inserted, events skipped (already seen), errors per source.
 */
import { runDailyScrape } from '@cpa/integrations/regulatory';

const start = Date.now();
console.log('Starting RIF scrape...');

try {
  const result = await runDailyScrape();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log('');
  console.log('=== RIF scrape complete ===');
  console.log(`Sources processed:  ${result.sources_processed}`);
  console.log(`Events inserted:    ${result.events_inserted}`);
  console.log(`Events skipped:     ${result.events_skipped}`);
  console.log(`Errors:             ${result.errors.length}`);
  console.log(`Elapsed:            ${elapsed}s`);

  if (result.errors.length > 0) {
    console.log('');
    console.log('=== Errors ===');
    for (const err of result.errors) {
      console.log(`  ${JSON.stringify(err)}`);
    }
  }

  process.exit(0);
} catch (err) {
  console.error('FATAL: scrape failed before completion');
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
}
