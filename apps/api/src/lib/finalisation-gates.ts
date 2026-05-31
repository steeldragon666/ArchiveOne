import type { SqlClient } from './workflow.js';

/**
 * Pre-flight compliance gates for /v1/claims/:id/finalise.
 *
 * Before the finalisation pipeline runs (or, in the current stub-guarded
 * state, before it would run), scan the claim's activities + entity
 * configuration for any fields whose absence would have the AusIndustry
 * portal reject the registration OR fail an ATO defence. Returns a list
 * of human-readable violations — empty array means clear-to-submit.
 *
 * Each violation has:
 *   - kind         : short machine identifier for UI grouping
 *   - severity     : 'block' | 'warn' (block stops finalisation; warn surfaces only)
 *   - activity_id  : which activity tripped the rule (null for claim-/entity-level)
 *   - activity_code: human-readable label or '—' for non-activity rules
 *   - message      : consultant-facing explanation
 *   - statutory    : citation (e.g. 's.355-30', 'TA 2023/5')
 *
 * Gates land here as the R&DTI feature surface grows:
 *
 *   v1 (migration 0097):
 *     1. Overseas R&D activity without Overseas Findings   (TA 2023/5)
 *     2. Supporting activity without parent core FK        (s.355-30)
 *     3. Activity missing the immutable hypothesis_formed_at (Body-by-Michael)
 *
 *   v2 (migration 0098):
 *     4. head_company entity_kind missing aggregated_turnover_aud
 *        for the claim's FY                                 (s.328-115)
 *     5. r_and_d_entity / associate_entity rows whose head_company_id
 *        is NULL or points at a non-existent / non-head row   (group integrity)
 *
 * The function is two SELECTs + projection — no chain writes, no
 * mutations — so callers can invoke it cheaply on every page-load of
 * the finalise screen + as a server-side guard inside POST /finalise.
 */

export type FinalisationViolationKind =
  | 'overseas_findings_missing'
  | 'supporting_missing_parent'
  | 'hypothesis_formed_at_missing'
  | 'head_company_turnover_missing'
  | 'subsidiary_missing_head_company';

export type FinalisationViolation = {
  kind: FinalisationViolationKind;
  severity: 'block' | 'warn';
  activity_id: string | null;
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

interface ClaimSubjectRow {
  fiscal_year: number;
  subject_tenant_id: string;
  subject_name: string;
  entity_kind: 'standalone' | 'head_company' | 'r_and_d_entity' | 'associate_entity';
  head_company_id: string | null;
  aggregated_turnover_aud: string | null;
  aggregated_turnover_fy_label: string | null;
  // Head-company entity_kind for the row pointed at by head_company_id,
  // or NULL when head_company_id IS NULL. Used to validate that
  // subsidiaries point at a real head company (not, e.g., at another
  // subsidiary row).
  head_entity_kind: 'standalone' | 'head_company' | 'r_and_d_entity' | 'associate_entity' | null;
}

/**
 * Run the pre-flight gates against a claim. Caller MUST have set
 * `app.current_tenant_id` on the tx before invoking — RLS scopes both
 * scans.
 */
export async function evaluateFinalisationGates(
  tx: SqlClient,
  claimId: string,
): Promise<FinalisationGateResult> {
  const violations: FinalisationViolation[] = [];

  // ----- Activity-level (v1 — migration 0097) ----------------------------
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

  for (const a of activities) {
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

  // ----- Entity-level (v2 — migration 0098) ------------------------------
  const subjectRows = await tx<ClaimSubjectRow[]>`
    SELECT c.fiscal_year,
           st.id::text AS subject_tenant_id,
           st.name AS subject_name,
           st.entity_kind,
           st.head_company_id::text,
           st.aggregated_turnover_aud::text,
           st.aggregated_turnover_fy_label,
           head.entity_kind AS head_entity_kind
      FROM claim c
      JOIN subject_tenant st ON st.id = c.subject_tenant_id
      LEFT JOIN subject_tenant head ON head.id = st.head_company_id
     WHERE c.id = ${claimId}
  `;
  const subject = subjectRows[0];
  if (subject) {
    const fyLabel = `FY${String(subject.fiscal_year).slice(-2)}`;
    const subjLabel = subject.subject_name;

    // (4) head_company missing aggregated_turnover_aud for this FY.
    //     s.328-115 needs the number to pick the 38.5% vs 43.5% rate.
    if (subject.entity_kind === 'head_company') {
      const turnoverPresent =
        subject.aggregated_turnover_aud != null && subject.aggregated_turnover_aud !== '';
      const fyMatches =
        subject.aggregated_turnover_fy_label != null &&
        subject.aggregated_turnover_fy_label.toUpperCase() === fyLabel;
      if (!turnoverPresent || !fyMatches) {
        violations.push({
          kind: 'head_company_turnover_missing',
          severity: 'block',
          activity_id: null,
          activity_code: '—',
          message: `${subjLabel} is configured as a head_company but has no aggregated_turnover_aud captured for ${fyLabel}. The s.328-115 small-vs-large test (38.5% vs 43.5% offset rate) requires it before lodgement.`,
          statutory: 's.328-115 ITAA 1997',
        });
      }
    }

    // (5) r_and_d_entity / associate_entity rows must point at a real
    //     head_company. NULL head_company_id, or a head_company_id that
    //     refers to a non-head row, is a group-integrity violation that
    //     will produce a wrong consolidated-group claim.
    if (subject.entity_kind === 'r_and_d_entity' || subject.entity_kind === 'associate_entity') {
      if (subject.head_company_id === null) {
        violations.push({
          kind: 'subsidiary_missing_head_company',
          severity: 'block',
          activity_id: null,
          activity_code: '—',
          message: `${subjLabel} is configured as ${subject.entity_kind} but has no head_company_id set. Subsidiaries must nominate their consolidated-group head before the claim is finalised.`,
          statutory: 's.328-115 / consolidated-group rules',
        });
      } else if (subject.head_entity_kind !== 'head_company') {
        violations.push({
          kind: 'subsidiary_missing_head_company',
          severity: 'block',
          activity_id: null,
          activity_code: '—',
          message: `${subjLabel} nominates a head_company_id that doesn't point at a head_company entity (target is ${subject.head_entity_kind ?? 'missing'}). Re-nominate against the actual head company.`,
          statutory: 's.328-115 / consolidated-group rules',
        });
      }
    }
  }

  return { ok: violations.every((v) => v.severity !== 'block'), violations };
}
