import { registerParser, parseDocument } from './registry.js';
import { pdfParser } from './pdf.js';
import { docxParser } from './docx.js';
import { xlsxParser } from './xlsx.js';
import { csvParser } from './csv.js';
import { emlParser } from './eml.js';
import { ipynbParser } from './ipynb.js';
import { codeParser } from './code.js';

// Register all built-in parsers at module load time.
registerParser([...pdfParser.supportedMimeTypes], pdfParser);
registerParser([...docxParser.supportedMimeTypes], docxParser);
registerParser([...xlsxParser.supportedMimeTypes], xlsxParser);
registerParser([...csvParser.supportedMimeTypes], csvParser);
registerParser([...emlParser.supportedMimeTypes], emlParser);
registerParser([...ipynbParser.supportedMimeTypes], ipynbParser);
registerParser([...codeParser.supportedMimeTypes], codeParser);

export { parseDocument };
export type { ParseResult } from './types.js';
export type { Parser } from './types.js';
