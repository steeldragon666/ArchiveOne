# Mapping rules engine

Pure logic for matching synced expenditures (Xero invoices, bank
transactions, receipts) against tenant-defined rules and producing
candidate activity allocations.

This module is the runtime core of T-B8. It ships **only** the type
contracts and the matching engine — no DB schema, no API endpoints, no
background job. Those follow in **T-B9** (persistence + CRUD) and
**T-B10** (background job that calls `applyRules` and emits
`EXPENDITURE_LINE_MAPPED` events).

## Surface

```ts
import {
  applyRules,
  evaluateRule,
  InvalidRuleError,
  type ExpenditureForRules,
  type MappingRule,
  type RuleAction,
  type RuleCondition,
  type RuleMatch,
} from '@cpa/integrations/xero-accounting';
```

- `evaluateRule(rule, expenditure) -> RuleMatch | null` — single-rule
  evaluator. Returns `null` if the rule is disabled OR any condition
  fails. Throws `InvalidRuleError` if the action is malformed (regex,
  apportion sum, between range).
- `applyRules(rules, expenditure) -> RuleMatch[]` — multi-rule fan-out.
  Returns ALL matches sorted by `priority` ascending, then `rule.id`
  ascending. Disabled rules are silently skipped. Throws
  `InvalidRuleError` on any malformed rule (validation runs even on
  rules that don't end up matching).

`InvalidRuleError` is checkable across module-resolution boundaries via
`err.name === 'InvalidRuleError'`. **Do not use `instanceof`** — the
engine may be loaded from different resolved copies during the swimlane
phase, and `instanceof` would fail across them.

## Rule semantics

### Match logic

- **Within a rule**: ALL conditions must hold (AND). Empty conditions
  array is a vacuous-truth match — see "Decision: empty conditions"
  below.
- **Across rules**: independent (OR). Any matching rule produces a
  `RuleMatch`. The consumer (B10) decides whether to take first-only
  or all.

### Priority

- Lower number = higher priority (mirrors the C5 sync ordering
  convention).
- Stable sort: equal priorities tie-broken by `rule.id` ascending
  lexicographically.

### Disabled rules

Skipped silently. Never produce a match, never affect ordering.

### Boundary conventions

- `gte`, `lte`, `between` (amount and date): **inclusive** on the
  boundary.
- `gt`, `lt`, `before`, `after`: **strict** / exclusive.
- `between` validates the range up-front: `[max, min]` with
  `min > max` throws `InvalidRuleError` — it's a caller bug, not a
  vacuously-empty range.
- `between` with `min === max` is allowed and matches exactly that
  single value (useful for "only invoices on this exact date" rules).

### Null handling

Free-text expenditure fields (`contact_name`, `reference`,
`description`, `account_code`) are nullable in the type contract. A
null value **never matches** any string condition — the engine returns
`false` rather than throwing. This keeps catch-all "starts with X"
rules from blowing up on a Xero row that omitted the field.

### String comparisons

- Default: case-sensitive.
- `case_insensitive: true` on `eq`, `contains`, `matches`: applies
  lowercasing (or the `i` regex flag for `matches`).
- `case_insensitive` on a non-string op (e.g. `amount eq`): silently
  ignored. The type system blocks this combination, but the engine is
  defensive against hand-rolled JSON that bypasses validation.

### Regex (`matches`)

- `value` is the regex source (no flags surface).
- The engine applies `'i'` if `case_insensitive: true`, else no flags.
- Invalid regexes throw `InvalidRuleError` at evaluation time, not at
  construction. The rule may have arrived from an untrusted API
  caller (B9), so validation is centralised in the engine.

### Date comparisons

- Date strings are ISO `YYYY-MM-DD` format.
- The engine uses **lexicographic string comparison**, not `Date`
  parsing. This avoids timezone ambiguity entirely; for ISO dates it
  produces the same ordering as numeric date comparison.

## Action shapes

```ts
type RuleAction =
  | { type: 'map_to_activity'; activity_id: string }
  | { type: 'apportion'; allocations: ReadonlyArray<{ activity_id: string; percentage: number }> }
  | { type: 'flag_for_review'; reason: string };
```

- `map_to_activity`: 100% of the expenditure goes to one activity.
- `apportion`: split across N activities. Validation:
  - `allocations.length >= 1`
  - every `percentage > 0`
  - sum of percentages === 100 (tolerance ±0.001 for float drift)
- `flag_for_review`: surfaces a human-readable reason. B10's job
  routes these to the operator review queue rather than emitting a
  `EXPENDITURE_LINE_MAPPED` event directly.

Action validation runs **before** condition checks in `evaluateRule`
— a broken action throws regardless of whether the rule would have
matched. Even disabled rules are validated. Rationale: catching a
malformed action eagerly beats letting it lurk in the rule store
until someone enables it or it happens to match.

## Decision log

### Empty conditions = vacuous truth (always matches)

A rule with `conditions: []` matches every expenditure. The alternative
considered was throwing `InvalidRuleError` on construction, which would
force callers to special-case the catch-all pattern: "I want a rule
that flags everything for manual review at the bottom of the priority
stack." The vacuous-truth interpretation is the natural reading of AND
over an empty set and matches mathematical convention.

The README and the test suite pin this behaviour. B9's API layer can
choose to UI-enforce a minimum of one condition for user-facing rules
without changing the engine semantics.

### Types live in `@cpa/integrations`, not `@cpa/schemas`

B8 is a self-contained leaf module — no consumer outside the
integration package depends on the rule shape yet. B9 will promote
the types to a user-facing API contract at that point.

### Engine is sync + leaf module

- No `async`. Pure synchronous logic.
- No `process.env`, `Date.now()`, `Math.random()` — fully
  deterministic.
- No network or filesystem I/O.
- No dependency on `@cpa/db`, `@cpa/api`, `@cpa/schemas`. The engine
  must be safe to call from a hot loop in B10's job.

### Tenant-scoping is the caller's job

`MappingRule.tenant_id` is metadata on the rule; the engine does NOT
filter on it. B10's job is responsible for selecting only the current
tenant's rules out of the DB before passing them to `applyRules`.
This keeps the engine genuinely tenant-agnostic and avoids the trap
of double-checking tenant scoping in two places (and getting it wrong
in one).

### `RuleMatch` payload is minimal

We surface only `rule_id`, `rule_name`, `priority`, `action`. No matched
conditions, no expenditure id. The consumer holds both at call time.
If we need explainability later, add a separate
`explainRule(rule, expenditure) -> Reason[]` API — don't widen this
shape.

## Future integration (B9 / B10)

### B9: persistence + CRUD

- New table `mapping_rule` with columns aligned to the `MappingRule`
  type. `conditions` and `action` stored as `jsonb`.
- Tenant-scoped via RLS, same posture as `expenditure`.
- API endpoints under `POST/GET/PATCH/DELETE /mapping_rules`.
- Validation: the API must reject malformed rules at write time
  (zod-parse the JSON columns) so the engine's runtime checks become
  a defence-in-depth backstop, not the primary gate.
- Migration story TBD. B8 deliberately omits a `version` field on
  `MappingRule` because rule-shape evolution is B9's problem to solve
  — once a DB schema exists, schema changes need migrations and the
  versioning conversation has a concrete anchor.

### B10: background job

- pg-boss job consuming the post-sync `EXPENDITURE_INGESTED` events.
- For each expenditure: load tenant rules, call `applyRules`, then for
  each match emit `EXPENDITURE_LINE_MAPPED` with the rule + action.
- Conflict resolution policy (multiple rules match → which wins) lives
  in the job, not the engine. Plausible policies: take only the
  highest-priority rule; take all; surface conflict for manual review.
  The engine returns the full list so the job has flexibility.
- `flag_for_review` actions route to a separate review queue rather
  than emitting `EXPENDITURE_LINE_MAPPED`.
