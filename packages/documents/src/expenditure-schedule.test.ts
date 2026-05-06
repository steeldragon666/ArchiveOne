import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderExpenditureSchedulePdf,
  type ExpenditureScheduleInput,
} from './expenditure-schedule.js';

/**
 * Tests for renderExpenditureSchedulePdf — pure-function rendering.
 *
 * The PDF buffer is opaque (compressed binary), so assertions are
 * structural rather than visual:
 *   - magic bytes (`%PDF`) confirm a real PDF was emitted
 *   - empty-state paths render without throwing
 *   - determinism: changing generated_at affects output
 *   - financial totals: different amounts produce different PDFs
 *   - null activity_code and invoice_ref fall back to em-dash
 *   - multiple categories render without throwing
 */

const CLAIM_ID = '00000000-0000-4000-8000-000f40000007';

const baseInput: ExpenditureScheduleInput = {
  firm: { name: 'Test Firm Pty Ltd', abn: '12 345 678 901' },
  subject_tenant: { name: 'Acme Research Co', abn: '98 765 432 109' },
  claim: { id: CLAIM_ID, fy_year: 2025 },
  generated_at: '2025-07-01T12:00:00Z',
  content_hash_hex: 'c'.repeat(64),
  generator_version: '1.0.0',
  expenditure_lines: [
    {
      id: 'line-001',
      description: 'Senior engineer time on novel algorithm development',
      category: 'labour',
      amount: 120_000,
      rd_percent: 80,
      rd_amount: 96_000,
      activity_code: 'CA-001',
      invoice_ref: 'INV-2025-001',
      period: '2025-Q1',
    },
    {
      id: 'line-002',
      description: 'External data science contractor',
      category: 'contractor',
      amount: 50_000,
      rd_percent: 100,
      rd_amount: 50_000,
      activity_code: 'CA-001',
      invoice_ref: 'INV-2025-042',
      period: '2025-Q2',
    },
  ],
};

const PDF_MAGIC = Buffer.from('%PDF', 'ascii');

function assertIsPdf(bytes: Uint8Array): void {
  assert.ok(bytes.length > 0, 'PDF byte length must be positive');
  const head = Buffer.from(bytes.slice(0, 4));
  assert.ok(head.equals(PDF_MAGIC), `Expected %PDF magic header, got ${head.toString('utf8')}`);
}

test('renderExpenditureSchedulePdf: produces a valid PDF (magic bytes %PDF)', async () => {
  const result = await renderExpenditureSchedulePdf(baseInput);
  assertIsPdf(result);
  assert.ok(result.length > 1024, `expected >1KB, got ${result.length}`);
  assert.ok(result.length < 400_000, `expected <400KB, got ${result.length}`);
});

test('renderExpenditureSchedulePdf: empty expenditure_lines renders without throwing', async () => {
  const input: ExpenditureScheduleInput = {
    ...baseInput,
    expenditure_lines: [],
  };
  const out = await renderExpenditureSchedulePdf(input);
  assertIsPdf(out);
});

test('renderExpenditureSchedulePdf: changing generated_at affects output', async () => {
  const a = await renderExpenditureSchedulePdf(baseInput);
  const b = await renderExpenditureSchedulePdf({
    ...baseInput,
    generated_at: '2099-12-31T23:59:59.000Z',
  });
  assert.notEqual(
    Buffer.from(a).compare(Buffer.from(b)),
    0,
    'Two PDFs with different timestamps must differ',
  );
});

test('renderExpenditureSchedulePdf: totals differ with different amounts', async () => {
  const highSpend = await renderExpenditureSchedulePdf(baseInput);
  const lowSpend = await renderExpenditureSchedulePdf({
    ...baseInput,
    expenditure_lines: baseInput.expenditure_lines.map((l) => ({
      ...l,
      amount: 1,
      rd_amount: 1,
    })),
  });
  assertIsPdf(highSpend);
  assertIsPdf(lowSpend);
  assert.notEqual(
    Buffer.from(highSpend).compare(Buffer.from(lowSpend)),
    0,
    'PDF with different amounts must differ',
  );
});

test('renderExpenditureSchedulePdf: null activity_code and null invoice_ref render without throwing', async () => {
  const input: ExpenditureScheduleInput = {
    ...baseInput,
    expenditure_lines: [
      {
        id: 'line-null',
        description: 'Materials purchase with no activity or invoice ref',
        category: 'materials',
        amount: 25_000,
        rd_percent: 60,
        rd_amount: 15_000,
        activity_code: null,
        invoice_ref: null,
        period: null,
      },
    ],
  };
  const out = await renderExpenditureSchedulePdf(input);
  assertIsPdf(out);
});

test('renderExpenditureSchedulePdf: multiple categories render without throwing', async () => {
  const input: ExpenditureScheduleInput = {
    ...baseInput,
    expenditure_lines: [
      {
        id: 'line-a',
        description: 'Engineer salary',
        category: 'labour',
        amount: 80_000,
        rd_percent: 100,
        rd_amount: 80_000,
        activity_code: 'CA-001',
        invoice_ref: null,
        period: '2025-Q1',
      },
      {
        id: 'line-b',
        description: 'External contractor',
        category: 'contractor',
        amount: 30_000,
        rd_percent: 75,
        rd_amount: 22_500,
        activity_code: 'CA-002',
        invoice_ref: 'INV-CONT-01',
        period: '2025-Q2',
      },
      {
        id: 'line-c',
        description: 'Lab consumables',
        category: 'materials',
        amount: 5_000,
        rd_percent: 50,
        rd_amount: 2_500,
        activity_code: null,
        invoice_ref: 'INV-MAT-07',
        period: '2025-Q1',
      },
      {
        id: 'line-d',
        description: 'Cloud compute infrastructure',
        category: 'other',
        amount: 12_000,
        rd_percent: 90,
        rd_amount: 10_800,
        activity_code: 'SA-001',
        invoice_ref: 'INV-CLOUD-22',
        period: '2025-Q3',
      },
    ],
  };
  const out = await renderExpenditureSchedulePdf(input);
  assertIsPdf(out);
  assert.ok(out.length > 1024, `expected >1KB for multi-category PDF, got ${out.length}`);
});
