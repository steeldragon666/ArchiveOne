/**
 * Parse the BETA_ALLOWLIST env-var format into a Set for O(1) membership.
 *
 * Format: comma-separated emails, with optional whitespace around commas.
 * Emails are lowercased + trimmed; empty entries (from double-commas or a
 * trailing comma) are dropped so editing the env var is forgiving.
 */
export function parseAllowlist(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}
