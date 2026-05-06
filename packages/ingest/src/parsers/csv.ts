import Papa from 'papaparse';
import type { Parser, ParseResult } from './types.js';

interface CsvStructure {
  data: string[][];
}

export const csvParser: Parser = {
  supportedMimeTypes: ['text/csv', 'text/comma-separated-values'],

  parse(buffer: Buffer): Promise<ParseResult> {
    const content = buffer.toString('utf8');

    if (content.trim().length === 0) {
      return Promise.resolve({ text: '', structure: { data: [] } });
    }

    const parsed = Papa.parse<string[]>(content, {
      skipEmptyLines: false,
    });

    const rows = parsed.data;
    const text = rows.map((row) => row.join('\t')).join('\n');
    const structure: CsvStructure = { data: rows };

    return Promise.resolve({ text, structure });
  },
};
