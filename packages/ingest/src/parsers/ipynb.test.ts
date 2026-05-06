import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ipynbParser } from './ipynb.js';

const MINIMAL_NOTEBOOK = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells: [
    {
      cell_type: 'markdown',
      source: ['# R&D Tax Analysis\n', 'This notebook explores eligibility.'],
      metadata: {},
      outputs: [],
    },
    {
      cell_type: 'code',
      source: ['import pandas as pd\n', 'df = pd.read_csv("data.csv")'],
      metadata: {},
      outputs: [],
      execution_count: null,
    },
    {
      cell_type: 'code',
      source: ['print("Hello")'],
      metadata: {},
      outputs: [],
      execution_count: 1,
    },
  ],
};

describe('ipynbParser', () => {
  it('parse: extracts cell sources', async () => {
    const buf = Buffer.from(JSON.stringify(MINIMAL_NOTEBOOK), 'utf8');
    const result = await ipynbParser.parse(buf);
    assert.ok(result.text.includes('R&D Tax Analysis'), 'should contain markdown cell content');
    assert.ok(result.text.includes('import pandas'), 'should contain code cell content');
    assert.ok(result.text.includes('print("Hello")'), 'should contain second code cell');
  });

  it('parse: counts cells correctly', async () => {
    const buf = Buffer.from(JSON.stringify(MINIMAL_NOTEBOOK), 'utf8');
    const result = await ipynbParser.parse(buf);
    assert.ok(result.structure !== null, 'structure should not be null');
    const structure = result.structure as { cell_count: number; cell_types: string[] };
    assert.equal(structure.cell_count, 3);
    assert.ok(Array.isArray(structure.cell_types));
    assert.equal(structure.cell_types.filter((t) => t === 'markdown').length, 1);
    assert.equal(structure.cell_types.filter((t) => t === 'code').length, 2);
  });

  it('parse: throws on invalid JSON', async () => {
    await assert.rejects(
      () => ipynbParser.parse(Buffer.from('not json', 'utf8')),
      /invalid|parse/i,
    );
  });

  it('supportedMimeTypes includes application/x-ipynb+json', () => {
    assert.ok(ipynbParser.supportedMimeTypes.includes('application/x-ipynb+json'));
  });
});
