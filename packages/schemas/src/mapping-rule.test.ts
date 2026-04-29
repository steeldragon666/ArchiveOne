import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listMappingRulesQuery } from './mapping-rule.js';

// ---------------------------------------------------------------------------
// listMappingRulesQuery.enabled — pinned contract.
//
// The previous implementation used `z.coerce.boolean()`, which calls
// `Boolean(value)` and returns `true` for ANY non-empty string,
// including the literal `'false'`. That meant `?enabled=false` was
// silently rewritten to `enabled=true` and the route filtered for the
// opposite of what the user asked for. These four tests pin the
// value-aware transformer to the only two valid wire values.
// ---------------------------------------------------------------------------

test('listMappingRulesQuery enabled: "false" parses to false', () => {
  const parsed = listMappingRulesQuery.parse({ enabled: 'false' });
  assert.equal(parsed.enabled, false);
});

test('listMappingRulesQuery enabled: "true" parses to true', () => {
  const parsed = listMappingRulesQuery.parse({ enabled: 'true' });
  assert.equal(parsed.enabled, true);
});

test('listMappingRulesQuery enabled: omitted is undefined', () => {
  const parsed = listMappingRulesQuery.parse({});
  assert.equal(parsed.enabled, undefined);
});

test('listMappingRulesQuery enabled: "yes" rejects', () => {
  assert.throws(() => listMappingRulesQuery.parse({ enabled: 'yes' }));
});
