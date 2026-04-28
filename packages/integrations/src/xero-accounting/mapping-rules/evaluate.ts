/**
 * Mapping rules engine — pure evaluation logic (T-B8).
 *
 * No I/O, no async, no nondeterminism. The engine is a leaf module that
 * `evaluate(rule, expenditure)` and `applyRules(rules, expenditure)`
 * synchronously, throwing `InvalidRuleError` on malformed input.
 *
 * Why a leaf module? B9 will wrap these functions in a tenant-scoped
 * CRUD API and B10 will call them from a pg-boss background job. Both
 * follow-ups need the engine to be (a) trivially unit-testable and
 * (b) safe to call from any context — including a hot loop processing
 * thousands of expenditures per minute. Synchronous purity satisfies
 * both constraints.
 */

import type {
  ExpenditureForRules,
  MappingRule,
  RuleAction,
  RuleCondition,
  RuleMatch,
} from './types.js';

/**
 * Float tolerance for `apportion` percentage sums. 0.001 is small enough
 * to catch real arithmetic errors (a rule with [33, 33, 33] sums to 99,
 * which is meaningfully wrong) and large enough to absorb the usual
 * binary-float rounding (e.g. 33.33 + 33.33 + 33.34 = 99.99999...
 * because of float representation). Mirrors the tolerance the F4
 * allocation validator uses.
 */
const APPORTION_SUM_TOLERANCE = 0.001;

/**
 * Engine-specific error. The check pattern at call sites is:
 *
 *   try { evaluateRule(...) } catch (err) {
 *     if (err instanceof Error && err.name === 'InvalidRuleError') { ... }
 *   }
 *
 * We do NOT export an `instanceof InvalidRuleError` check because the
 * engine may be loaded across module-resolution boundaries (cjs/esm,
 * vendored copies in different worktrees during the swimlane phase).
 * `name`-based discrimination is portable; `instanceof` is not. This
 * mirrors the same pattern the runtime/oauth.ts errors use.
 */
export class InvalidRuleError extends Error {
  override readonly name = 'InvalidRuleError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Validate a `RuleAction` shape. Throws `InvalidRuleError` if invalid.
 *
 * Called from `evaluateRule` BEFORE checking conditions — a rule with a
 * bad action is broken regardless of whether it would have matched, so
 * we surface the error eagerly. (Alternative considered: only validate
 * when returning a match. Rejected because it would silently accept
 * broken-but-non-matching rules into the system, which is a terrible
 * developer experience.)
 */
function validateAction(action: RuleAction): void {
  switch (action.type) {
    case 'map_to_activity':
      if (typeof action.activity_id !== 'string' || action.activity_id.length === 0) {
        throw new InvalidRuleError(`map_to_activity action requires non-empty activity_id`);
      }
      return;
    case 'apportion': {
      // `action.allocations` is typed as `ReadonlyArray<{ activity_id;
      // percentage }>`, so we iterate directly. The runtime checks
      // below catch hand-rolled JSON paths that bypass the type system
      // (the engine is the safety net — see README "rules may arrive
      // untrusted from the B9 API layer").
      const allocations = action.allocations;
      if (allocations.length === 0) {
        throw new InvalidRuleError(`apportion action requires at least one allocation`);
      }
      let sum = 0;
      for (const alloc of allocations) {
        const activityId: unknown = alloc.activity_id;
        if (typeof activityId !== 'string' || activityId.length === 0) {
          throw new InvalidRuleError(`apportion allocation requires non-empty activity_id`);
        }
        const percentage: unknown = alloc.percentage;
        if (typeof percentage !== 'number' || !Number.isFinite(percentage)) {
          throw new InvalidRuleError(`apportion percentage must be a finite number`);
        }
        if (percentage <= 0) {
          throw new InvalidRuleError(`apportion percentage must be > 0 (got ${percentage})`);
        }
        sum += percentage;
      }
      if (Math.abs(sum - 100) > APPORTION_SUM_TOLERANCE) {
        throw new InvalidRuleError(`apportion percentages must sum to 100 (got ${sum})`);
      }
      return;
    }
    case 'flag_for_review':
      if (typeof action.reason !== 'string' || action.reason.length === 0) {
        throw new InvalidRuleError(`flag_for_review action requires non-empty reason`);
      }
      return;
  }
  // Exhaustiveness — the switch covers all `RuleAction.type` cases. If
  // a new action type is added without updating this switch, the unused
  // type assertion below will fail to compile.
  const _exhaustive: never = action;
  throw new InvalidRuleError(`unknown action type: ${JSON.stringify(_exhaustive)}`);
}

/**
 * Evaluate a single condition against the expenditure. Returns `true` on
 * match, `false` on no-match, throws `InvalidRuleError` on a malformed
 * condition (invalid regex, inverted between range, etc.).
 *
 * Null-handling: if the expenditure field is `null`, the condition does
 * NOT match (returns `false`) for ANY string op. This is intentional —
 * `null contact_name` matching `eq 'foo'` should be no-match, not throw.
 * The README documents this decision under "Edge cases".
 */
function evaluateCondition(condition: RuleCondition, expenditure: ExpenditureForRules): boolean {
  switch (condition.field) {
    case 'contact_name':
      return matchStringField(expenditure.contact_name, condition);
    case 'reference':
      return matchStringField(expenditure.reference, condition);
    case 'description':
      return matchStringField(expenditure.description, condition);
    case 'account_code': {
      // account_code is a string, not free text — `contains`/`matches`
      // aren't supported by the type contract. eq + in only.
      const value = expenditure.account_code;
      if (value === null) return false;
      if (condition.op === 'eq') {
        return value === condition.value;
      }
      // op === 'in'
      return condition.value.includes(value);
    }
    case 'amount':
      return matchAmount(expenditure.amount, condition);
    case 'kind': {
      if (condition.op === 'eq') {
        return expenditure.kind === condition.value;
      }
      // op === 'in'
      return condition.value.includes(expenditure.kind);
    }
    case 'currency': {
      if (condition.op === 'eq') {
        return expenditure.currency === condition.value;
      }
      // op === 'in'
      return condition.value.includes(expenditure.currency);
    }
    case 'date':
      return matchDate(expenditure.date, condition);
  }
}

/**
 * String-field matcher. Shared between `contact_name`, `reference`,
 * `description`. `value` is taken from the expenditure (nullable);
 * `condition` carries the op + needle.
 *
 * Null short-circuit: a null field never matches any string condition.
 * This keeps callers free of `?? ''` boilerplate and avoids the
 * surprising case where a null field "matches" a contains-empty-string
 * regex.
 */
function matchStringField(
  value: string | null,
  condition: Extract<RuleCondition, { field: 'contact_name' | 'reference' | 'description' }>,
): boolean {
  if (value === null) return false;
  const ci = condition.case_insensitive === true;
  switch (condition.op) {
    case 'eq': {
      if (ci) return value.toLowerCase() === condition.value.toLowerCase();
      return value === condition.value;
    }
    case 'contains': {
      if (ci) return value.toLowerCase().includes(condition.value.toLowerCase());
      return value.includes(condition.value);
    }
    case 'matches': {
      // Regex compilation is the validation point — invalid sources
      // throw here, NOT silently fail-match. The flag string is empty
      // unless case_insensitive is set; we deliberately don't accept
      // arbitrary user-supplied flags so we can keep the engine
      // deterministic (no `g` state, no `s` dotall surprise).
      let re: RegExp;
      try {
        re = new RegExp(condition.value, ci ? 'i' : '');
      } catch (err) {
        throw new InvalidRuleError(`invalid regex in matches condition: ${(err as Error).message}`);
      }
      return re.test(value);
    }
  }
}

/**
 * Amount matcher. Inclusive on the boundary for all comparators —
 * `gte 100` matches 100, `between [0, 100]` matches both 0 and 100.
 * The README pins this convention.
 *
 * `between` validates the range up-front: a `[max, min]` tuple is a
 * caller error, not a "vacuously empty" range. Throwing matches the
 * same defensive posture as `apportion` validation.
 */
function matchAmount(
  amount: number,
  condition: Extract<RuleCondition, { field: 'amount' }>,
): boolean {
  switch (condition.op) {
    case 'gt':
      return amount > condition.value;
    case 'gte':
      return amount >= condition.value;
    case 'lt':
      return amount < condition.value;
    case 'lte':
      return amount <= condition.value;
    case 'between': {
      const [min, max] = condition.value;
      if (min > max) {
        throw new InvalidRuleError(`amount between range is inverted: [${min}, ${max}]`);
      }
      return amount >= min && amount <= max;
    }
  }
}

/**
 * Date matcher. ISO date strings (`YYYY-MM-DD`) are lexicographically
 * comparable, so we use plain string ops — no `Date` parsing, no
 * timezone footguns. `before` and `after` are EXCLUSIVE of the boundary
 * date; `between` is inclusive on both ends. Pinned by the README.
 *
 * Inverted between range throws `InvalidRuleError`, same as amount.
 */
function matchDate(date: string, condition: Extract<RuleCondition, { field: 'date' }>): boolean {
  switch (condition.op) {
    case 'before':
      return date < condition.value;
    case 'after':
      return date > condition.value;
    case 'between': {
      const [start, end] = condition.value;
      if (start > end) {
        throw new InvalidRuleError(`date between range is inverted: [${start}, ${end}]`);
      }
      return date >= start && date <= end;
    }
  }
}

/**
 * Evaluate a single rule against an expenditure.
 *
 *   - Returns `null` if the rule is disabled, or if any condition fails.
 *   - Returns a `RuleMatch` if all conditions hold AND the action
 *     validates.
 *   - Throws `InvalidRuleError` if the action is malformed (regardless
 *     of match outcome) or a condition is malformed (regex, inverted
 *     between).
 *
 * Empty conditions array → vacuous truth (always matches). The README
 * pins this decision: a rule with zero conditions is "match
 * everything" — useful for catch-all flag_for_review rules at the
 * bottom of the priority stack. The alternative (throw on empty
 * conditions) was rejected because it would force callers to special-
 * case the catch-all pattern.
 */
export function evaluateRule(
  rule: MappingRule,
  expenditure: ExpenditureForRules,
): RuleMatch | null {
  // Validate the action eagerly — a broken rule should throw whether or
  // not it would have matched.
  validateAction(rule.action);

  if (!rule.enabled) return null;

  for (const condition of rule.conditions) {
    if (!evaluateCondition(condition, expenditure)) {
      return null;
    }
  }

  return {
    rule_id: rule.id,
    rule_name: rule.name,
    priority: rule.priority,
    action: rule.action,
  };
}

/**
 * Evaluate a list of rules against a single expenditure. Returns ALL
 * matching rules (OR semantics across rules), sorted by priority
 * ascending then rule.id ascending (stable tie-break).
 *
 * Disabled rules are silently skipped — they don't contribute to the
 * output and don't affect ordering of the rules that do match.
 *
 * Validation: each rule's action is validated even if it doesn't match.
 * This means a malformed rule will throw `InvalidRuleError` from
 * `applyRules` regardless of whether the expenditure satisfies its
 * conditions — the contract is "all rules in the input are well-formed
 * or we throw". B9's API layer should validate at write time too, but
 * the engine remains the runtime safety net.
 *
 * The function is pure: same inputs → same outputs, no side effects.
 * Returns a fresh array each call — callers may safely mutate it.
 */
export function applyRules(
  rules: readonly MappingRule[],
  expenditure: ExpenditureForRules,
): RuleMatch[] {
  const matches: RuleMatch[] = [];
  for (const rule of rules) {
    const match = evaluateRule(rule, expenditure);
    if (match !== null) {
      matches.push(match);
    }
  }
  // Stable sort: priority ascending, then rule_id ascending. Same
  // tie-breaker pattern as C5 — keeps deterministic ordering across
  // runs and across DB column orderings.
  matches.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.rule_id < b.rule_id) return -1;
    if (a.rule_id > b.rule_id) return 1;
    return 0;
  });
  return matches;
}
