import type { DocumentAnalyzer, DocumentAnalyzerInput, DocumentAnalyzerOutput } from './types.js';

/**
 * Stub document analyzer for use in tests and CI environments.
 *
 * Returns a deterministic empty result (no activities, no invoices) so
 * tests can exercise the extraction pipeline without an API key.
 */
export class StubDocumentAnalyzer implements DocumentAnalyzer {
  // eslint-disable-next-line @typescript-eslint/require-await
  async analyze(input: DocumentAnalyzerInput): Promise<DocumentAnalyzerOutput> {
    return {
      activities: [],
      invoices: [],
      document_summary: `Stub analyzer: ${input.filename} (${input.mime_type}, ${input.raw_text.length} chars). No proposals generated in stub mode.`,
    };
  }
}
