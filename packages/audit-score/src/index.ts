export type {
  ScoreInput,
  ScoreResult,
  ScoreRule,
  ScoreRuleBreakdown,
  ScoreRuleResult,
  SqlClient,
} from './types.js';
export { SCORING_RULES, TOTAL_MAX_PTS } from './rules.js';
export { computeScore } from './score.js';

export {
  calculateClawback,
  calculateClawbackSummary,
  ATO_GIC_RATE,
  RDTI_OFFSET_RATE_SMALL,
  RDTI_OFFSET_RATE_LARGE,
  COMPANY_TAX_RATE,
} from './clawback-calculator.js';
export type { ClawbackInput, ClawbackResult, ClawbackSummary } from './clawback-calculator.js';

export { reconcileClaim } from './reconciliation.js';
export type { ReconciliationFinding, ReconciliationInput } from './reconciliation.js';

export {
  OVERHEAD_CATEGORIES,
  APPORTIONMENT_BASES,
  ON_COST_RATES,
  apportionOverhead,
  apportionOnCosts,
} from './overhead-apportionment.js';
export type {
  OverheadCategory,
  ApportionmentBasis,
  ApportionOverheadInput,
  ApportionOverheadResult,
  OnCostInput,
  OnCostResult,
} from './overhead-apportionment.js';
