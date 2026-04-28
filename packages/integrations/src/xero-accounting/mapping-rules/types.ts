/**
 * Mapping rules engine — type contracts (T-B8).
 *
 * The expenditure-to-activity mapping engine is the bridge that turns raw
 * Xero expenditure rows (invoices, bank transactions, receipts) into
 * candidate activity allocations. B8 ships only the pure runtime shapes
 * and matching logic; B9 wraps them in a DB schema + tenant-scoped CRUD
 * API, and B10 plugs them into the background job that emits
 * `EXPENDITURE_LINE_MAPPED` events.
 *
 * Design intent (decisions documented in README.md alongside this file):
 *
 *   1. **Integration-internal types**. These types live in
 *      `@cpa/integrations/xero-accounting` rather than `@cpa/schemas`
 *      because B8 is a self-contained leaf module — no consumer outside
 *      the integration package depends on the runtime shape yet. B9
 *      promotes them to a user-facing API contract.
 *
 *   2. **Discriminated unions for conditions/actions**. `RuleCondition`
 *      uses `field` × `op` discriminants; TypeScript narrowing in
 *      `evaluateRule` then guarantees we never read `value` as a number
 *      when it's a string array, etc. Adding a new field/op pair is a
 *      union-extension + a new branch in `evaluateRule`.
 *
 *   3. **`readonly` everywhere**. The engine never mutates inputs;
 *      `readonly` arrays/tuples enforce that at compile time. Callers
 *      may pass either `string[]` or `readonly string[]` — both are
 *      assignable.
 *
 *   4. **No "rule version" field on this commit.** B9 owns the migration
 *      story; B8 just pins the runtime shape. If the shape needs to
 *      evolve before B9 lands, this file is the single source of truth
 *      and changes here cascade through the engine + tests.
 */

/**
 * Discriminator on `ExpenditureForRules.kind`. Mirrors the three Xero
 * resources the B-swimlane syncs (Invoices, BankTransactions, Receipts).
 * Add new kinds here only when a new sync resource lands.
 */
export type ExpenditureKind = 'INVOICE' | 'BANK_TX' | 'RECEIPT';

/**
 * Subset of expenditure columns the engine evaluates against. Kept
 * intentionally narrow:
 *
 *   - The engine is a pure function that does NOT need the full
 *     expenditure row; passing only the fields we read keeps test
 *     fixtures lean and the contract honest.
 *   - All free-text fields are nullable because Xero allows them to be
 *     omitted on the wire (e.g. a bank transaction may have no
 *     `Reference`).
 *   - `amount` is always a positive number, expressed in the
 *     expenditure's own currency. Sign normalisation (Xero's negative
 *     credit-note amounts, etc.) is the syncer's job, not the engine's.
 *   - `currency` is ISO 4217 (e.g. `'AUD'`, `'USD'`). The engine treats
 *     it as an opaque string — comparison is case-sensitive against the
 *     value the caller writes.
 *   - `date` is an ISO date string (`YYYY-MM-DD`). Lexicographic string
 *     comparison is correct for the ISO format and avoids dragging in
 *     `Date` parsing (and its timezone footguns) inside the engine.
 */
export type ExpenditureForRules = {
  id: string;
  kind: ExpenditureKind;
  contact_name: string | null;
  reference: string | null;
  account_code: string | null;
  /** Positive number in the expenditure's currency. */
  amount: number;
  /** ISO 4217 currency code (e.g. 'AUD'). */
  currency: string;
  description: string | null;
  /** ISO date string (`YYYY-MM-DD`). */
  date: string;
};

/**
 * A single condition on a rule. Within a rule, ALL conditions must hold
 * (AND semantics — see `evaluateRule`).
 *
 * Field/op pairings are intentionally restricted via the discriminated
 * union: `amount between` is a tuple, `account_code in` accepts a string
 * array, etc. The engine relies on this narrowing — you cannot construct
 * a `{ field: 'amount', op: 'eq', value: 'foo' }` and pass typecheck.
 *
 * `case_insensitive` only applies to string-comparison ops (`eq`,
 * `contains`, `matches` on `contact_name | reference | description`).
 * Setting it on a non-string op is silently ignored — see the README
 * for the rationale and the test that pins this behaviour.
 *
 * `matches` op semantics: `value` is a regex source string (no flags).
 * The engine compiles it with `new RegExp(value, flags)` where `flags`
 * is `'i'` when `case_insensitive: true`, `''` otherwise. An invalid
 * regex throws `InvalidRuleError` at evaluation time — we don't pre-
 * validate at construction because rules may arrive untrusted from the
 * (B9) API layer; the engine is the validation point.
 */
export type RuleCondition =
  | {
      field: 'contact_name';
      op: 'eq' | 'contains' | 'matches';
      value: string;
      case_insensitive?: boolean;
    }
  | {
      field: 'reference';
      op: 'eq' | 'contains' | 'matches';
      value: string;
      case_insensitive?: boolean;
    }
  | {
      field: 'description';
      op: 'eq' | 'contains' | 'matches';
      value: string;
      case_insensitive?: boolean;
    }
  | { field: 'account_code'; op: 'eq'; value: string }
  | { field: 'account_code'; op: 'in'; value: readonly string[] }
  | { field: 'amount'; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number }
  | { field: 'amount'; op: 'between'; value: readonly [number, number] }
  | { field: 'kind'; op: 'eq'; value: ExpenditureKind }
  | { field: 'kind'; op: 'in'; value: readonly ExpenditureKind[] }
  | { field: 'currency'; op: 'eq'; value: string }
  | { field: 'currency'; op: 'in'; value: readonly string[] }
  | { field: 'date'; op: 'before' | 'after'; value: string }
  | { field: 'date'; op: 'between'; value: readonly [string, string] };

/**
 * The action a matching rule prescribes. Three shapes:
 *
 *   - `map_to_activity`: 100% of the expenditure goes to one activity.
 *   - `apportion`: split across N activities; percentages must sum to
 *     100 (±0.001 float tolerance) and every percentage must be > 0.
 *     Validated at evaluation time — `evaluateRule` throws
 *     `InvalidRuleError` on a malformed apportion.
 *   - `flag_for_review`: the engine surfaces a human-readable reason;
 *     B10's job will route these to the operator review queue rather
 *     than emitting `EXPENDITURE_LINE_MAPPED` directly.
 */
export type RuleAction =
  | { type: 'map_to_activity'; activity_id: string }
  | {
      type: 'apportion';
      allocations: ReadonlyArray<{ activity_id: string; percentage: number }>;
    }
  | { type: 'flag_for_review'; reason: string };

/**
 * The full rule. `priority` is ascending — LOWER number = HIGHER
 * priority (matches the convention C5 already uses for sync ordering).
 * Equal priorities are tie-broken by `id` ascending lexicographically;
 * `applyRules` performs that stable sort once at the start of each call.
 *
 * `enabled: false` rules are silently skipped — they are NOT considered
 * for matching at all and produce no `RuleMatch`.
 *
 * `tenant_id` is carried on the rule (vs. enforced by a parameter)
 * because B9 will store rules in a tenant-scoped table and the engine
 * is happiest when each rule is self-describing. B8 itself does NOT do
 * tenant-scoping — `applyRules` evaluates whatever you pass it. The
 * caller (B10's job) is responsible for selecting only the current
 * tenant's rules out of the DB.
 */
export type MappingRule = {
  id: string;
  tenant_id: string;
  name: string;
  /** Lower number = higher priority. */
  priority: number;
  enabled: boolean;
  /** AND semantics — all conditions must hold for the rule to match. */
  conditions: readonly RuleCondition[];
  action: RuleAction;
};

/**
 * A successful match returned from `evaluateRule` / `applyRules`. We
 * surface only the fields B10 will need to emit
 * `EXPENDITURE_LINE_MAPPED` — `rule_id` for traceability, `rule_name`
 * for human readability in audit logs, `priority` so the consumer can
 * tie-break externally if it chooses, and `action` so the consumer can
 * apply the side effect without re-querying the rule.
 *
 * Notably absent: the matched conditions themselves and the
 * expenditure id. The consumer already holds both at call time and
 * including them would balloon the payload for the high-volume B10
 * job. If we need them later for explainability, add a separate
 * `explainRule(rule, expenditure) -> Reason[]` API rather than widen
 * this shape.
 */
export type RuleMatch = {
  rule_id: string;
  rule_name: string;
  priority: number;
  action: RuleAction;
};
