#!/usr/bin/env tsx
/**
 * Eval driver — classify every EXPENDITURE_INGESTED event in the
 * bulk-claims c0a2* namespace through the configured Classifier (Haiku
 * when CLASSIFIER_IMPL=haiku + ANTHROPIC_API_KEY set, deterministic stub
 * otherwise). The model decides whether each transaction is R&D-related
 * (any non-INELIGIBLE kind) or ordinary business (INELIGIBLE).
 *
 *   pnpm exec tsx --env-file=../../.env eval-bulk-classify-expenditures.ts [--concurrency=3]
 *
 * Why feed expenditures through the same classifier as notes:
 *   - The platform doesn't ship a dedicated "is this expenditure R&D?"
 *     agent. The closest things are the mapping-rule engine (needs
 *     hand-built rules) and the auto-allocator (needs activities to
 *     already exist — Agent B's job). For an end-to-end eval against
 *     the rd_band_hint ground truth, the simplest substitute is to
 *     synthesise a short text snippet per transaction (vendor + amount
 *     + reference + date) and run it through Agent A.
 *   - Output kind == 'INELIGIBLE' → predicted non-R&D
 *   - Output kind ∈ { SUPPORTING, EXPENDITURE_NOTE, HYPOTHESIS, ... }
 *     → predicted R&D-related
 *
 * Skips events that already have a non-null classification, so a
 * partial run interrupted by rate limits is resumable.
 */
import { parseArgs } from 'node:util';
import { makeClassifier } from '@cpa/agents/classifier';
import { privilegedSql, sql } from '@cpa/db/client';

const { values } = parseArgs({
  options: {
    concurrency: { type: 'string', default: '3' },
    tenant: { type: 'string' },
  },
});
const CONCURRENCY = Math.max(1, Math.min(64, Number(values.concurrency ?? '3') || 3));
const TENANT_FILTER = values.tenant;

interface ExpEventRow {
  id: string;
  tenant_id: string;
  payload: {
    vendor_name?: string;
    reference?: string | null;
    total_amount?: string;
    currency?: string;
    source?: string;
    rd_band_hint?: string;
  };
}

async function loadRows(): Promise<ExpEventRow[]> {
  if (TENANT_FILTER) {
    return await privilegedSql<ExpEventRow[]>`
      SELECT id::text, tenant_id::text, payload
      FROM event
      WHERE tenant_id = ${TENANT_FILTER}
        AND kind = 'EXPENDITURE_INGESTED'
        AND classification IS NULL
    `;
  }
  return await privilegedSql<ExpEventRow[]>`
    SELECT id::text, tenant_id::text, payload
    FROM event
    WHERE tenant_id::text LIKE '00000000-0000-4000-8000-c0a2%'
      AND kind = 'EXPENDITURE_INGESTED'
      AND classification IS NULL
  `;
}

function synthesiseSnippet(row: ExpEventRow): string {
  const p = row.payload;
  const vendor = p.vendor_name ?? '(unknown vendor)';
  const ref = p.reference ?? '(no reference)';
  const amt = p.total_amount ?? '0.00';
  const cur = p.currency ?? 'AUD';
  const src =
    p.source === 'xero_invoice'
      ? 'Xero invoice'
      : p.source === 'xero_bank_tx'
        ? 'Xero bank transaction'
        : p.source === 'xero_receipt'
          ? 'Xero receipt'
          : (p.source ?? 'manual entry');
  return (
    `${src} from ${vendor}. ` +
    `Reference: ${ref}. ` +
    `Amount: ${cur} $${amt}. ` +
    `Classify whether this transaction relates to an R&D experimentation activity ` +
    `(eligible) or ordinary business operations (INELIGIBLE).`
  );
}

async function processOne(
  classifier: ReturnType<typeof makeClassifier>,
  ev: ExpEventRow,
): Promise<{ id: string; kind: string } | { id: string; err: string }> {
  try {
    const text = synthesiseSnippet(ev);
    const result = await classifier.classify({ raw_text: text });
    await privilegedSql`
      UPDATE event
         SET classification = ${JSON.stringify(result)}::text::jsonb
       WHERE id = ${ev.id}
    `;
    return { id: ev.id, kind: result.kind };
  } catch (err) {
    return {
      id: ev.id,
      err: err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120),
    };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
  onResult: (r: R, i: number) => void,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i]!;
      const r = await fn(item, i);
      onResult(r, i);
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const impl = process.env['CLASSIFIER_IMPL'] ?? 'stub';
  const keySet = Boolean(process.env['ANTHROPIC_API_KEY']);
  process.stdout.write(
    `Eval expenditure classifier: impl=${impl}  ANTHROPIC_API_KEY=${keySet ? 'set' : 'unset'}  concurrency=${CONCURRENCY}\n`,
  );

  const classifier = makeClassifier();
  const rows = await loadRows();
  process.stdout.write(`Found ${rows.length} unclassified EXPENDITURE_INGESTED events\n\n`);
  if (rows.length === 0) {
    process.stdout.write('Nothing to do.\n');
    return;
  }

  const t0 = Date.now();
  const kindTally: Record<string, number> = {};
  let okCount = 0;
  let errCount = 0;
  let lastReport = Date.now();

  await runWithConcurrency(
    rows,
    CONCURRENCY,
    (r) => processOne(classifier, r),
    (r) => {
      if ('err' in r) {
        errCount += 1;
        process.stderr.write(`  ERR ${r.id.slice(0, 8)}  ${r.err}\n`);
      } else {
        okCount += 1;
        kindTally[r.kind] = (kindTally[r.kind] ?? 0) + 1;
      }
      if (Date.now() - lastReport > 2000) {
        const done = okCount + errCount;
        const rate = done / ((Date.now() - t0) / 1000);
        const eta = ((rows.length - done) / Math.max(rate, 0.01)).toFixed(0);
        process.stdout.write(
          `  progress ${done}/${rows.length}  ok=${okCount}  err=${errCount}  ${rate.toFixed(1)}/s  eta ${eta}s\n`,
        );
        lastReport = Date.now();
      }
    },
  );

  const elapsed = (Date.now() - t0) / 1000;
  process.stdout.write(
    `\nDone in ${elapsed.toFixed(1)}s · ${okCount} classified · ${errCount} errors\n`,
  );
  const kinds = Object.entries(kindTally).sort((a, b) => b[1] - a[1]);
  process.stdout.write('Kind distribution:\n');
  for (const [k, v] of kinds) {
    process.stdout.write(`  ${k.padEnd(28)} ${v}\n`);
  }
}

main()
  .then(async () => {
    await sql.end();
    await privilegedSql.end();
    process.exit(0);
  })
  .catch(async (err) => {
    process.stderr.write(
      `FAIL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    try {
      await sql.end();
      await privilegedSql.end();
    } catch {
      // best-effort
    }
    process.exit(2);
  });
