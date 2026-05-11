/**
 * Client-side document text extraction.
 *
 * Chosen strategy: extract text in the browser BEFORE the SHA-256 step.
 * This means the API receives `raw_text` that includes actual document
 * content (not just metadata), so the classifier reads real hypothesis/
 * invoice text from upload event #1 rather than seeing only the filename.
 *
 * Libraries used:
 *   - mammoth@1.8: DOCX/DOC → plain text (browser ESM build)
 *   - pdfjs-dist@4.10: PDF → plain text (browser build, no canvas needed)
 *   - xlsx@0.18: XLSX/XLS/CSV → plain text (browser build)
 *
 * All three run entirely in the browser — no server round-trip, no binary
 * upload needed. The extracted text is capped at 15 000 chars before being
 * embedded in the raw_text event payload so the chain event stays within
 * the 10 000-char createEventBody limit. If extraction fails or the library
 * is not available for the file type, we return null and the upload proceeds
 * with metadata-only as before.
 */

/** Maximum characters of extracted text to include in the upload payload. */
const MAX_EXTRACTED_CHARS = 8_000;

/**
 * Extract plain text from a File object.
 *
 * Returns extracted text (possibly truncated) or null if:
 *   - The file type is not supported (no extractor registered).
 *   - Extraction throws (e.g. password-protected PDF, corrupt DOCX).
 *
 * Never throws — errors are caught and null returned so callers can fall
 * back to metadata-only upload.
 */
export async function extractTextFromFile(file: File): Promise<string | null> {
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.docx') || name.endsWith('.doc')) {
      return await extractDocx(file);
    }
    if (name.endsWith('.pdf')) {
      return await extractPdf(file);
    }
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
      return await extractXlsx(file);
    }
    if (name.endsWith('.txt') || name.endsWith('.md')) {
      return await extractPlainText(file);
    }
    return null;
  } catch {
    // Extraction failure is non-fatal — upload continues with metadata only.
    return null;
  }
}

// ---------------------------------------------------------------------------
// DOCX extractor — mammoth
// ---------------------------------------------------------------------------

async function extractDocx(file: File): Promise<string | null> {
  // Dynamic import so mammoth is only loaded when a DOCX is being processed.
  // This keeps the initial JS bundle small.
  const mammoth = await import('mammoth');
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  const text = result.value.trim();
  return text.length > 0 ? truncate(text) : null;
}

// ---------------------------------------------------------------------------
// PDF extractor — pdfjs-dist
// ---------------------------------------------------------------------------

async function extractPdf(file: File): Promise<string | null> {
  const pdfjsLib = await import('pdfjs-dist');
  // Set up the worker source for pdfjs. We use the CDN build path that
  // Next.js will serve from the node_modules copy via next.config.
  // If the worker URL can't be set, pdfjs falls back to a fake worker
  // (slower but functional for text extraction).
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    // Use the legacy build which doesn't require a separate worker file.
    // This works in the browser without needing to configure a worker URL.
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  }

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  const maxPages = Math.min(pdf.numPages, 50); // cap at 50 pages
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter(
        (item): item is { str: string; hasEOL: boolean } & typeof item =>
          'str' in item && typeof (item as { str: unknown }).str === 'string',
      )
      .map((item) => {
        const i = item as unknown as { str: string; hasEOL?: boolean };
        return i.str + (i.hasEOL ? '\n' : ' ');
      })
      .join('')
      .trim();
    if (pageText) pages.push(pageText);
  }
  const text = pages.join('\n\n').trim();
  return text.length > 0 ? truncate(text) : null;
}

// ---------------------------------------------------------------------------
// XLSX/XLS/CSV extractor — xlsx
// ---------------------------------------------------------------------------

async function extractXlsx(file: File): Promise<string | null> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: 'array' });
  const lines: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    // Convert sheet to CSV so the AI sees a structured text representation
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) {
      lines.push(`=== Sheet: ${sheetName} ===`);
      lines.push(csv);
    }
  }
  const text = lines.join('\n').trim();
  return text.length > 0 ? truncate(text) : null;
}

// ---------------------------------------------------------------------------
// Plain text extractor — FileReader
// ---------------------------------------------------------------------------

async function extractPlainText(file: File): Promise<string | null> {
  const text = await file.text();
  const trimmed = text.trim();
  return trimmed.length > 0 ? truncate(trimmed) : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string): string {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return (
    text.slice(0, MAX_EXTRACTED_CHARS) +
    `\n\n[Extracted text truncated at ${MAX_EXTRACTED_CHARS} chars; full document is ${text.length} chars]`
  );
}
