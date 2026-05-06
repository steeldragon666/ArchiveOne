import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerParser, parseDocument } from './registry.js';
import type { ParseResult, Parser } from './types.js';

describe('parseDocument', () => {
  it('throws on unknown mimeType', async () => {
    await assert.rejects(
      () => parseDocument(Buffer.from('hello'), 'application/x-unknown-type-xyz'),
      /no registered parser/i,
    );
  });

  it('routes to registered parser', async () => {
    const fakeResult: ParseResult = { text: 'fake', structure: null };
    const fakeParser: Parser = {
      supportedMimeTypes: ['application/x-fake-test'],
      parse: (_buf: Buffer) => Promise.resolve(fakeResult),
    };
    registerParser(['application/x-fake-test'], fakeParser);

    const result = await parseDocument(Buffer.from('data'), 'application/x-fake-test');
    assert.deepEqual(result, fakeResult);
  });

  it('returns ParseResult shape', async () => {
    const result = await parseDocument(Buffer.from('data'), 'application/x-fake-test');
    assert.ok(typeof result.text === 'string');
    assert.ok(result.structure === null || typeof result.structure === 'object');
  });
});
