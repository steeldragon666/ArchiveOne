import type { Parser, ParseResult } from './types.js';

interface NotebookCell {
  cell_type: string;
  source: string | string[];
}

interface Notebook {
  cells?: NotebookCell[];
}

interface IpynbStructure {
  cell_count: number;
  cell_types: string[];
}

function extractCellSource(source: string | string[]): string {
  if (Array.isArray(source)) {
    return source.join('');
  }
  return source;
}

export const ipynbParser: Parser = {
  supportedMimeTypes: ['application/x-ipynb+json', 'application/json'],

  parse(buffer: Buffer): Promise<ParseResult> {
    if (buffer.length === 0) {
      return Promise.reject(new Error('IPYNB parser: empty buffer provided — cannot parse'));
    }

    let notebook: Notebook;
    try {
      notebook = JSON.parse(buffer.toString('utf8')) as Notebook;
    } catch (err) {
      return Promise.reject(
        new Error(
          `IPYNB parser: invalid JSON — ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    const cells = notebook.cells ?? [];
    const textParts: string[] = [];
    const cellTypes: string[] = [];

    for (const cell of cells) {
      cellTypes.push(cell.cell_type);
      if (cell.cell_type === 'markdown' || cell.cell_type === 'code') {
        const source = extractCellSource(cell.source);
        if (source.trim().length > 0) {
          textParts.push(source);
        }
      }
    }

    const text = textParts.join('\n\n');
    const structure: IpynbStructure = {
      cell_count: cells.length,
      cell_types: cellTypes,
    };

    return Promise.resolve({ text, structure });
  },
};
