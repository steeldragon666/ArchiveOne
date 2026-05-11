/**
 * Force-load .env values, OVERRIDING any pre-existing process.env keys.
 *
 * Why this exists: Node's `--env-file` flag refuses to overwrite a key
 * that's already in `process.env`. On Windows dev machines, several
 * Anthropic-related plugins (Claude Desktop, MCP runtimes, IDE
 * integrations) sometimes inject `ANTHROPIC_API_KEY=""` into the user's
 * environment. The empty string from those tools then wins over the
 * real key in `apps/cpa-platform/.env`, breaking the Haiku classifier
 * with `ANTHROPIC_API_KEY required`.
 *
 * This shim reads `.env` directly and force-sets `process.env`, so
 * the file always wins over shell-leaked values.
 *
 * Imported before any other module so its side effect runs first.
 */
import fs from 'node:fs';
import path from 'node:path';

const ENV_PATHS = [
  // From apps/api when invoked as `pnpm --filter @cpa/api dev`
  path.resolve(process.cwd(), '../../.env'),
  // From the repo root, also possible
  path.resolve(process.cwd(), '.env'),
];

for (const p of ENV_PATHS) {
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    // Strip optional surrounding quotes (`"...".`)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Override existing — that's the whole point of this shim.
    process.env[key] = value;
  }
  break; // first file found wins
}
