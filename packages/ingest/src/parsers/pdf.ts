import pdfParse from 'pdf-parse';
import type { Parser, ParseResult } from './types.js';

const OCR_THRESHOLD = 100;

async function ocrFallback(buffer: Buffer): Promise<string> {
  // Dynamically import tesseract.js to avoid loading it at module initialisation
  // time (the WASM worker is heavy and is only needed for scanned PDFs).
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(buffer);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

export const pdfParser: Parser = {
  supportedMimeTypes: ['application/pdf'],

  async parse(buffer: Buffer): Promise<ParseResult> {
    if (buffer.length === 0) {
      throw new Error('PDF parser: empty buffer provided — cannot parse');
    }

    let text: string;
    try {
      // pdfjs (used internally by pdf-parse) stores the input as this.bytes and
      // passes this.bytes.buffer to makeSubStream. For a Node.js Buffer that
      // shares a pool ArrayBuffer, this.bytes.buffer refers to the 8 KiB pool,
      // so substream offsets point into the wrong region.
      //
      // Wrapping in Uint8Array.from() produces a plain Uint8Array backed by its
      // own ArrayBuffer (byteOffset=0, byteLength=buffer.length), which pdfjs
      // accesses correctly at the expected byte offsets.
      //
      // The @types/pdf-parse signature says Buffer, but the runtime accepts any
      // Uint8Array — we cast to satisfy TypeScript.
      const safeInput = Uint8Array.from(buffer) as unknown as Buffer;
      const result = await pdfParse(safeInput);
      text = result.text.trim();
    } catch (err) {
      throw new Error(
        `PDF parser: failed to parse document — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (text.length < OCR_THRESHOLD) {
      // Scanned PDF detected — fall back to OCR.
      try {
        const ocrText = await ocrFallback(buffer);
        text = ocrText.trim();
      } catch (_ocrErr) {
        // OCR failed; return whatever pdf-parse extracted (possibly empty).
      }
    }

    return { text, structure: null };
  },
};
