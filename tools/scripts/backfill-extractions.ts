#!/usr/bin/env tsx
/**
 * One-off script: queue document-extraction jobs for all existing file-upload
 * events for a given tenant.
 *
 * Context: Document content extraction was added with client-side text
 * extraction (mammoth/pdfjs/xlsx in the browser). Existing uploads were made
 * before this feature shipped — they contain only metadata (filename, size,
 * SHA-256) and NOT extracted text. Backfill is therefore impossible without
 * re-upload of the original file bytes.
 *
 * This script identifies which events are FILE UPLOAD events that have
 * extracted text in their payload (i.e. the "Extracted-Text:" section is
 * present) and queues them for the document-analyzer if not already
 * processed. Events without extracted text are reported but NOT queued
 * (the analyzer would produce a "no_extracted_text" failed result
 * which is not useful).
 *
 * Usage:
 *   pnpm exec tsx --env-file-if-exists=../../.env backfill-extractions.ts \
 *     --tenant-id=<uuid>
 *
 * Options:
 *   --tenant-id   Required. The firm's tenant UUID.
 *   --dry-run     Log what would be queued without actually queuing.
 *   --force       Re-queue events even if extraction_status='complete'.
 *
 * NOTE: This script requires the API server to be running (it queues via
 * pg-boss which the API process manages) OR you can run it with the
 * SKIP_PGBOSS_REGISTER flag and it will update extraction_status directly.
 * Prefer re-uploading files through the consultant portal where possible —
 * the client-side extractor produces richer text than a server-side fallback.
 */
import fs from 'node:fs';
import path from 'node:path';
import { privilegedSql } from '@cpa/db/client';

// Force-load .env (override any shell-leaked empty values)
for (const p of [path.resolve(process.cwd(), '../../.env'), path.resolve(process.cwd(), '.env')]) {
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  break;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
for (const arg of args) {
  if (arg.startsWith('--')) {
    const [k, v] = arg.slice(2).split('=');
    if (k) flags[k] = v !== undefined ? v : true;
  }
}

const TENANT_ID = flags['tenant-id'] as string | undefined;
const DRY_RUN = flags['dry-run'] === true;
const FORCE = flags['force'] === true;

if (!TENANT_ID) {
  console.error('Usage: backfill-extractions.ts --tenant-id=<uuid> [--dry-run] [--force]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface EventRow {
  id: string;
  subject_tenant_id: string;
  payload: { raw_text?: string };
  extraction_status: string | null;
}

async function main(): Promise<void> {
  console.log(`Backfill extractions for tenant ${TENANT_ID}`);
  if (DRY_RUN) console.log('DRY RUN — no writes');

  const rows = await privilegedSql<EventRow[]>`
    SELECT id, subject_tenant_id, payload, extraction_status
      FROM event
     WHERE tenant_id = ${TENANT_ID!}::uuid
       AND payload::text LIKE '%[FILE UPLOAD]%'
     ORDER BY captured_at ASC
  `;

  console.log(`Found ${rows.length} file-upload events`);

  let withText = 0;
  let withoutText = 0;
  let alreadyComplete = 0;
  let queued = 0;

  for (const row of rows) {
    const rawText = row.payload?.raw_text ?? '';
    const hasExtractedText = rawText.includes('Extracted-Text:');

    if (!hasExtractedText) {
      withoutText++;
      console.log(
        `  SKIP (no extracted text) event=${row.id} — re-upload the file through the portal to enable extraction`,
      );
      continue;
    }

    withText++;

    if (!FORCE && row.extraction_status === 'complete') {
      alreadyComplete++;
      console.log(`  SKIP (already complete) event=${row.id}`);
      continue;
    }

    console.log(
      `  ${DRY_RUN ? 'WOULD QUEUE' : 'QUEUING'} event=${row.id} (status=${row.extraction_status ?? 'null'})`,
    );

    if (!DRY_RUN) {
      // Set extraction_status='pending' directly; the API pg-boss worker
      // will pick it up when polled, OR you can call
      // POST /v1/events/:id/extract-content via the API for explicit queueing.
      await privilegedSql`
        UPDATE event
           SET extraction_status = 'pending'
         WHERE id        = ${row.id}::uuid
           AND tenant_id = ${TENANT_ID!}::uuid
      `;
      queued++;
    }
  }

  console.log('\nSummary:');
  console.log(`  File-upload events found:   ${rows.length}`);
  console.log(`  With extracted text:        ${withText}`);
  console.log(`  Without extracted text:     ${withoutText} (re-upload required)`);
  console.log(`  Already complete (skipped): ${alreadyComplete}`);
  console.log(`  Queued for extraction:      ${DRY_RUN ? '(dry-run)' : queued}`);

  if (withoutText > 0) {
    console.log(
      '\nNOTE: Events without extracted text cannot be backfilled automatically.',
      'Ask consultants to re-upload the original files through the portal.',
      'The updated upload flow extracts text client-side (DOCX/PDF/XLSX) before hashing.',
    );
  }

  await privilegedSql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
