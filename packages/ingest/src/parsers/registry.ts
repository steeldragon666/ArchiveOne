import type { Parser, ParseResult } from './types.js';

const registry = new Map<string, Parser>();

export function registerParser(mimeTypes: string[], parser: Parser): void {
  for (const mimeType of mimeTypes) {
    registry.set(mimeType, parser);
  }
}

export async function parseDocument(buffer: Buffer, mimeType: string): Promise<ParseResult> {
  const parser = registry.get(mimeType);
  if (parser === undefined) {
    throw new Error(`No registered parser for MIME type: ${mimeType}`);
  }
  return parser.parse(buffer);
}
