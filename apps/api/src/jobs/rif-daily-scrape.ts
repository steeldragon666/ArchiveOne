/**
 * P7 Theme D Task D.9 — pg-boss registration for the RIF daily scrape.
 *
 * Follows the xero-accounting-sync pattern: exports a
 * `registerRifDailyScrapeJob` function that `server.ts` calls after
 * `getBoss()` succeeds. The handler delegates to the orchestrator
 * in `@cpa/integrations/regulatory`.
 */

import type { PgBoss } from 'pg-boss';
import { runDailyScrape } from '@cpa/integrations/regulatory';

export const RIF_DAILY_SCRAPE_JOB_NAME = 'rif-daily-scrape';
/** 03:00 AEST daily — overnight window for regulatory feed polling. */
export const RIF_DAILY_SCRAPE_CRON = '0 3 * * *';

/**
 * Register the RIF daily scrape cron with pg-boss.
 *
 * Called from server.ts after getBoss() succeeds.
 * The cron schedule uses Australia/Sydney timezone context.
 */
export async function registerRifDailyScrapeJob(boss: PgBoss): Promise<void> {
  // Register the worker FIRST so the queue row exists in pg-boss's
  // schema. boss.schedule() has a foreign key on schedule.name →
  // queue.name; calling schedule before work fails with a 23503 FK
  // violation on a fresh database where the queue hasn't been seen yet.
  await boss.work(RIF_DAILY_SCRAPE_JOB_NAME, async () => {
    const result = await runDailyScrape();
    console.log(
      `[rif-daily-scrape] sources=${result.sources_processed} inserted=${result.events_inserted} skipped=${result.events_skipped} errors=${result.errors.length}`,
    );
    return result;
  });
  await boss.schedule(RIF_DAILY_SCRAPE_JOB_NAME, RIF_DAILY_SCRAPE_CRON, null, {
    tz: 'Australia/Sydney',
  });
}
