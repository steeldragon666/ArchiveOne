import mammoth from 'mammoth';
import type { Parser, ParseResult } from './types.js';

export const docxParser: Parser = {
  supportedMimeTypes: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
  ],

  async parse(buffer: Buffer): Promise<ParseResult> {
    if (buffer.length === 0) {
      throw new Error('DOCX parser: empty buffer provided — cannot parse');
    }

    let text: string;
    try {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value.trim();
    } catch (err) {
      throw new Error(
        `DOCX parser: failed to parse document — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { text, structure: null };
  },
};
