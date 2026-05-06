export interface ParseResult {
  text: string;
  structure: object | null;
}

export type Parser = {
  parse(buffer: Buffer): Promise<ParseResult>;
  supportedMimeTypes: readonly string[];
};
