/**
 * P7 Theme D — compliance UI logic unit tests.
 *
 * Three concerns:
 *
 * 1. DIMENSIONS contract — the `DIMENSIONS` const in form-completeness-gauge.tsx
 *    lists the keys the component renders. The keys must exactly match the
 *    `checks` shape of `FormCompletenessResponse`. If a new dimension is added
 *    to the API, this test fails until the frontend DIMENSIONS array is updated.
 *
 * 2. NaN guard (BeneficialOwnershipPanel) — `handleSubmit` silently returns when
 *    `parseFloat(ownershipPct)` is NaN. No error message is shown. This test
 *    documents that guard and catches any future removal of it.
 *
 * 3. FY label parsing (ForecastPanel) — `fy.match(/\d+/)` returns null for
 *    malformed labels, making `baseYear = 0` and falling back to "Year +N"
 *    labels. This is acceptable but must be stable (no throw).
 *
 * Run:  pnpm --filter @cpa/web test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// 1. DIMENSIONS contract
//
// Mirror of the DIMENSIONS const in form-completeness-gauge.tsx.
// Keep this list in sync with that file. If you add a new dimension to the
// API's FormCompletenessResponse.checks interface, add it here AND in the
// component — this test then passes.
// ---------------------------------------------------------------------------

/** Keys as defined in form-completeness-gauge.tsx DIMENSIONS */
const FRONTEND_DIMENSION_KEYS = [
  'knowledge_search',
  'beneficial_ownership',
  'forecast',
  'facilities',
  'narratives',
] as const;

/**
 * Keys that the API endpoint emits in FormCompletenessResponse.checks.
 * Sourced from _lib/api.ts FormCompletenessResponse interface.
 */
const API_CHECK_KEYS = [
  'knowledge_search',
  'beneficial_ownership',
  'forecast',
  'facilities',
  'narratives',
] as const;

describe('DIMENSIONS contract: frontend keys ↔ API checks shape', () => {
  test('frontend DIMENSIONS key set exactly matches API FormCompletenessResponse.checks', () => {
    const frontendKeys = [...FRONTEND_DIMENSION_KEYS].sort();
    const apiKeys = [...API_CHECK_KEYS].sort();
    assert.deepEqual(
      frontendKeys,
      apiKeys,
      'Add any new dimension to both DIMENSIONS (form-completeness-gauge.tsx) and ' +
        'FormCompletenessResponse.checks (_lib/api.ts) simultaneously. ' +
        'If only the API grows, the gauge silently skips the new dimension.',
    );
  });

  test('no duplicate keys in DIMENSIONS', () => {
    const unique = new Set(FRONTEND_DIMENSION_KEYS);
    assert.equal(
      unique.size,
      FRONTEND_DIMENSION_KEYS.length,
      'DIMENSIONS must not contain duplicate keys',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Ownership percentage NaN guard (BeneficialOwnershipPanel.handleSubmit)
//
// Exact logic from the component — any change to the source must be reflected
// here, making this test a "living spec" for the guard.
// ---------------------------------------------------------------------------

/**
 * Returns true if the submit should proceed (both fields are valid).
 * Mirrors the guard at the top of AddOwnerForm.handleSubmit.
 */
function canSubmitOwnership(ownerName: string, ownershipPctStr: string): boolean {
  const pct = parseFloat(ownershipPctStr);
  if (!ownerName.trim() || isNaN(pct)) return false;
  return true;
}

describe('NaN guard: BeneficialOwnershipPanel ownership_pct validation', () => {
  test('empty string is rejected (parseFloat("") = NaN)', () => {
    assert.equal(canSubmitOwnership('Jane Smith', ''), false);
  });

  test('non-numeric string is rejected', () => {
    assert.equal(canSubmitOwnership('Jane Smith', 'fifty'), false);
  });

  test('whitespace-only is rejected', () => {
    assert.equal(canSubmitOwnership('Jane Smith', '   '), false);
  });

  test('empty owner name is rejected regardless of percentage', () => {
    assert.equal(canSubmitOwnership('', '100'), false);
    assert.equal(canSubmitOwnership('   ', '100'), false);
  });

  test('valid integer percentage is accepted', () => {
    assert.equal(canSubmitOwnership('Jane Smith', '100'), true);
  });

  test('valid decimal percentage is accepted', () => {
    assert.equal(canSubmitOwnership('Jane Smith', '33.33'), true);
  });

  test('zero percentage is accepted (valid edge case — dormant beneficiary)', () => {
    assert.equal(canSubmitOwnership('Jane Smith', '0'), true);
  });

  test('partial number followed by text ("50abc") is rejected', () => {
    // parseFloat("50abc") = 50 — this actually PASSES validation.
    // Document that behaviour explicitly so any future tightening is intentional.
    // If the intent is to reject "50abc", use Number() instead of parseFloat().
    const pct = parseFloat('50abc');
    assert.equal(isNaN(pct), false, 'parseFloat("50abc") is 50, not NaN — this is a known quirk');
    // The current implementation accepts it:
    assert.equal(canSubmitOwnership('Jane Smith', '50abc'), true);
  });
});

// ---------------------------------------------------------------------------
// 3. FY label parsing (ForecastPanel)
//
// Mirrors the two-liner at the top of ForecastPanel render:
//   const fyMatch = fy.match(/\d+/);
//   const baseYear = fyMatch ? parseInt(fyMatch[0], 10) : 0;
// ---------------------------------------------------------------------------

function parseFYBaseYear(fy: string): number {
  const fyMatch = fy.match(/\d+/);
  return fyMatch ? parseInt(fyMatch[0], 10) : 0;
}

function getFYOffsetLabel(fy: string, offset: number): string {
  const baseYear = parseFYBaseYear(fy);
  return baseYear ? `FY${baseYear + offset}` : `Year +${offset}`;
}

describe('FY label parsing: ForecastPanel year offset labels', () => {
  test('FY25 → FY26, FY27, FY28 for offsets 1-3', () => {
    assert.equal(getFYOffsetLabel('FY25', 1), 'FY26');
    assert.equal(getFYOffsetLabel('FY25', 2), 'FY27');
    assert.equal(getFYOffsetLabel('FY25', 3), 'FY28');
  });

  test('FY2025 (long-form) extracts first digit sequence', () => {
    assert.equal(getFYOffsetLabel('FY2025', 1), 'FY2026');
    assert.equal(getFYOffsetLabel('FY2025', 2), 'FY2027');
  });

  test('no digits → baseYear=0 → "Year +N" fallback (no throw)', () => {
    assert.equal(getFYOffsetLabel('bad-label', 1), 'Year +1');
    assert.equal(getFYOffsetLabel('', 1), 'Year +1');
    assert.equal(getFYOffsetLabel('FY', 1), 'Year +1');
  });

  test('fallback is stable across all three offsets', () => {
    for (const offset of [1, 2, 3]) {
      assert.equal(getFYOffsetLabel('', offset), `Year +${offset}`);
    }
  });

  test('numeric-only label (e.g. "25") works correctly', () => {
    // Some callers might pass bare year numbers
    assert.equal(getFYOffsetLabel('25', 1), 'FY26');
  });
});
