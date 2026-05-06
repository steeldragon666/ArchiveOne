import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { csvParser } from './csv.js';

const SAMPLE_CSV = 'name,amount,date\nAcme Corp,50000,2024-01-15\nGlobex,120000,2024-02-20\n';

describe('csvParser', () => {
  it('parse: returns text and structure', async () => {
    const buf = Buffer.from(SAMPLE_CSV, 'utf8');
    const result = await csvParser.parse(buf);

    assert.ok(typeof result.text === 'string', 'text should be a string');
    assert.ok(result.text.includes('Acme Corp'), 'text should contain row data');
    assert.ok(result.text.includes('120000'), 'text should contain numeric data');

    assert.ok(result.structure !== null, 'structure should not be null');
    const structure = result.structure as { data: unknown[][] };
    assert.ok(Array.isArray(structure.data), 'structure.data should be an array');
    // Header row + 2 data rows = 3 rows (papaparse may include empty trailing row)
    assert.ok(structure.data.length >= 3, 'should have at least 3 rows');
  });

  it('parse: handles empty CSV', async () => {
    const buf = Buffer.from('', 'utf8');
    const result = await csvParser.parse(buf);
    assert.equal(result.text, '', 'empty CSV should return empty text');
    assert.ok(result.structure !== null, 'structure should still be present');
    const structure = result.structure as { data: unknown[][] };
    assert.ok(Array.isArray(structure.data));
  });

  it('parse: handles header-only CSV', async () => {
    const buf = Buffer.from('col1,col2,col3\n', 'utf8');
    const result = await csvParser.parse(buf);
    assert.ok(typeof result.text === 'string');
    const structure = result.structure as { data: unknown[][] };
    assert.ok(structure.data.length >= 1);
  });

  it('supportedMimeTypes includes text/csv', () => {
    assert.ok(csvParser.supportedMimeTypes.includes('text/csv'));
  });
});
