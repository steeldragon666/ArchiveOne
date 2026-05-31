import type { SqlClient } from './workflow.js';

/**
 * Pre-flight compliance gates for /v1/claims/:id/finalise.
 *
 * Before the finalisation pipeline runs (or, in the current stub-guarded
 * state, before it would run), scan the claim's activities for any
 * fields whose absence would have the AusIndustry portal reject the
 * registration OR fail an ATO defence. Returns a list of human-readable
 * violations — empty array means clear-to-submit.
 *
 * Each violation has:
 *   - kind        : short machine identifier for UI grouping
 *   - severity    : 'block' | 'warn' (currently all block — warnings reserved)
 *   - activity_id : which activity tripped the rule (null = claim-level)
 *   - message     : consultant-facing explanation
 *   - statutory   : citation (e.g. 's.355-30', 'TA 2023/5')
 *
 * Gates land here as the platform's R&DTI feature surface grows. v1
 * (migration 0097) covers the highest-impact set:
 *   1. Overseas R&D activity without Overseas Findings    (TA 2023/5)
 *   2. Supporting activity without parent core FK         (s.355-30)
 *   3. Activity missing the immutable hypothesis_formed_at (Body-by-Michael)
 *
 * The function is pure projection over a single SELECT — no chain writes,
 * no mutations — so callers can invoke it cheaply on every page-load of
 * the finalise screen + as a server-side guard inside POST /finalise.
 */

export type FinalisationViolation = {
  kind: 'overseas_findings_missing' | 'supporting_missing_parent' | 'hypothesis_formed_at_missing';
  severity: 'block' | 'warn';
  activity_id: string;
  activity_code: string;
  message: string;
  statutory: string;
};

export type FinalisationGateResult = {
  ok: boolean;
  violations: FinalisationViolation[];
};

interface ActivityRow {
  id: string;
  code: string;
  kind: 'core' | 'supporting';
  performed_overseas: boolean;
  overseas_findings_obtained: boolean;
  supports_activity_id: string | null;
  hypothesis_formed_at: Date | string | null;
}

/**
 * Run the pre-flight gates against a claim. Caller MUST have set
 * `app.current_tenant_id` on the tx before invoking — RLS scopes the
 * activity scan.
 */
export async function evaluateFinalisationGates(
  tx: SqlClient,
  claimId: string,
): Promise<FinalisationGateResult> {
  const activities = await tx<ActivityRow[]>`
    SELECT id::text,
           code,
           kind,
           performed_overseas,
           overseas_findings_obtained,
           supports_activity_id::text,
           hypothesis_formed_at
      FROM activity
     WHERE claim_id = ${claimId}
  `;

  const violations: FinalisationViolation[] = [];

  for (const a of activities) {
    // (1) TA 2023/5 — overseas R&D requires an Overseas Findings determination.
    if (a.performed_overseas && !a.overseas_findings_obtained) {
      violations.push({
        kind: 'overseas_findings_missing',
        severity: 'block',
        activity_id: a.id,
        activity_code: a.code,
        message: `${a.code} is marked as performed overseas but has no Overseas Findings determination on file. AusIndustry requires the s.28A determination before lodgement.`,
        statutory: 'TA 2023/5 / s.28A IR&D Act',
      });
    }

    // (2) s.355-30 — supporting activities must nominate a parent core activity.
    if (a.kind === 'supporting' && a.supports_activity_id === null) {
      violations.push({
        kind: 'supporting_missing_parent',
        severity: 'block',
        activity_id: a.id,
        activity_code: a.code,
        message: `${a.code} is a supporting activity but has no parent core activity nominated. AusIndustry portal will reject the registration.`,
        statutory: 's.355-30 IT Assessment Act 1997',
      });
    }

    // (3) Body-by-Michael — every activity must carry the immutable
    //     hypothesis_formed_at. Migration 0037 already enforces NOT NULL
    //     at DB level, so this guard catches the (impossible-by-schema)
    //     edge of a legacy row that slipped through.
    if (a.hypothesis_formed_at === null) {
      violations.push({
        kind: 'hypothesis_formed_at_missing',
        severity: 'block',
        activity_id: a.id,
        activity_code: a.code,
        message: `${a.code} has no recorded hypothesis_formed_at timestamp. The forensic-immutability audit chain requires this on every claim-bearing activity.`,
        statutory: 'Body-by-Michael v Commissioner of Taxation [2024]',
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
