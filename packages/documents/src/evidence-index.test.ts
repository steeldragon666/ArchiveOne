import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEvidenceIndexPdf, type EvidenceIndexInput } from './evidence-index.js';

/**
 * Tests for renderEvidenceIndexPdf — pure-function rendering.
 *
 * The PDF buffer is opaque (compressed binary), so assertions are
 * structural rather than visual:
 *   - magic bytes (`%PDF`) confirm a real PDF was emitted
 *   - empty-state paths render without throwing
 *   - determinism: changing generated_at affects output
 *   - empty activity_codes array falls back to em-dash
 *   - multiple evidence kinds render without throwing
 *   - large evidence list (50 items) renders without throwing
 */

const CLAIM_ID = '00000000-0000-4000-8000-000f40000008';

const baseItem = {
  id: 'ev-001',
  filename: 'lab_notebook_jan_2025.pdf',
  evidence_kind: 'lab_notebook',
  classified_confidence: 0.92,
  activity_codes: ['CA-001', 'CA-002'],
  sha256: 'a'.repeat(64),
  uploaded_at: '2025-03-15T09:30:00Z',
  size_bytes: 2_048_576,
};

const baseInput: EvidenceIndexInput = {
  firm: { name: 'Test Firm Pty Ltd', abn: '12 345 678 901' },
  subject_tenant: { name: 'Acme Research Co', abn: '98 765 432 109' },
  claim: { id: CLAIM_ID, fy_year: 2025 },
  generated_at: '2025-07-01T12:00:00Z',
  content_hash_hex: 'd'.repeat(64),
  generator_version: '1.0.0',
  evidence_items: [
    baseItem,
    {
      id: 'ev-002',
      filename: 'invoice_contractor_feb_2025.pdf',
      evidence_kind: 'invoice',
      classified_confidence: 0.85,
      activity_codes: ['CA-001'],
      sha256: 'b'.repeat(64),
      uploaded_at: '2025-04-01T14:00:00Z',
      size_bytes: 512_000,
    },
  ],
};

const PDF_MAGIC = Buffer.from('%PDF', 'ascii');

function assertIsPdf(bytes: Uint8Array): void {
  assert.ok(bytes.length > 0, 'PDF byte length must be positive');
  const head = Buffer.from(bytes.slice(0, 4));
  assert.ok(head.equals(PDF_MAGIC), `Expected %PDF magic header, got ${head.toString('utf8')}`);
}

test('renderEvidenceIndexPdf: produces a valid PDF (magic bytes %PDF)', async () => {
  const result = await renderEvidenceIndexPdf(baseInput);
  assertIsPdf(result);
  assert.ok(result.length > 1024, `expected >1KB, got ${result.length}`);
  assert.ok(result.length < 400_000, `expected <400KB, got ${result.length}`);
});

test('renderEvidenceIndexPdf: empty evidence_items renders without throwing', async () => {
  const input: EvidenceIndexInput = {
    ...baseInput,
    evidence_items: [],
  };
  const out = await renderEvidenceIndexPdf(input);
  assertIsPdf(out);
});

test('renderEvidenceIndexPdf: changing generated_at affects output', async () => {
  const a = await renderEvidenceIndexPdf(baseInput);
  const b = await renderEvidenceIndexPdf({
    ...baseInput,
    generated_at: '2099-12-31T23:59:59.000Z',
  });
  assert.notEqual(
    Buffer.from(a).compare(Buffer.from(b)),
    0,
    'Two PDFs with different timestamps must differ',
  );
});

test('renderEvidenceIndexPdf: empty activity_codes array renders without throwing', async () => {
  const input: EvidenceIndexInput = {
    ...baseInput,
    evidence_items: [
      {
        ...baseItem,
        id: 'ev-no-activities',
        activity_codes: [],
      },
    ],
  };
  const out = await renderEvidenceIndexPdf(input);
  assertIsPdf(out);
});

test('renderEvidenceIndexPdf: multiple evidence kinds render without throwing', async () => {
  const input: EvidenceIndexInput = {
    ...baseInput,
    evidence_items: [
      { ...baseItem, id: 'ev-a', evidence_kind: 'lab_notebook' },
      { ...baseItem, id: 'ev-b', evidence_kind: 'invoice', sha256: 'b'.repeat(64) },
      { ...baseItem, id: 'ev-c', evidence_kind: 'timesheet', sha256: 'c'.repeat(64) },
      { ...baseItem, id: 'ev-d', evidence_kind: 'email_correspondence', sha256: 'd'.repeat(64) },
      { ...baseItem, id: 'ev-e', evidence_kind: 'technical_report', sha256: 'e'.repeat(64) },
    ],
  };
  const out = await renderEvidenceIndexPdf(input);
  assertIsPdf(out);
  assert.ok(out.length > 1024, `expected >1KB for multi-kind PDF, got ${out.length}`);
});

test('renderEvidenceIndexPdf: large evidence list renders without throwing', async () => {
  const items = Array.from({ length: 50 }, (_, i) => ({
    id: `ev-${String(i).padStart(3, '0')}`,
    filename: `evidence_file_${i + 1}.pdf`,
    evidence_kind: i % 3 === 0 ? 'lab_notebook' : i % 3 === 1 ? 'invoice' : 'timesheet',
    classified_confidence: 0.7 + (i % 30) / 100,
    activity_codes: i % 5 === 0 ? [] : [`CA-${String((i % 5) + 1).padStart(3, '0')}`],
    sha256: String(i % 16).padStart(64, '0'),
    uploaded_at: `2025-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
    size_bytes: (i + 1) * 102_400,
  }));
  const input: EvidenceIndexInput = { ...baseInput, evidence_items: items };
  const out = await renderEvidenceIndexPdf(input);
  assertIsPdf(out);
  assert.ok(out.length > 1024, `expected >1KB for large evidence list, got ${out.length}`);
});
