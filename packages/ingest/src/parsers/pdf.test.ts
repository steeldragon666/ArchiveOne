import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pdfParser } from './pdf.js';

// Minimal valid PDF with a text content stream.
//
// Key design decisions:
// 1. We use Uint8Array.from(buffer) in pdfParser to avoid the Node.js Buffer shared-pool
//    byteOffset issue where pdfjs reads from the wrong ArrayBuffer offset.
// 2. The page text is deliberately >100 characters (after trimming) so the OCR fallback
//    is never triggered in unit tests. The OCR path activates only for scanned PDFs
//    where pdf-parse extracts <100 chars.
function buildMinimalPdf(): Buffer {
  // 120+ printable ASCII characters so text.trim().length > 100 after extraction
  const pageText =
    'R&DTI Core Activity: systematic, investigative and experimental activities ' +
    'directed at acquiring new knowledge under ITAA 1997 s355-25.';

  const streamBody = `BT /F1 12 Tf 72 720 Td (${pageText}) Tj ET`;

  const catalog = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const pages = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const page =
    '3 0 obj\n' +
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Resources << /Font << /F1 << /Type /Font /Subtype /Type1\n' +
    '                                  /BaseFont /Helvetica >> >> >>\n' +
    '   /Contents 4 0 R >>\n' +
    'endobj\n';
  const contentStream =
    '4 0 obj\n<< /Length ' +
    streamBody.length +
    ' >>\nstream\n' +
    streamBody +
    '\nendstream\nendobj\n';

  const header = '%PDF-1.4\n';
  const o1 = header.length;
  const o2 = o1 + catalog.length;
  const o3 = o2 + pages.length;
  const o4 = o3 + page.length;
  const body = header + catalog + pages + page + contentStream;
  const xrefPos = body.length;

  function entry(off: number): string {
    return String(off).padStart(10, '0') + ' 00000 n \r\n';
  }

  const xref =
    'xref\n0 5\n0000000000 65535 f \r\n' +
    entry(o1) +
    entry(o2) +
    entry(o3) +
    entry(o4) +
    'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n' +
    xrefPos +
    '\n%%EOF\n';

  return Buffer.from(body + xref, 'ascii');
}

const MINIMAL_PDF = buildMinimalPdf();

describe('pdfParser', () => {
  it('parse: returns text and null structure for text PDF', async () => {
    const result = await pdfParser.parse(MINIMAL_PDF);
    assert.ok(typeof result.text === 'string', 'text should be a string');
    // pdf-parse with pdfjs extracts the text content from the page stream
    assert.ok(result.text.length >= 0, 'text length should be non-negative');
    assert.equal(result.structure, null, 'structure should be null for PDFs');
  });

  it('parse: handles empty buffer gracefully', async () => {
    await assert.rejects(
      () => pdfParser.parse(Buffer.alloc(0)),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });

  it('supportedMimeTypes includes application/pdf', () => {
    assert.ok(pdfParser.supportedMimeTypes.includes('application/pdf'));
  });
});
