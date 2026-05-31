import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPORTIONMENT_BASES,
  ON_COST_RATES,
  OVERHEAD_CATEGORIES,
  apportionOnCosts,
  apportionOverhead,
  type ApportionmentBasis,
  type OverheadCategory,
} from './overhead-apportionment.js';

/**
 * Pure-function tests — no DB, no I/O. Cover:
 *   1. Math correctness across category × basis combinations.
 *   2. Edge cases (0%, 100%, zero total, finite/negative validation).
 *   3. Rounding behaviour (whole cents, no drift between rd + non_rd).
 *   4. Rationale strings cite the right basis description.
 *   5. On-cost helper computes super + leave loading + payroll tax + comp.
 */

// ---------------------------------------------------------------------
// apportionOverhead — happy path
// ---------------------------------------------------------------------

test('apportionOverhead: 60% rent split on $10k yields $6000 / $4000', () => {
  const r = apportionOverhead({
    category: 'rent',
    total_aud: 10_000,
    rd_percentage: 60,
    basis: 'floorspace',
  });
  assert.equal(r.rd_aud, 6000);
  assert.equal(r.non_rd_aud, 4000);
  assert.match(r.rationale, /rent/i);
  assert.match(r.rationale, /60%/);
  assert.match(r.rationale, /floorspace/i);
});

test('apportionOverhead: direct basis pins to 100% regardless of rd_percentage', () => {
  // 0% input is ignored on 'direct' — the basis name overrides.
  const r = apportionOverhead({
    category: 'other',
    total_aud: 500,
    rd_percentage: 0,
    basis: 'direct',
  });
  assert.equal(r.rd_aud, 500);
  assert.equal(r.non_rd_aud, 0);
  assert.match(r.rationale, /100% to R&D/i);
});

test('apportionOverhead: 0% rd_percentage yields zero R&D', () => {
  const r = apportionOverhead({
    category: 'utilities',
    total_aud: 1234.56,
    rd_percentage: 0,
    basis: 'headcount',
  });
  assert.equal(r.rd_aud, 0);
  assert.equal(r.non_rd_aud, 1234.56);
});

test('apportionOverhead: 100% rd_percentage yields full R&D, zero BAU', () => {
  const r = apportionOverhead({
    category: 'admin_salaries',
    total_aud: 5000,
    rd_percentage: 100,
    basis: 'time',
  });
  assert.equal(r.rd_aud, 5000);
  assert.equal(r.non_rd_aud, 0);
});

test('apportionOverhead: fractional percent renders to 2dp in rationale', () => {
  const r = apportionOverhead({
    category: 'depreciation',
    total_aud: 9999.99,
    rd_percentage: 33.33,
    basis: 'time',
  });
  // 33.33% of 9999.99 = 3332.99667 → rounds to 3333.00
  assert.equal(r.rd_aud, 3333);
  assert.equal(r.non_rd_aud, 6666.99);
  assert.match(r.rationale, /33\.33%/);
});

test('apportionOverhead: rd + non_rd sum exactly to total (no rounding drift)', () => {
  // Pick a value where naive double-rounding would drift by 1c.
  const r = apportionOverhead({
    category: 'rent',
    total_aud: 100.01,
    rd_percentage: 33,
    basis: 'headcount',
  });
  assert.equal(roundCents(r.rd_aud + r.non_rd_aud), 100.01);
});

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------
// apportionOverhead — exhaustive category × basis matrix
// ---------------------------------------------------------------------

test('apportionOverhead: every category × basis combination returns a valid result', () => {
  for (const category of OVERHEAD_CATEGORIES) {
    for (const basis of APPORTIONMENT_BASES) {
      const r = apportionOverhead({
        category,
        total_aud: 1000,
        rd_percentage: 50,
        basis,
      });
      assert.ok(Number.isFinite(r.rd_aud), `${category}/${basis}: rd_aud finite`);
      assert.ok(Number.isFinite(r.non_rd_aud), `${category}/${basis}: non_rd_aud finite`);
      assert.equal(
        roundCents(r.rd_aud + r.non_rd_aud),
        1000,
        `${category}/${basis}: parts sum to total`,
      );
      assert.ok(r.rationale.length > 0, `${category}/${basis}: rationale non-empty`);
    }
  }
});

// ---------------------------------------------------------------------
// apportionOverhead — input validation
// ---------------------------------------------------------------------

test('apportionOverhead: rejects negative total_aud', () => {
  assert.throws(
    () =>
      apportionOverhead({
        category: 'rent',
        total_aud: -100,
        rd_percentage: 50,
        basis: 'floorspace',
      }),
    /total_aud must be non-negative/,
  );
});

test('apportionOverhead: rejects non-finite total_aud', () => {
  assert.throws(
    () =>
      apportionOverhead({
        category: 'rent',
        total_aud: Number.NaN,
        rd_percentage: 50,
        basis: 'floorspace',
      }),
    /total_aud must be finite/,
  );
});

test('apportionOverhead: rejects rd_percentage > 100', () => {
  assert.throws(
    () =>
      apportionOverhead({
        category: 'rent',
        total_aud: 100,
        rd_percentage: 150,
        basis: 'floorspace',
      }),
    /rd_percentage must be in/,
  );
});

test('apportionOverhead: rejects rd_percentage < 0', () => {
  assert.throws(
    () =>
      apportionOverhead({
        category: 'rent',
        total_aud: 100,
        rd_percentage: -5,
        basis: 'floorspace',
      }),
    /rd_percentage must be in/,
  );
});

test('apportionOverhead: direct basis allows out-of-range rd_percentage (ignored)', () => {
  // Documentation-by-test: 'direct' short-circuits before validating the %.
  const r = apportionOverhead({
    category: 'other',
    total_aud: 100,
    rd_percentage: -999,
    basis: 'direct',
  });
  assert.equal(r.rd_aud, 100);
});

// ---------------------------------------------------------------------
// Rationale wording exhaustively covers each basis description
// ---------------------------------------------------------------------

test('apportionOverhead: rationale cites the basis-specific phrasing', () => {
  const expectations: Record<ApportionmentBasis, RegExp> = {
    headcount: /R&D heads ÷ total heads/,
    floorspace: /R&D area ÷ total area/,
    time: /TR 2021\/5/,
    revenue: /R&D-driven revenue/,
    direct: /no apportionment/,
  };
  for (const basis of APPORTIONMENT_BASES) {
    const r = apportionOverhead({
      category: 'rent',
      total_aud: 100,
      rd_percentage: 50,
      basis,
    });
    assert.match(r.rationale, expectations[basis], `${basis} rationale phrasing`);
  }
});

test('apportionOverhead: category label appears in rationale', () => {
  const categoryFragments: Record<OverheadCategory, RegExp> = {
    rent: /rent/i,
    utilities: /utilities/i,
    insurance: /insurance/i,
    admin_salaries: /administrative salaries/i,
    depreciation: /depreciating-asset/i,
    other: /overhead/i,
  };
  for (const category of OVERHEAD_CATEGORIES) {
    const r = apportionOverhead({
      category,
      total_aud: 100,
      rd_percentage: 50,
      basis: 'time',
    });
    assert.match(r.rationale, categoryFragments[category], `${category} rationale phrasing`);
  }
});

// ---------------------------------------------------------------------
// apportionOnCosts
// ---------------------------------------------------------------------

test('apportionOnCosts: 60k base salary × 60% R&D → 36k R&D base; on-costs apply on top', () => {
  // Salary R&D portion already supplied — engine just adds the on-costs.
  const r = apportionOnCosts({ base_salary_rd_aud: 36_000 });
  // super: 36k × 11.5% = 4140
  assert.equal(r.super_aud, 4140);
  // leave loading: 36k × 17.5% × (4/52) ≈ 484.62
  assert.equal(r.leave_loading_aud, 484.62);
  // payroll tax (NSW default): 36k × 5.45% = 1962
  assert.equal(r.payroll_tax_aud, 1962);
  // workers comp default: 36k × 1.5% = 540
  assert.equal(r.workers_comp_aud, 540);
  // total = 7126.62
  assert.equal(r.total_aud, 7126.62);
  assert.match(r.rationale, /TR 2021\/5/);
  assert.match(r.rationale, /super/i);
  assert.match(r.rationale, /leave loading/i);
  assert.match(r.rationale, /payroll tax/i);
  assert.match(r.rationale, /workers comp/i);
});

test('apportionOnCosts: zero salary yields zero on-costs', () => {
  const r = apportionOnCosts({ base_salary_rd_aud: 0 });
  assert.equal(r.super_aud, 0);
  assert.equal(r.leave_loading_aud, 0);
  assert.equal(r.payroll_tax_aud, 0);
  assert.equal(r.workers_comp_aud, 0);
  assert.equal(r.total_aud, 0);
});

test('apportionOnCosts: include_leave_loading=false omits the leave line', () => {
  const r = apportionOnCosts({
    base_salary_rd_aud: 50_000,
    include_leave_loading: false,
  });
  assert.equal(r.leave_loading_aud, 0);
  assert.doesNotMatch(r.rationale, /leave loading/i);
  // Other lines unaffected.
  assert.equal(r.super_aud, 5750);
});

test('apportionOnCosts: state-specific payroll-tax override applies', () => {
  // QLD payroll tax 4.75%.
  const r = apportionOnCosts({
    base_salary_rd_aud: 100_000,
    payroll_tax_rate: 0.0475,
  });
  assert.equal(r.payroll_tax_aud, 4750);
  assert.match(r.rationale, /4\.75%/);
});

test('apportionOnCosts: industry-class workers-comp override applies', () => {
  // High-risk industry class (3.5%).
  const r = apportionOnCosts({
    base_salary_rd_aud: 100_000,
    workers_comp_rate: 0.035,
  });
  assert.equal(r.workers_comp_aud, 3500);
  assert.match(r.rationale, /3\.50%/);
});

test('apportionOnCosts: rejects negative base salary', () => {
  assert.throws(
    () => apportionOnCosts({ base_salary_rd_aud: -1 }),
    /base_salary_rd_aud must be finite and non-negative/,
  );
});

test('apportionOnCosts: rejects payroll_tax_rate > 0.5', () => {
  assert.throws(
    () => apportionOnCosts({ base_salary_rd_aud: 1000, payroll_tax_rate: 0.6 }),
    /payroll_tax_rate must be in/,
  );
});

test('apportionOnCosts: rejects workers_comp_rate < 0', () => {
  assert.throws(
    () => apportionOnCosts({ base_salary_rd_aud: 1000, workers_comp_rate: -0.01 }),
    /workers_comp_rate must be in/,
  );
});

// ---------------------------------------------------------------------
// Sanity: the published ON_COST_RATES constants match documentation
// ---------------------------------------------------------------------

test('ON_COST_RATES: super_guarantee at 11.5% per ATO 2026 schedule', () => {
  // Sentinel — if/when the SG bumps to 12% on 2027-07-01, this test
  // serves as the change marker so the bump isn't forgotten.
  assert.equal(ON_COST_RATES.super_guarantee, 0.115);
});

test('ON_COST_RATES: leave loading at 17.5% per Fair Work standard', () => {
  assert.equal(ON_COST_RATES.leave_loading, 0.175);
});
