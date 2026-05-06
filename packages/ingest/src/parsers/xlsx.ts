import * as XLSX from 'xlsx';
import type { Parser, ParseResult } from './types.js';

interface XlsxStructure {
  sheets: Record<string, unknown[][]>;
}

export const xlsxParser: Parser = {
  supportedMimeTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ],

  parse(buffer: Buffer): Promise<ParseResult> {
    if (buffer.length === 0) {
      return Promise.reject(new Error('XLSX parser: empty buffer provided — cannot parse'));
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch (err) {
      return Promise.reject(
        new Error(
          `XLSX parser: failed to parse workbook — ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    const structure: XlsxStructure = { sheets: {} };
    const textParts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (sheet === undefined) continue;

      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
      structure.sheets[sheetName] = rows;

      const rowTexts = rows.map((row) => row.join('\t'));
      textParts.push(...rowTexts);
    }

    const text = textParts.join('\n');
    return Promise.resolve({ text, structure });
  },
};
