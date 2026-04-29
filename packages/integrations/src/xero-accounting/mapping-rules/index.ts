/**
 * Mapping rules engine — public surface (T-B8).
 *
 * Imported via `@cpa/integrations/xero-accounting` (the parent barrel
 * re-exports this module). B9 will consume the types to build the DB
 * schema + tenant-scoped CRUD API; B10 will consume `applyRules` from
 * the background job that emits `EXPENDITURE_LINE_MAPPED` events.
 *
 * See `./README.md` for rule semantics, decision log, and integration
 * notes for the B9/B10 follow-ups.
 */
export type {
  ExpenditureForRules,
  ExpenditureKind,
  MappingRule,
  RuleAction,
  RuleCondition,
  RuleMatch,
} from './types.js';
export { applyRules, evaluateRule, InvalidRuleError } from './evaluate.js';
