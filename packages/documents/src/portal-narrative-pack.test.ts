import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderPortalNarrativePackPdf,
  type PortalNarrativePackInput,
} from './portal-narrative-pack.js';

/**
 * Tests for renderPortalNarrativePackPdf — pure-function rendering (skeleton).
 *
 * The PDF buffer is opaque (compressed binary), so assertions are
 * structural rather than visual:
 *   - magic bytes (`%PDF`) confirm a real PDF was emitted
 *   - empty narrative_sections renders without throwing
 *   - determinism: changing generated_at affects output
 */

const CLAIM_ID = '00000000-0000-4000-8000-000f60000001';

const baseInput: PortalNarrativePackInput = {
  firm: { name: 'Test Firm Pty Ltd', abn: '12 345 678 901' },
  subject_tenant: { name: 'Acme Research Co', abn: '98 765 432 109' },
  claim: { id: CLAIM_ID, fy_year: 2025 },
  generated_at: '2025-07-01T12:00:00Z',
  content_hash_hex: 'e'.repeat(64),
  generator_version: '1.0.0',
  narrative_sections: [
    {
      section_kind: 'background',
      heading: 'Background',
      content_placeholder: 'Placeholder: Background narrative content pending.',
    },
    {
      section_kind: 'technical_narrative',
      heading: 'Technical Narrative',
      content_placeholder: 'Placeholder: Technical narrative content pending.',
    },
  ],
};

const PDF_MAGIC = Buffer.from('%PDF', 'ascii');

function assertIsPdf(bytes: Uint8Array): void {
  assert.ok(bytes.length > 0, 'PDF byte length must be positive');
  const head = Buffer.from(bytes.slice(0, 4));
  assert.ok(head.equals(PDF_MAGIC), `Expected %PDF magic header, got ${head.toString('utf8')}`);
}

test('renderPortalNarrativePackPdf: produces a valid PDF (magic bytes %PDF)', async () => {
  const result = await renderPortalNarrativePackPdf(baseInput);
  assertIsPdf(result);
  assert.ok(result.length > 1024, `expected >1KB, got ${result.length}`);
  assert.ok(result.length < 400_000, `expected <400KB, got ${result.length}`);
});

test('renderPortalNarrativePackPdf: empty narrative_sections renders without throwing', async () => {
  const input: PortalNarrativePackInput = {
    ...baseInput,
    narrative_sections: [],
  };
  const out = await renderPortalNarrativePackPdf(input);
  assertIsPdf(out);
});

test('renderPortalNarrativePackPdf: changing generated_at affects output', async () => {
  const a = await renderPortalNarrativePackPdf(baseInput);
  const b = await renderPortalNarrativePackPdf({
    ...baseInput,
    generated_at: '2099-12-31T23:59:59.000Z',
  });
  assert.notEqual(
    Buffer.from(a).compare(Buffer.from(b)),
    0,
    'Two PDFs with different timestamps must differ',
  );
});
