import type { Parser, ParseResult } from './types.js';

interface CodeStructure {
  comment_count: number;
}

// Regex patterns for extracting comments and docstrings from common languages.
// Intentionally simple (regex-only, no AST): covers the most common cases
// for R&DTI evidence extraction (Python, JS/TS, R).

// Python triple-quoted docstrings: """...""" or '''...'''
const PYTHON_DOCSTRING_RE = /(?:"""[\s\S]*?"""|'''[\s\S]*?''')/g;
// Python single-line comments: # ...
const PYTHON_COMMENT_RE = /^\s*#\s?(.+)$/gm;
// JavaScript/TypeScript block comments: /* ... */ and /** ... */
const JS_BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
// JavaScript/TypeScript single-line comments: // ...
const JS_LINE_COMMENT_RE = /^\s*\/\/\s?(.+)$/gm;

function extractPythonComments(source: string): string[] {
  const comments: string[] = [];

  // Extract triple-quoted docstrings
  const docstringMatches = source.matchAll(PYTHON_DOCSTRING_RE);
  for (const match of docstringMatches) {
    const inner = match[0].replace(/^"""|"""$|^'''|'''$/g, '').trim();
    if (inner.length > 0) comments.push(inner);
  }

  // Extract single-line comments (excluding shebang lines)
  const lineMatches = source.matchAll(PYTHON_COMMENT_RE);
  for (const match of lineMatches) {
    const text = match[1];
    if (text !== undefined && !text.startsWith('!')) {
      comments.push(text.trim());
    }
  }

  return comments;
}

function extractJsComments(source: string): string[] {
  const comments: string[] = [];

  // Extract block comments (/* ... */ and /** ... */)
  const blockMatches = source.matchAll(JS_BLOCK_COMMENT_RE);
  for (const match of blockMatches) {
    const inner = match[0]
      .replace(/^\/\*\*?/, '')
      .replace(/\*\/$/, '')
      .replace(/^\s*\*\s?/gm, '')
      .trim();
    if (inner.length > 0) comments.push(inner);
  }

  // Extract single-line comments
  const lineMatches = source.matchAll(JS_LINE_COMMENT_RE);
  for (const match of lineMatches) {
    const text = match[1];
    if (text !== undefined) comments.push(text.trim());
  }

  return comments;
}

// R uses the same single-line comment character as Python (#).
// extractPythonComments handles # comments for both Python and R source files.

export const codeParser: Parser = {
  supportedMimeTypes: [
    'text/x-python',
    'application/x-python-code',
    'application/javascript',
    'text/javascript',
    'text/typescript',
    'application/typescript',
    'text/x-r',
    'text/x-r-source',
  ],

  parse(buffer: Buffer): Promise<ParseResult> {
    if (buffer.length === 0) {
      return Promise.resolve({ text: '', structure: { comment_count: 0 } });
    }

    const source = buffer.toString('utf8');

    if (source.trim().length === 0) {
      return Promise.resolve({ text: '', structure: { comment_count: 0 } });
    }

    // Determine language heuristic from content (shebang or keywords).
    // Default to Python comment style if ambiguous — both Python and R use #.
    let comments: string[];

    const hasJsPatterns =
      source.includes('function ') ||
      source.includes('=>') ||
      source.includes('const ') ||
      source.includes('var ') ||
      source.includes('let ') ||
      source.includes('require(') ||
      source.includes('import {') ||
      source.includes('export ') ||
      // JS-style block comments present
      /\/\*/.test(source) ||
      /\/\//.test(source);

    const hasPythonPatterns =
      source.includes('def ') ||
      source.includes('class ') ||
      /^\s*"""/.test(source) ||
      /^\s*'''/.test(source) ||
      /^\s*#/.test(source);

    if (hasJsPatterns && !hasPythonPatterns) {
      comments = extractJsComments(source);
    } else if (hasPythonPatterns) {
      comments = extractPythonComments(source);
    } else {
      // Fallback: try both Python and JS extraction, deduplicate
      const py = extractPythonComments(source);
      const js = extractJsComments(source);
      comments = [...new Set([...py, ...js])];
    }

    const text = comments.join('\n');
    const structure: CodeStructure = { comment_count: comments.length };

    return Promise.resolve({ text, structure });
  },
};
