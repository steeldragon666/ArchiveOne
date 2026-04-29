import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRules, evaluateRule, InvalidRuleError } from './evaluate.js';
import type { ExpenditureForRules, MappingRule, RuleAction, RuleCondition } from './types.js';

/**
 * B8 mapping-rules engine tests.
 *
 * Coverage matrix:
 *   - Per-condition: one test per (field × op) combination, plus
 *     case-insensitive variants for string fields and edge cases for
 *     amount/date boundaries.
 *   - Multi-condition AND: 3-of-3 match, 2-of-3 (one fails) no-match,
 *     and the vacuous-truth case (empty conditions).
 *   - Multi-rule OR / priority: both match, priority ordering, equal-
 *     priority tie-break by id, disabled rule, empty rule list.
 *   - Validation errors: apportion sum != 100, empty allocations,
 *     between inverted, invalid regex, malformed action shapes.
 *   - Edge cases: nullable string fields, exact amount boundaries
 *     (0 with gt 0; 0.001 with between [0, 0.001]), case_insensitive
 *     on a non-string op (silently ignored), ISO date lexicographic
 *     comparison.
 *
 * Test fixtures use deterministic UUIDs and round numbers — same
 * convention as the rest of the @cpa/integrations test suite.
 */

// -- Fixture builders ----------------------------------------------------

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const ACTIVITY_A = '00000000-0000-4000-8000-0000000000a1';
const ACTIVITY_B = '00000000-0000-4000-8000-0000000000a2';

function ruleId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function makeExpenditure(overrides: Partial<ExpenditureForRules> = {}): ExpenditureForRules {
  return {
    id: '00000000-0000-4000-8000-0000000000e1',
    kind: 'INVOICE',
    contact_name: 'Acme Corp',
    reference: 'INV-001',
    account_code: '400',
    amount: 100,
    currency: 'AUD',
    description: 'Office supplies for HQ',
    date: '2026-04-15',
    ...overrides,
  };
}

function makeRule(overrides: Partial<MappingRule> = {}): MappingRule {
  return {
    id: ruleId(1),
    tenant_id: TENANT_ID,
    name: 'Test rule',
    priority: 10,
    enabled: true,
    conditions: [],
    action: { type: 'map_to_activity', activity_id: ACTIVITY_A },
    ...overrides,
  };
}

const ACTION_MAP_A: RuleAction = { type: 'map_to_activity', activity_id: ACTIVITY_A };

// -- Per-condition: contact_name -----------------------------------------

test('contact_name eq matches when value equals', () => {
  const rule = makeRule({
    conditions: [{ field: 'contact_name', op: 'eq', value: 'Acme Corp' }],
  });
  const match = evaluateRule(rule, makeExpenditure());
  assert.notEqual(match, null);
  assert.equal(match!.rule_id, ruleId(1));
});

test('contact_name eq does not match when value differs', () => {
  const rule = makeRule({
    conditions: [{ field: 'contact_name', op: 'eq', value: 'Other Corp' }],
  });
  assert.equal(evaluateRule(rule, makeExpenditure()), null);
});

test('contact_name contains matches substring', () => {
  const rule = makeRule({
    conditions: [{ field: 'contact_name', op: 'contains', value: 'Acme' }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('contact_name contains is case-sensitive by default', () => {
  const rule = makeRule({
    conditions: [{ field: 'contact_name', op: 'contains', value: 'acme' }],
  });
  assert.equal(evaluateRule(rule, makeExpenditure()), null);
});

test('contact_name matches with regex pattern', () => {
  const rule = makeRule({
    conditions: [{ field: 'contact_name', op: 'matches', value: '^Acme.*Corp$' }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('contact_name eq with case_insensitive matches mixed case', () => {
  const rule = makeRule({
    conditions: [{ field: 'contact_name', op: 'eq', value: 'ACME CORP', case_insensitive: true }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('contact_name matches with case_insensitive applies the i flag', () => {
  const rule = makeRule({
    conditions: [{ field: 'contact_name', op: 'matches', value: '^acme', case_insensitive: true }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

// -- Per-condition: reference / description ------------------------------

test('reference contains routes through string-field logic', () => {
  const rule = makeRule({
    conditions: [{ field: 'reference', op: 'contains', value: 'INV' }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('description matches with regex routes through string-field logic', () => {
  const rule = makeRule({
    conditions: [{ field: 'description', op: 'matches', value: 'office' }],
  });
  // case-sensitive: 'Office' (capital) does not match 'office'.
  assert.equal(evaluateRule(rule, makeExpenditure()), null);
});

// -- Per-condition: account_code -----------------------------------------

test('account_code eq matches', () => {
  const rule = makeRule({
    conditions: [{ field: 'account_code', op: 'eq', value: '400' }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('account_code in matches one of several codes', () => {
  const rule = makeRule({
    conditions: [{ field: 'account_code', op: 'in', value: ['300', '400', '500'] }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('account_code eq does not match when code differs', () => {
  const rule = makeRule({
    conditions: [{ field: 'account_code', op: 'eq', value: '999' }],
  });
  assert.equal(evaluateRule(rule, makeExpenditure()), null);
});

// -- Per-condition: amount -----------------------------------------------

test('amount gt matches strictly-greater', () => {
  const rule = makeRule({
    conditions: [{ field: 'amount', op: 'gt', value: 50 }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('amount gte matches inclusive at boundary', () => {
  const rule = makeRule({
    conditions: [{ field: 'amount', op: 'gte', value: 100 }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('amount lt matches strictly-less', () => {
  const rule = makeRule({
    conditions: [{ field: 'amount', op: 'lt', value: 200 }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('amount lte matches inclusive at boundary', () => {
  const rule = makeRule({
    conditions: [{ field: 'amount', op: 'lte', value: 100 }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('amount between is inclusive on both bounds', () => {
  const rule = makeRule({
    conditions: [{ field: 'amount', op: 'between', value: [100, 200] }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure({ amount: 100 })), null);
  assert.notEqual(evaluateRule(rule, makeExpenditure({ amount: 200 })), null);
});

test('amount between excludes values outside the range', () => {
  const rule = makeRule({
    conditions: [{ field: 'amount', op: 'between', value: [100, 200] }],
  });
  assert.equal(evaluateRule(rule, makeExpenditure({ amount: 99.99 })), null);
});

test('amount between with min === max matches exactly that single value', () => {
  const rule = makeRule({
    conditions: [{ field: 'amount', op: 'between', value: [100, 100] }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure({ amount: 100 })), null);
  assert.equal(evaluateRule(rule, makeExpenditure({ amount: 100.01 })), null);
});

// -- Per-condition: kind -------------------------------------------------

test('kind eq matches exact kind', () => {
  const rule = makeRule({
    conditions: [{ field: 'kind', op: 'eq', value: 'INVOICE' }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('kind in matches one of several kinds', () => {
  const rule = makeRule({
    conditions: [{ field: 'kind', op: 'in', value: ['BANK_TX', 'INVOICE'] }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('kind eq does not match a different kind', () => {
  const rule = makeRule({
    conditions: [{ field: 'kind', op: 'eq', value: 'RECEIPT' }],
  });
  assert.equal(evaluateRule(rule, makeExpenditure()), null);
});

// -- Per-condition: currency ---------------------------------------------

test('currency eq matches', () => {
  const rule = makeRule({
    conditions: [{ field: 'currency', op: 'eq', value: 'AUD' }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('currency in matches one of several codes', () => {
  const rule = makeRule({
    conditions: [{ field: 'currency', op: 'in', value: ['USD', 'AUD', 'EUR'] }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

// -- Per-condition: date -------------------------------------------------

test('date before matches strictly-earlier dates (lexicographic)', () => {
  const rule = makeRule({
    conditions: [{ field: 'date', op: 'before', value: '2026-12-31' }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('date after matches strictly-later dates (lexicographic)', () => {
  const rule = makeRule({
    conditions: [{ field: 'date', op: 'after', value: '2026-01-01' }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('date between is inclusive on both bounds', () => {
  const rule = makeRule({
    conditions: [{ field: 'date', op: 'between', value: ['2026-04-15', '2026-04-15'] }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

// -- Multi-condition AND -------------------------------------------------

test('three conditions all matching produces a match (AND)', () => {
  const rule = makeRule({
    conditions: [
      { field: 'kind', op: 'eq', value: 'INVOICE' },
      { field: 'currency', op: 'eq', value: 'AUD' },
      { field: 'amount', op: 'gte', value: 50 },
    ],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure()), null);
});

test('three conditions where one fails produces no match (AND short-circuit)', () => {
  const rule = makeRule({
    conditions: [
      { field: 'kind', op: 'eq', value: 'INVOICE' },
      { field: 'currency', op: 'eq', value: 'USD' }, // fails
      { field: 'amount', op: 'gte', value: 50 },
    ],
  });
  assert.equal(evaluateRule(rule, makeExpenditure()), null);
});

test('zero conditions produces a vacuous-truth match (always matches)', () => {
  // Documented decision: empty conditions = "match everything". Useful
  // for catch-all flag_for_review rules at the bottom of the stack.
  const rule = makeRule({ conditions: [] });
  const match = evaluateRule(rule, makeExpenditure());
  assert.notEqual(match, null);
  assert.equal(match!.rule_id, ruleId(1));
});

// -- Multi-rule OR / priority --------------------------------------------

test('applyRules returns all matching rules in priority order', () => {
  const ruleHigh: MappingRule = makeRule({
    id: ruleId(1),
    name: 'high prio',
    priority: 10,
    conditions: [{ field: 'kind', op: 'eq', value: 'INVOICE' }],
  });
  const ruleLow: MappingRule = makeRule({
    id: ruleId(2),
    name: 'low prio',
    priority: 100,
    conditions: [{ field: 'currency', op: 'eq', value: 'AUD' }],
  });
  // Insert in reverse priority order to confirm sort kicks in.
  const matches = applyRules([ruleLow, ruleHigh], makeExpenditure());
  assert.equal(matches.length, 2);
  assert.equal(matches[0]!.rule_name, 'high prio');
  assert.equal(matches[1]!.rule_name, 'low prio');
});

test('applyRules tie-breaks equal priorities by rule.id ascending (stable)', () => {
  const ruleA: MappingRule = makeRule({
    id: ruleId(1),
    name: 'A',
    priority: 50,
    conditions: [],
  });
  const ruleB: MappingRule = makeRule({
    id: ruleId(2),
    name: 'B',
    priority: 50,
    conditions: [],
  });
  // Both match (vacuous truth); same priority — id 1 < id 2 wins.
  const matches = applyRules([ruleB, ruleA], makeExpenditure());
  assert.equal(matches.length, 2);
  assert.equal(matches[0]!.rule_id, ruleId(1));
  assert.equal(matches[1]!.rule_id, ruleId(2));
});

test('applyRules silently skips disabled rules', () => {
  const ruleDisabled = makeRule({
    id: ruleId(1),
    enabled: false,
    conditions: [], // would otherwise vacuously match.
  });
  const ruleEnabled = makeRule({
    id: ruleId(2),
    enabled: true,
    conditions: [],
  });
  const matches = applyRules([ruleDisabled, ruleEnabled], makeExpenditure());
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.rule_id, ruleId(2));
});

test('applyRules with zero rules returns an empty array', () => {
  const matches = applyRules([], makeExpenditure());
  assert.deepEqual(matches, []);
});

test('applyRules returns a fresh array (caller may mutate)', () => {
  const rule = makeRule({ conditions: [] });
  const matches = applyRules([rule], makeExpenditure());
  matches.push({
    rule_id: 'fake',
    rule_name: 'fake',
    priority: 0,
    action: ACTION_MAP_A,
  });
  // Re-running gives the original length, proving we didn't share state.
  const matches2 = applyRules([rule], makeExpenditure());
  assert.equal(matches2.length, 1);
});

// -- Validation / error cases --------------------------------------------

test('apportion with sum != 100 throws InvalidRuleError', () => {
  const badRule = makeRule({
    action: {
      type: 'apportion',
      allocations: [
        { activity_id: ACTIVITY_A, percentage: 60 },
        { activity_id: ACTIVITY_B, percentage: 30 }, // sum = 90, not 100
      ],
    },
  });
  assert.throws(
    () => evaluateRule(badRule, makeExpenditure()),
    (err: unknown) => err instanceof Error && err.name === 'InvalidRuleError',
  );
});

test('apportion with sum == 100 within float tolerance is accepted', () => {
  // 33.33 + 33.33 + 33.34 = 100.0000... but float rep can drift; the
  // engine tolerates ±0.001.
  const goodRule = makeRule({
    action: {
      type: 'apportion',
      allocations: [
        { activity_id: ACTIVITY_A, percentage: 33.33 },
        { activity_id: ACTIVITY_B, percentage: 33.33 },
        { activity_id: '00000000-0000-4000-8000-0000000000a3', percentage: 33.34 },
      ],
    },
  });
  assert.doesNotThrow(() => evaluateRule(goodRule, makeExpenditure()));
});

test('apportion with empty allocations throws InvalidRuleError', () => {
  const badRule = makeRule({
    action: { type: 'apportion', allocations: [] },
  });
  assert.throws(
    () => evaluateRule(badRule, makeExpenditure()),
    (err: unknown) => err instanceof Error && err.name === 'InvalidRuleError',
  );
});

test('apportion with non-positive percentage throws InvalidRuleError', () => {
  const badRule = makeRule({
    action: {
      type: 'apportion',
      allocations: [
        { activity_id: ACTIVITY_A, percentage: 100 },
        { activity_id: ACTIVITY_B, percentage: 0 }, // not allowed
      ],
    },
  });
  assert.throws(
    () => evaluateRule(badRule, makeExpenditure()),
    (err: unknown) => err instanceof Error && err.name === 'InvalidRuleError',
  );
});

test('amount between with min > max throws InvalidRuleError', () => {
  const rule = makeRule({
    conditions: [{ field: 'amount', op: 'between', value: [200, 100] }],
  });
  assert.throws(
    () => evaluateRule(rule, makeExpenditure()),
    (err: unknown) => err instanceof Error && err.name === 'InvalidRuleError',
  );
});

test('date between with start > end throws InvalidRuleError', () => {
  const rule = makeRule({
    conditions: [{ field: 'date', op: 'between', value: ['2026-12-31', '2026-01-01'] }],
  });
  assert.throws(
    () => evaluateRule(rule, makeExpenditure()),
    (err: unknown) => err instanceof Error && err.name === 'InvalidRuleError',
  );
});

test('matches with invalid regex throws InvalidRuleError', () => {
  const rule = makeRule({
    conditions: [{ field: 'contact_name', op: 'matches', value: '[unclosed' }],
  });
  assert.throws(
    () => evaluateRule(rule, makeExpenditure()),
    (err: unknown) => err instanceof Error && err.name === 'InvalidRuleError',
  );
});

test('map_to_activity with empty activity_id throws InvalidRuleError', () => {
  const badRule = makeRule({
    action: { type: 'map_to_activity', activity_id: '' },
  });
  assert.throws(
    () => evaluateRule(badRule, makeExpenditure()),
    (err: unknown) => err instanceof Error && err.name === 'InvalidRuleError',
  );
});

test('flag_for_review with empty reason throws InvalidRuleError', () => {
  const badRule = makeRule({
    action: { type: 'flag_for_review', reason: '' },
  });
  assert.throws(
    () => evaluateRule(badRule, makeExpenditure()),
    (err: unknown) => err instanceof Error && err.name === 'InvalidRuleError',
  );
});

test('InvalidRuleError class is exported and discriminable by name', () => {
  // Pinning the cross-boundary error pattern: the README and call sites
  // recommend `error.name === 'InvalidRuleError'`, NOT `instanceof`.
  // This test confirms `name` is set on instances.
  const err = new InvalidRuleError('boom');
  assert.equal(err.name, 'InvalidRuleError');
  assert.equal(err.message, 'boom');
  assert.ok(err instanceof Error);
});

// -- Edge cases ----------------------------------------------------------

test('null contact_name with eq does not throw and does not match', () => {
  const rule = makeRule({
    conditions: [{ field: 'contact_name', op: 'eq', value: 'Acme' }],
  });
  assert.equal(evaluateRule(rule, makeExpenditure({ contact_name: null })), null);
});

test('null reference with contains does not throw and does not match', () => {
  const rule = makeRule({
    conditions: [{ field: 'reference', op: 'contains', value: 'INV' }],
  });
  assert.equal(evaluateRule(rule, makeExpenditure({ reference: null })), null);
});

test('null description with matches does not throw and does not match', () => {
  const rule = makeRule({
    conditions: [{ field: 'description', op: 'matches', value: '.*' }],
  });
  assert.equal(evaluateRule(rule, makeExpenditure({ description: null })), null);
});

test('null account_code does not match eq', () => {
  const rule = makeRule({
    conditions: [{ field: 'account_code', op: 'eq', value: '400' }],
  });
  assert.equal(evaluateRule(rule, makeExpenditure({ account_code: null })), null);
});

test('amount = 0 with gt 0 does not match (strict >)', () => {
  const rule = makeRule({
    conditions: [{ field: 'amount', op: 'gt', value: 0 }],
  });
  assert.equal(evaluateRule(rule, makeExpenditure({ amount: 0 })), null);
});

test('amount = 0.001 with between [0, 0.001] matches (inclusive)', () => {
  const rule = makeRule({
    conditions: [{ field: 'amount', op: 'between', value: [0, 0.001] }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure({ amount: 0.001 })), null);
});

test('ISO date lexicographic comparison: 2026-01-01 < 2026-12-31', () => {
  // Dates are compared as strings — confirm the obvious case so future
  // refactors don't accidentally introduce Date parsing.
  const rule = makeRule({
    conditions: [{ field: 'date', op: 'before', value: '2026-12-31' }],
  });
  assert.notEqual(evaluateRule(rule, makeExpenditure({ date: '2026-01-01' })), null);
});

test('case_insensitive on a non-string op (amount eq) is silently ignored', () => {
  // The type system already prevents this combination, but the engine
  // is defensive — if a hand-rolled JSON makes it past validation in
  // some future B9 path, the engine ignores `case_insensitive` rather
  // than misbehaving. We construct the rule via an `as` cast so the
  // test itself simulates the bypass.
  const rule = makeRule({
    conditions: [
      { field: 'amount', op: 'gte', value: 50, case_insensitive: true } as RuleCondition,
    ],
  });
  // Should match exactly as if case_insensitive weren't there.
  assert.notEqual(evaluateRule(rule, makeExpenditure({ amount: 100 })), null);
  assert.equal(evaluateRule(rule, makeExpenditure({ amount: 10 })), null);
});

test('disabled rule on evaluateRule returns null', () => {
  const rule = makeRule({ enabled: false, conditions: [] });
  assert.equal(evaluateRule(rule, makeExpenditure()), null);
});

test('evaluateRule still validates action of a disabled rule', () => {
  // Decision rationale: a broken action is broken regardless of
  // enabled/disabled state. Catching it eagerly is easier on operators
  // than letting it lurk until someone enables the rule.
  const rule = makeRule({
    enabled: false,
    action: { type: 'apportion', allocations: [] }, // empty
  });
  assert.throws(
    () => evaluateRule(rule, makeExpenditure()),
    (err: unknown) => err instanceof Error && err.name === 'InvalidRuleError',
  );
});

test('returned RuleMatch carries action by reference (fast path)', () => {
  // The contract: applyRules returns the action verbatim so consumers
  // can apply it without re-querying the rule. Pin that the action
  // value is exactly the one we set on the rule.
  const action: RuleAction = { type: 'flag_for_review', reason: 'manual review' };
  const rule = makeRule({ action, conditions: [] });
  const match = evaluateRule(rule, makeExpenditure())!;
  assert.equal(match.action, action);
});

test('applyRules over a mix of matching, non-matching, and disabled rules', () => {
  // End-to-end shape sanity: 4 rules, 2 should match.
  const rules: MappingRule[] = [
    makeRule({
      id: ruleId(1),
      name: 'matches kind',
      priority: 5,
      conditions: [{ field: 'kind', op: 'eq', value: 'INVOICE' }],
    }),
    makeRule({
      id: ruleId(2),
      name: 'wrong currency',
      priority: 1,
      conditions: [{ field: 'currency', op: 'eq', value: 'USD' }],
    }),
    makeRule({
      id: ruleId(3),
      name: 'disabled',
      enabled: false,
      priority: 0,
      conditions: [],
    }),
    makeRule({
      id: ruleId(4),
      name: 'matches amount',
      priority: 5,
      conditions: [{ field: 'amount', op: 'gte', value: 50 }],
    }),
  ];
  const matches = applyRules(rules, makeExpenditure());
  assert.equal(matches.length, 2);
  // Both have priority 5 — tie-broken by id ascending: rule 1 then 4.
  assert.equal(matches[0]!.rule_id, ruleId(1));
  assert.equal(matches[1]!.rule_id, ruleId(4));
});
