#!/usr/bin/env node
/**
 * copy-fixtures.mjs — post-build step (T-B7).
 *
 * `tsc -b` does not copy non-`.ts` files into `dist/`. The Xero
 * accounting stub (`stub-client.ts`) reads its fixtures from
 * `src/xero-accounting/fixtures/*.json` via `readFileSync` resolved
 * against `import.meta.url`. After build, `import.meta.url` is the
 * URL of `dist/xero-accounting/stub-client.js`, so we mirror the
 * `fixtures/` directory under `dist/`.
 *
 * Idempotent — overwrites existing files; safe to re-run.
 */
import { mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');

/** Resource directories that have a sibling fixtures/ dir to mirror. */
const FIXTURE_SOURCES = [
  // Add new entries here when other modules pick up fixture-based stubs.
  'xero-accounting/fixtures',
];

let copied = 0;
for (const rel of FIXTURE_SOURCES) {
  const src = resolve(pkgRoot, 'src', rel);
  const dst = resolve(pkgRoot, 'dist', rel);
  if (!statSync(src, { throwIfNoEntry: false })) {
    console.warn(`[copy-fixtures] skipped missing source: ${src}`);
    continue;
  }
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = resolve(src, entry);
    const d = resolve(dst, entry);
    const st = statSync(s);
    if (st.isFile()) {
      copyFileSync(s, d);
      copied += 1;
    }
  }
}

console.log(`[copy-fixtures] copied ${copied} file(s) to dist/`);
