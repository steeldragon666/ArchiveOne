import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { codeParser } from './code.js';

const PYTHON_CODE = `#!/usr/bin/env python3
"""
Module docstring: R&D activity classifier.
Identifies eligible activities for R&DTI claims.
"""

import os
import sys

# Configuration constants
MAX_RETRIES = 3  # Maximum retry attempts

class ActivityClassifier:
    """Classifies R&D activities against ATO criteria."""

    def __init__(self, config: dict):
        # Initialize with config
        self.config = config

    def classify(self, activity: str) -> bool:
        """Return True if activity is eligible for R&DTI."""
        # Check core R&D criteria
        return len(activity) > 0


def main():
    # Entry point
    classifier = ActivityClassifier({})
    print(classifier.classify("hypothesis testing"))


if __name__ == "__main__":
    main()
`;

const JS_CODE = `// JavaScript module for document processing
// Version: 1.0.0

/**
 * Parse a document buffer into text.
 * @param {Buffer} buf - The document buffer
 * @returns {string} Extracted text
 */
function parseDoc(buf) {
  // Validate input
  if (!buf || buf.length === 0) {
    return '';
  }
  return buf.toString('utf8');
}

// Export the parser
module.exports = { parseDoc };
`;

describe('codeParser', () => {
  it('parse: extracts comments and docstrings from Python', async () => {
    const buf = Buffer.from(PYTHON_CODE, 'utf8');
    const result = await codeParser.parse(buf);

    assert.ok(typeof result.text === 'string', 'text should be a string');
    // Should contain docstring content
    assert.ok(result.text.includes('R&D activity classifier'), 'should contain module docstring');
    // Should contain single-line comments
    assert.ok(result.text.includes('Configuration constants'), 'should contain inline comments');
    // Should NOT contain implementation code
    assert.ok(!result.text.includes('import os'), 'should not contain import statements');
    assert.ok(!result.text.includes('self.config = config'), 'should not contain assignments');
  });

  it('parse: returns comment_count in structure', async () => {
    const buf = Buffer.from(PYTHON_CODE, 'utf8');
    const result = await codeParser.parse(buf);

    assert.ok(result.structure !== null, 'structure should not be null');
    const structure = result.structure as { comment_count: number };
    assert.ok(typeof structure.comment_count === 'number', 'comment_count should be a number');
    assert.ok(structure.comment_count > 0, 'should find at least some comments');
  });

  it('parse: extracts comments from JavaScript', async () => {
    const buf = Buffer.from(JS_CODE, 'utf8');
    const result = await codeParser.parse(buf);

    assert.ok(typeof result.text === 'string');
    assert.ok(result.text.includes('JavaScript module'), 'should contain single-line comment');
    assert.ok(result.text.includes('Parse a document buffer'), 'should contain JSDoc');
  });

  it('parse: handles code with no comments', async () => {
    const buf = Buffer.from('x = 1\ny = 2\nz = x + y\n', 'utf8');
    const result = await codeParser.parse(buf);

    assert.equal(result.text, '', 'no comments means empty text');
    const structure = result.structure as { comment_count: number };
    assert.equal(structure.comment_count, 0);
  });

  it('parse: handles empty buffer', async () => {
    const buf = Buffer.alloc(0);
    const result = await codeParser.parse(buf);
    assert.equal(result.text, '');
    const structure = result.structure as { comment_count: number };
    assert.equal(structure.comment_count, 0);
  });

  it('supportedMimeTypes includes common code types', () => {
    assert.ok(codeParser.supportedMimeTypes.includes('text/x-python'));
    assert.ok(codeParser.supportedMimeTypes.includes('application/javascript'));
    assert.ok(codeParser.supportedMimeTypes.includes('text/typescript'));
  });
});
