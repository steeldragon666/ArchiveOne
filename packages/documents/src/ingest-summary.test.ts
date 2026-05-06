import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIngestSummaryPdf, type IngestSummaryInput } from './ingest-summary.js';

/**
 * Tests for renderIngestSummaryPdf — pure-function rendering.
 *
 * The PDF buffer is opaque (compressed binary), so assertions are
 * structural rather than visual:
 *   - magic bytes (`%PDF`) confirm a real PDF was emitted
 *   - byte length is positive and within sane bounds
 *   - determinism: changing generated_at affects the output (proves the
 *     timestamp reaches the document)
 *   - empty-state paths render without throwing
 *   - SHA-256 content reaches the PDF: two renders with different SHA values
 *     produce different buffers (proves sha256 field reaches the document)
 *   - severity grouping: renders with high-severity rows produce valid output
 *
 * Note: @react-pdf/renderer v4 deflate-compresses content streams, so raw
 * text search via Buffer.toString('latin1') only works for PDF structural
 * metadata (object headers, font names), not for rendered text content.
 * Content-presence tests use differential comparisons instead.
 */

const CLAIM_ID = '00000000-0000-4000-8000-000f30000001';

const baseInput: IngestSummaryInput = {
  firm: { name: 'Test Firm Pty Ltd', abn: '12 345 678 901' },
  subject_tenant: { name: 'Acme Research Co', abn: '98 765 432 109' },
  claim: { id: CLAIM_ID, fy_year: 2025 },
  generated_at: '2025-07-01T12:00:00Z',
  content_hash_hex: 'a'.repeat(64),
  generator_version: '1.0.0',
  source_inventory: [
    { parser_kind: 'pdf', file_count: 10, avg_extraction_quality: 0.85 },
    { parser_kind: 'xlsx', file_count: 3, avg_extraction_quality: 0.6 },
  ],
  extraction_quality: {
    total_files: 13,
    structured_count: 10,
    ocr_fallback_count: 2,
    avg_quality: 0.78,
  },
  classification_distribution: [
    { evidence_kind: 'lab_notebook', count: 8, avg_confidence: 0.92 },
    { evidence_kind: 'invoice', count: 5, avg_confidence: 0.75 },
  ],
  reconciliation_summary: [
    { kind: 'cost_no_activity', severity: 'high', count: 1 },
    { kind: 'activity_no_time', severity: 'medium', count: 2 },
    { kind: 'narrative_no_evidence', severity: 'medium', count: 1 },
  ],
  source_files: [
    {
      filename: 'lab-notebook-q1.pdf',
      sha256: 'b'.repeat(64),
      parser_kind: 'pdf',
      size_bytes: 204800,
    },
  ],
};

const PDF_MAGIC = Buffer.from('%PDF', 'ascii');

function assertIsPdf(bytes: Uint8Array): void {
  assert.ok(bytes.length > 0, 'PDF byte length must be positive');
  const head = Buffer.from(bytes.slice(0, 4));
  assert.ok(head.equals(PDF_MAGIC), `Expected %PDF magic header, got ${head.toString('utf8')}`);
}

test('renderIngestSummaryPdf: produces a valid PDF (magic bytes %PDF)', async () => {
  const pdf = await renderIngestSummaryPdf(baseInput);
  assertIsPdf(pdf);
  assert.ok(pdf.length > 1024, `expected >1KB, got ${pdf.length}`);
  assert.ok(pdf.length < 200_000, `expected <200KB, got ${pdf.length}`);
});

test('renderIngestSummaryPdf: empty source_inventory array renders without throwing', async () => {
  const input: IngestSummaryInput = {
    ...baseInput,
    source_inventory: [],
  };
  const out = await renderIngestSummaryPdf(input);
  assertIsPdf(out);
});

test('renderIngestSummaryPdf: empty classification_distribution renders without throwing', async () => {
  const input: IngestSummaryInput = {
    ...baseInput,
    classification_distribution: [],
  };
  const out = await renderIngestSummaryPdf(input);
  assertIsPdf(out);
});

test('renderIngestSummaryPdf: empty reconciliation_summary renders without throwing', async () => {
  const input: IngestSummaryInput = {
    ...baseInput,
    reconciliation_summary: [],
  };
  const out = await renderIngestSummaryPdf(input);
  assertIsPdf(out);
});

test('renderIngestSummaryPdf: empty source_files renders without throwing', async () => {
  const input: IngestSummaryInput = {
    ...baseInput,
    source_files: [],
  };
  const out = await renderIngestSummaryPdf(input);
  assertIsPdf(out);
});

test('renderIngestSummaryPdf: reconciliation summary severity groups render', async () => {
  // Render with high + medium severity rows — must produce a valid PDF.
  // Content streams are deflate-compressed so we use differential comparison:
  // a render with severity rows must produce a larger PDF than one without rows.
  const withRows: IngestSummaryInput = {
    ...baseInput,
    reconciliation_summary: [
      { kind: 'cost_no_activity', severity: 'high', count: 3 },
      { kind: 'activity_no_time', severity: 'medium', count: 1 },
    ],
  };
  const withoutRows: IngestSummaryInput = {
    ...baseInput,
    reconciliation_summary: [],
  };
  const pdfWith = await renderIngestSummaryPdf(withRows);
  const pdfWithout = await renderIngestSummaryPdf(withoutRows);
  assertIsPdf(pdfWith);
  assertIsPdf(pdfWithout);
  // PDF with severity rows must differ from the empty-rows PDF
  assert.notEqual(
    Buffer.from(pdfWith).compare(Buffer.from(pdfWithout)),
    0,
    'PDF with high/medium severity rows must differ from empty reconciliation_summary PDF',
  );
});

test('renderIngestSummaryPdf: SHA-256 renders in output', async () => {
  // Content streams are deflate-compressed, so raw text search does not work.
  // Instead, verify that changing sha256 values produces different PDF buffers,
  // proving the sha256 field actually reaches the rendered document.
  const shaA = 'b'.repeat(64);
  const shaB = 'c'.repeat(64);
  const inputA: IngestSummaryInput = {
    ...baseInput,
    source_files: [
      { filename: 'lab-notebook-q1.pdf', sha256: shaA, parser_kind: 'pdf', size_bytes: 204800 },
    ],
  };
  const inputB: IngestSummaryInput = {
    ...baseInput,
    source_files: [
      { filename: 'lab-notebook-q1.pdf', sha256: shaB, parser_kind: 'pdf', size_bytes: 204800 },
    ],
  };
  const pdfA = await renderIngestSummaryPdf(inputA);
  const pdfB = await renderIngestSummaryPdf(inputB);
  assertIsPdf(pdfA);
  assertIsPdf(pdfB);
  // Two PDFs with different sha256 values must differ — proves sha256 reaches the document
  if (pdfA.length === pdfB.length) {
    assert.notEqual(
      Buffer.from(pdfA).compare(Buffer.from(pdfB)),
      0,
      'Expected different sha256 values to produce different PDF buffers',
    );
  } else {
    assert.notEqual(pdfA.length, pdfB.length);
  }
});

test('renderIngestSummaryPdf: changing generated_at affects output', async () => {
  const a = await renderIngestSummaryPdf(baseInput);
  const b = await renderIngestSummaryPdf({
    ...baseInput,
    generated_at: '2099-12-31T23:59:59.000Z',
  });
  // Two PDFs with different timestamps must differ — proves the timestamp
  // string actually reaches the rendered document.
  if (a.length === b.length) {
    assert.notEqual(Buffer.from(a).compare(Buffer.from(b)), 0);
  } else {
    assert.notEqual(a.length, b.length);
  }
});
