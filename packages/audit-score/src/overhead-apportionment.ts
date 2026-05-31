/**
 * Overhead apportionment engine — v3.2 Task B.10.
 *
 * Pure functions. No DB, no I/O. Apportions a single overhead line
 * between R&D and BAU, and computes the on-cost split that follows a
 * base salary per TR 2021/5.
 *
 * Why a separate module instead of inlining in the route or the agent:
 * the math sits at the centre of every consultant's working file — the
 * apportionment engine appears in expenditure UI, the application drafter,
 * the compliance-PDF generator, and the offset calculator. Centralising
 * here keeps the rationale strings consistent everywhere and lets us
 * iterate the rates (e.g. super-guarantee bumps) in one place.
 *
 * Three-way parity (per CLAUDE.md):
 *   - OVERHEAD_CATEGORIES + APPORTIONMENT_BASES below
 *   - The `apportionment_basis` SQL ENUM in migration 0097
 *   - The Zod APPORTIONMENT_BASES_LITERAL export in @cpa/schemas
 *
 * Rounding: every output is rounded to whole cents (2dp) via Math.round to
 * avoid floating-point dust on the AusIndustry portal lines. Callers
 * propagating to numeric(14,2) DB columns get clean values.
 */

export const OVERHEAD_CATEGORIES = [
  'rent',
  'utilities',
  'insurance',
  'admin_salaries',
  'depreciation',
  'other',
] as const;
export type OverheadCategory = (typeof OVERHEAD_CATEGORIES)[number];

/**
 * Mirrors the APPORTIONMENT_BASES Zod / Drizzle enum (migration 0097).
 * Kept literal here so this module has no runtime dep on @cpa/schemas.
 */
export const APPORTIONMENT_BASES = [
  'headcount',
  'floorspace',
  'time',
  'revenue',
  'direct',
] as const;
export type ApportionmentBasis = (typeof APPORTIONMENT_BASES)[number];

export type ApportionOverheadInput = {
  /** Overhead category — drives the rationale wording, not the math. */
  category: OverheadCategory;
  /** Total cost in AUD before R&D apportionment. Must be >= 0 and finite. */
  total_aud: number;
  /**
   * R&D percentage, 0–100 inclusive. 'direct' basis ignores this
   * (treated as 100). The DB column on employee_rd_allocation is a
   * smallint (whole percentages per TR 2021/5 timesheet sampling),
   * but this engine accepts fractional input for callers that want
   * to model 33.33% etc.
   */
  rd_percentage: number;
  /**
   * The method by which the % was derived. 'direct' short-circuits to
   * 100% R&D (e.g. lab consumables) with a flat rationale.
   */
  basis: ApportionmentBasis;
};

export type ApportionOverheadResult = {
  rd_aud: number;
  non_rd_aud: number;
  /**
   * Audit-defence rationale string. Surfaced verbatim in the F.9
   * Compliance Notes PDF so the consultant doesn't have to retype the
   * statutory anchor on every line.
   */
  rationale: string;
};

const CATEGORY_LABELS: Record<OverheadCategory, string> = {
  rent: 'rent',
  utilities: 'utilities',
  insurance: 'insurance',
  admin_salaries: 'administrative salaries',
  depreciation: 'depreciating-asset notional deduction',
  other: 'overhead',
};

const BASIS_DESCRIPTION: Record<ApportionmentBasis, string> = {
  headcount: 'headcount split (R&D heads ÷ total heads)',
  floorspace: 'floorspace split (R&D area ÷ total area)',
  time: 'time-record split (R&D hours ÷ total hours per TR 2021/5)',
  revenue: 'revenue-attribution split (R&D-driven revenue ÷ total revenue)',
  direct: 'direct attribution (100% R&D — no apportionment)',
};

const roundCents = (n: number): number => Math.round(n * 100) / 100;

/**
 * Apportion one overhead between R&D and BAU.
 *
 * Throws on invalid input rather than returning {ok,err} — these are
 * programming errors at the call site (the route/agent should validate
 * via Zod before invoking), not user-facing recoverable conditions.
 */
export function apportionOverhead(input: ApportionOverheadInput): ApportionOverheadResult {
  const { category, total_aud, rd_percentage, basis } = input;

  if (!Number.isFinite(total_aud)) {
    throw new TypeError(`apportionOverhead: total_aud must be finite (got ${total_aud})`);
  }
  if (total_aud < 0) {
    throw new RangeError(`apportionOverhead: total_aud must be non-negative (got ${total_aud})`);
  }
  if (basis !== 'direct') {
    if (!Number.isFinite(rd_percentage)) {
      throw new TypeError(`apportionOverhead: rd_percentage must be finite (got ${rd_percentage})`);
    }
    if (rd_percentage < 0 || rd_percentage > 100) {
      throw new RangeError(
        `apportionOverhead: rd_percentage must be in [0,100] (got ${rd_percentage})`,
      );
    }
  }

  const effectivePct = basis === 'direct' ? 100 : rd_percentage;
  const rd_aud = roundCents((total_aud * effectivePct) / 100);
  // Compute non_rd as the remainder so the two parts always sum to total
  // exactly (no rounding drift at the line level).
  const non_rd_aud = roundCents(total_aud - rd_aud);

  const pctFmt = Number.isInteger(effectivePct)
    ? `${effectivePct}%`
    : `${effectivePct.toFixed(2)}%`;
  const rationale =
    basis === 'direct'
      ? `${CATEGORY_LABELS[category]} apportioned 100% to R&D via ${BASIS_DESCRIPTION[basis]}.`
      : `${CATEGORY_LABELS[category]} apportioned ${pctFmt} to R&D via ${BASIS_DESCRIPTION[basis]}.`;

  return { rd_aud, non_rd_aud, rationale };
}

// ---------------------------------------------------------------------
// On-cost apportionment (v3.2 Task B.12 — TR 2021/5)
// ---------------------------------------------------------------------

/**
 * Standard Australian payroll on-cost rates, FY26 calibrations. Lifted
 * out as named constants so a future rate change is one edit, not 30
 * scattered literals.
 *
 * super_guarantee: 11.5% from 2026-07-01 (ATO bulletin, climbing to 12%
 *                  on 2027-07-01 — when that lands, bump this constant).
 * leave_loading:   17.5% of annual leave entitlement (Fair Work standard).
 * payroll_tax:     state-dependent; default 5.45% (NSW). Override per
 *                  tenant when other states matter.
 * workers_comp:    industry-class-dependent; default 1.50% (mid-range
 *                  professional-services class). Override per claimant.
 */
export const ON_COST_RATES = {
  super_guarantee: 0.115,
  leave_loading: 0.175,
  payroll_tax_default: 0.0545,
  workers_comp_default: 0.015,
} as const;

export type OnCostInput = {
  /**
   * The R&D-apportioned portion of the employee's base salary in AUD.
   * On-costs follow the same R&D% per TR 2021/5, so the caller has
   * already done the salary split before invoking this.
   */
  base_salary_rd_aud: number;
  /** Override the default payroll-tax rate (e.g. for VIC, QLD claimants). */
  payroll_tax_rate?: number;
  /** Override the default workers-comp rate per the claimant's industry class. */
  workers_comp_rate?: number;
  /**
   * If false, omit the annual-leave loading line (some employers don't
   * provide leave loading — e.g. salaried executives with no award).
   */
  include_leave_loading?: boolean;
};

export type OnCostResult = {
  super_aud: number;
  leave_loading_aud: number;
  payroll_tax_aud: number;
  workers_comp_aud: number;
  total_aud: number;
  /** Audit-defence rationale. */
  rationale: string;
};

/**
 * Compute the R&D-claimable on-costs for a salaried employee given the
 * R&D portion of their base salary. All four lines are independently
 * claimable per TR 2021/5 §15-30; consultants chronically under-claim
 * these because the math is annoying — this helper makes them one call.
 */
export function apportionOnCosts(input: OnCostInput): OnCostResult {
  const {
    base_salary_rd_aud,
    payroll_tax_rate = ON_COST_RATES.payroll_tax_default,
    workers_comp_rate = ON_COST_RATES.workers_comp_default,
    include_leave_loading = true,
  } = input;

  if (!Number.isFinite(base_salary_rd_aud) || base_salary_rd_aud < 0) {
    throw new RangeError(
      `apportionOnCosts: base_salary_rd_aud must be finite and non-negative (got ${base_salary_rd_aud})`,
    );
  }
  if (payroll_tax_rate < 0 || payroll_tax_rate > 0.5) {
    throw new RangeError(
      `apportionOnCosts: payroll_tax_rate must be in [0,0.5] (got ${payroll_tax_rate})`,
    );
  }
  if (workers_comp_rate < 0 || workers_comp_rate > 0.5) {
    throw new RangeError(
      `apportionOnCosts: workers_comp_rate must be in [0,0.5] (got ${workers_comp_rate})`,
    );
  }

  const super_aud = roundCents(base_salary_rd_aud * ON_COST_RATES.super_guarantee);
  const leave_loading_aud = include_leave_loading
    ? // Leave loading is 17.5% OF the annual-leave entitlement (which is
      // ~7.69% of salary — 4 weeks / 52). Net: 0.175 × 0.0769 ≈ 1.346% of
      // salary. Codifying that derivation keeps the rationale string
      // self-documenting.
      roundCents(base_salary_rd_aud * ON_COST_RATES.leave_loading * (4 / 52))
    : 0;
  const payroll_tax_aud = roundCents(base_salary_rd_aud * payroll_tax_rate);
  const workers_comp_aud = roundCents(base_salary_rd_aud * workers_comp_rate);
  const total_aud = roundCents(super_aud + leave_loading_aud + payroll_tax_aud + workers_comp_aud);

  const lines: string[] = [`super @ ${(ON_COST_RATES.super_guarantee * 100).toFixed(2)}%`];
  if (include_leave_loading)
    lines.push(`leave loading @ ${(ON_COST_RATES.leave_loading * 100).toFixed(1)}% of accrual`);
  lines.push(`payroll tax @ ${(payroll_tax_rate * 100).toFixed(2)}%`);
  lines.push(`workers comp @ ${(workers_comp_rate * 100).toFixed(2)}%`);
  const rationale = `On-costs apportioned at the same R&D % as base salary per TR 2021/5: ${lines.join(', ')}.`;

  return {
    super_aud,
    leave_loading_aud,
    payroll_tax_aud,
    workers_comp_aud,
    total_aud,
    rationale,
  };
}
