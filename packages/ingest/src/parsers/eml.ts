import { simpleParser } from 'mailparser';
import type { Parser, ParseResult } from './types.js';

interface EmlStructure {
  subject: string | null;
  from: string | null;
  to: string | null;
  date: string | null;
  attachments: string[];
}

export const emlParser: Parser = {
  supportedMimeTypes: ['message/rfc822', 'application/octet-stream+eml'],

  async parse(buffer: Buffer): Promise<ParseResult> {
    if (buffer.length === 0) {
      throw new Error('EML parser: empty buffer provided — cannot parse');
    }

    let parsed: Awaited<ReturnType<typeof simpleParser>>;
    try {
      parsed = await simpleParser(buffer);
    } catch (err) {
      throw new Error(
        `EML parser: failed to parse email — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const subject = parsed.subject ?? null;
    const fromAddress = parsed.from?.text ?? null;
    const toAddress = parsed.to
      ? Array.isArray(parsed.to)
        ? parsed.to.map((a) => a.text).join(', ')
        : parsed.to.text
      : null;
    const date = parsed.date ? parsed.date.toISOString() : null;
    const attachments = (parsed.attachments ?? []).map(
      (a) => a.filename ?? a.contentType ?? 'unknown',
    );

    const textParts: string[] = [];
    if (subject !== null) textParts.push(`Subject: ${subject}`);
    if (fromAddress !== null) textParts.push(`From: ${fromAddress}`);
    if (toAddress !== null) textParts.push(`To: ${toAddress}`);
    if (parsed.text) textParts.push(parsed.text.trim());

    const text = textParts.join('\n');
    const structure: EmlStructure = {
      subject,
      from: fromAddress,
      to: toAddress,
      date,
      attachments,
    };

    return { text, structure };
  },
};
